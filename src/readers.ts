/**
 * The readers: each asks one thing the system already has (no native code,
 * nothing to install) and turns its answer into readings with the parsers.
 * A reader that isn't on this system (no UPower, no KDE Connect, another
 * operating system) is skipped and says so in its status.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseIoreg, parsePmset, parseSystemProfiler } from './macos.ts';
import {
  KDE_ID,
  parseBluezObjects,
  parseKdeBattery,
  parseKdeDeviceNames,
  parseKdeType,
  parseSysfs,
  parseUpowerDump,
  parseUpowerEnumerate,
  parseUpowerProps,
  type SysfsSupply,
} from './linux.ts';
import type { Reading, ReaderId, ReaderStatus } from './types.ts';
import { WINDOWS_SCRIPT, parseWindows } from './windows.ts';

/** Runs a program and gives its standard output; throws when it is missing (`code: 'ENOENT'`) or fails. */
export type Run = (cmd: string, args: string[], o: { signal: AbortSignal; timeoutMs: number }) => Promise<string>;

export interface Env {
  run: Run;
  platform: NodeJS.Platform;
  /** /sys/class/power_supply, or a fixture folder in tests. */
  sysfsRoot: string;
  signal: AbortSignal;
  timeoutMs: number;
}

/** The real `Run`: execFile with the C locale (so `upower --dump` reads the same everywhere), no shell. */
export const execRun: Run = (cmd, args, { signal, timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { signal, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { stderr?: string };
          e.stderr = String(stderr ?? '');
          reject(e);
        } else resolve(String(stdout));
      },
    );
  });

export interface ReaderResult {
  readings: Reading[];
  status: ReaderStatus;
}

/** Not there at all: the program is missing, or the D-Bus service isn't running. */
export function isAbsent(err: unknown): boolean {
  const e = err as { code?: unknown; stderr?: string; message?: string };
  if (e?.code === 'ENOENT') return true;
  const text = `${e?.stderr ?? ''} ${e?.message ?? ''}`;
  // busctl's words when the name has no owner and can't be activated.
  return /was not provided by any \.service files|ServiceUnknown|not activatable|No such file or directory|Unit .* not found|Failed to connect to bus/i.test(text);
}

const ok = (reader: ReaderId, readings: Reading[]): ReaderResult => ({ readings, status: { reader, state: 'ok', count: readings.length } });
const off = (reader: ReaderId, message: string): ReaderResult => ({ readings: [], status: { reader, state: 'off', count: 0, message } });

async function guarded(reader: ReaderId, f: () => Promise<ReaderResult>): Promise<ReaderResult> {
  try {
    return await f();
  } catch (err) {
    if (isAbsent(err)) return off(reader, 'not on this system');
    const e = err as { stderr?: string; message?: string };
    return { readings: [], status: { reader, state: 'error', count: 0, message: (e.stderr?.trim() || e.message || String(err)).split('\n')[0]!.slice(0, 200) } };
  }
}

const busctl = (env: Env, args: string[]) => env.run('busctl', ['--json=short', ...args], env);

/** UPower over D-Bus with busctl; `upower --dump` where busctl is missing or too old for --json. */
export async function readUpower(env: Env): Promise<ReaderResult> {
  return guarded('upower', async () => {
    try {
      const paths = parseUpowerEnumerate(await busctl(env, ['--system', 'call', 'org.freedesktop.UPower', '/org/freedesktop/UPower', 'org.freedesktop.UPower', 'EnumerateDevices']));
      const props = await Promise.all(
        paths.map(async (p) => parseUpowerProps(p, await busctl(env, ['--system', 'call', 'org.freedesktop.UPower', p, 'org.freedesktop.DBus.Properties', 'GetAll', 's', 'org.freedesktop.UPower.Device']))),
      );
      return ok('upower', props.filter((r): r is Reading => !!r));
    } catch (err) {
      const e = err as { code?: unknown; stderr?: string };
      // UPower isn't there: the dump wouldn't find it either.
      if (e.code !== 'ENOENT' && !/json|unrecognized option|unknown option/i.test(e.stderr ?? '')) throw err;
      return ok('upower', parseUpowerDump(await env.run('upower', ['--dump'], env)));
    }
  });
}

export async function readBluez(env: Env): Promise<ReaderResult> {
  return guarded('bluez', async () => ok('bluez', parseBluezObjects(await busctl(env, ['--system', 'call', 'org.bluez', '/', 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects']))));
}

/** Every power supply folder, with the attribute files we use. */
export async function readSysfsSupplies(root: string): Promise<SysfsSupply[]> {
  const names = await readdir(root);
  const files = ['type', 'scope', 'present', 'capacity', 'capacity_level', 'status', 'model_name', 'manufacturer', 'serial_number'];
  return Promise.all(
    names.map(async (name) => {
      const attrs: Record<string, string> = {};
      await Promise.all(
        files.map(async (f) => {
          try {
            attrs[f] = (await readFile(join(root, name, f), 'utf8')).trim();
          } catch {
            /* not every supply has every attribute; some can't be read while asleep */
          }
        }),
      );
      return { name, attrs };
    }),
  );
}

export async function readSysfs(env: Env): Promise<ReaderResult> {
  return guarded('sysfs', async () => ok('sysfs', parseSysfs(await readSysfsSupplies(env.sysfsRoot))));
}

/** KDE Connect's paired, reachable devices with the battery plugin, on the session bus. */
export async function readKdeConnect(env: Env): Promise<ReaderResult> {
  return guarded('kdeconnect', async () => {
    const names = parseKdeDeviceNames(await busctl(env, ['--user', 'call', 'org.kde.kdeconnect', '/modules/kdeconnect', 'org.kde.kdeconnect.daemon', 'deviceNames', 'bb', 'true', 'true']));
    const readings = await Promise.all(
      Object.entries(names)
        .filter(([id]) => KDE_ID.test(id))
        .map(async ([id, name]) => {
          const dev = `/modules/kdeconnect/devices/${id}`;
          let type: string | undefined;
          try {
            type = parseKdeType(await busctl(env, ['--user', 'get-property', 'org.kde.kdeconnect', dev, 'org.kde.kdeconnect.device', 'type']));
          } catch {
            /* older KDE Connect: the kind stays unknown */
          }
          try {
            return parseKdeBattery(id, name, type, await busctl(env, ['--user', 'call', 'org.kde.kdeconnect', `${dev}/battery`, 'org.freedesktop.DBus.Properties', 'GetAll', 's', 'org.kde.kdeconnect.device.battery']));
          } catch {
            return null; // the battery plugin is off for this device
          }
        }),
    );
    return ok('kdeconnect', readings.filter((r): r is Reading => !!r));
  });
}

export async function readWindows(env: Env): Promise<ReaderResult> {
  return guarded('windows', async () => ok('windows', parseWindows(await env.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT], env))));
}

export async function readMacos(env: Env): Promise<ReaderResult> {
  return guarded('macos', async () => {
    const tries = await Promise.allSettled([
      env.run('ioreg', ['-r', '-k', 'BatteryPercent', '-a'], env).then(parseIoreg),
      env.run('pmset', ['-g', 'batt'], env).then(parsePmset),
      env.run('system_profiler', ['SPBluetoothDataType', '-json'], env).then(parseSystemProfiler),
    ]);
    const got = tries.flatMap((t) => (t.status === 'fulfilled' ? [t.value] : []));
    if (!got.length) throw (tries[0] as PromiseRejectedResult).reason;
    return ok('macos', got.flat());
  });
}

const BY_ID: Record<ReaderId, { platforms: NodeJS.Platform[]; read: (env: Env) => Promise<ReaderResult> }> = {
  upower: { platforms: ['linux', 'freebsd'], read: readUpower },
  bluez: { platforms: ['linux'], read: readBluez },
  sysfs: { platforms: ['linux'], read: readSysfs },
  kdeconnect: { platforms: ['linux', 'freebsd'], read: readKdeConnect },
  windows: { platforms: ['win32'], read: readWindows },
  macos: { platforms: ['darwin'], read: readMacos },
};

/** Runs the readers wanted on this system, together. */
export async function readAll(env: Env, wanted: (id: ReaderId) => boolean): Promise<ReaderResult[]> {
  return Promise.all(
    (Object.keys(BY_ID) as ReaderId[]).map((id) => {
      if (!wanted(id)) return Promise.resolve(off(id, 'turned off'));
      if (!BY_ID[id].platforms.includes(env.platform)) return Promise.resolve(off(id, 'not on this system'));
      return BY_ID[id].read(env);
    }),
  );
}
