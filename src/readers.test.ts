import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAll, readSysfsSupplies, type Run } from './readers.ts';
import { readBatteries, type ReadDeps } from './source.ts';
import type { ReaderId } from './types.ts';

const fx = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8');

const missing = () => Object.assign(new Error('spawn busctl ENOENT'), { code: 'ENOENT' });
const noService = () => Object.assign(new Error('Command failed'), { code: 1, stderr: 'Call failed: The name org.kde.kdeconnect was not provided by any .service files\n' });

/** A fake system: answers by the command line, like the real programs on a Linux laptop. */
function linuxLaptop(o: { kde?: boolean; oldBusctl?: boolean } = {}): { run: Run; calls: string[] } {
  const calls: string[] = [];
  const run: Run = async (cmd, args) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    if (cmd === 'upower' && args[0] === '--dump') return fx('upower-dump-laptop.txt');
    if (cmd !== 'busctl') throw missing();
    if (o.oldBusctl) throw Object.assign(new Error('Command failed'), { code: 1, stderr: "busctl: unrecognized option '--json=short'\n" });
    if (line.includes('EnumerateDevices')) return fx('upower-enumerate.json');
    if (line.includes('org.freedesktop.UPower.Device')) {
      const p = args[args.indexOf('org.freedesktop.UPower') + 1]!;
      const which = p.includes('line_power') ? 'line-power' : p.includes('battery_BAT0') ? 'laptop' : p.includes('mouse') ? 'mouse' : p.includes('headset') ? 'headset' : 'keyboard';
      return fx(`upower-getall-${which}.json`);
    }
    if (line.includes('org.bluez')) return fx('bluez-managed-objects.json');
    if (line.includes('org.kde.kdeconnect')) {
      if (!o.kde) throw noService();
      if (line.includes('deviceNames')) return fx('kdeconnect-device-names.json');
      if (line.includes('get-property')) return fx('kdeconnect-type.json');
      if (line.includes('/battery')) return fx('kdeconnect-battery.json');
    }
    throw new Error(`unexpected: ${line}`);
  };
  return { run, calls };
}

function fakeSysfs(): string {
  const root = mkdtempSync(join(tmpdir(), 'batteries-sysfs-'));
  const supply = (name: string, attrs: Record<string, string>) => {
    mkdirSync(join(root, name));
    for (const [k, v] of Object.entries(attrs)) writeFileSync(join(root, name, k), `${v}\n`);
  };
  supply('AC', { type: 'Mains', online: '1' });
  supply('BAT0', { type: 'Battery', present: '1', capacity: '67', status: 'Charging', model_name: '5B10W51867' });
  supply('hidpp_battery_0', { type: 'Battery', scope: 'Device', capacity: '12', status: 'Discharging', model_name: 'MX Master 3S' });
  return root;
}

const memoryEpisodes = (): ReadDeps['episodes'] => {
  let e = {};
  return { load: async () => e, save: async (n) => void (e = n) };
};

const ctx = { now: 1000, signal: new AbortController().signal, timeoutMs: 30_000 };
const options = { levelWarn: 15, levelAlert: 5, showAlerts: true, devices: [], names: {}, readers: [] as string[] };

test('sysfs folders are read attribute by attribute, missing ones left out', async () => {
  const root = fakeSysfs();
  try {
    const s = await readSysfsSupplies(root);
    assert.deepEqual(s.find((x) => x.name === 'hidpp_battery_0'), { name: 'hidpp_battery_0', attrs: { type: 'Battery', scope: 'Device', capacity: '12', status: 'Discharging', model_name: 'MX Master 3S' } });
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('Linux: every reader together, merged, the low mouse first; KDE Connect absent is just off', async () => {
  const root = fakeSysfs();
  try {
    const { run } = linuxLaptop();
    const d = await readBatteries(options, ctx, { run, platform: 'linux', sysfsRoot: root, episodes: memoryEpisodes() });
    assert.deepEqual(
      d.devices.map((x) => [x.kind, x.name, x.level, x.charging]),
      [
        ['mouse', 'MX Master 3S', 12, false],
        ['keyboard', 'Keychron K3', 58, false],
        ['laptop', '5B10W51867', 67, true],
        ['headset', 'Sony headphones', 70, null],
      ],
    );
    assert.deepEqual(
      d.readers.map((s) => [s.reader, s.state]),
      [
        ['upower', 'ok'],
        ['bluez', 'ok'],
        ['sysfs', 'ok'],
        ['kdeconnect', 'off'],
        ['windows', 'off'],
        ['macos', 'off'],
      ],
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('Linux with KDE Connect: the phone joins', async () => {
  const { run } = linuxLaptop({ kde: true });
  const d = await readBatteries({ ...options, readers: ['kdeconnect'] }, ctx, { run, platform: 'linux', sysfsRoot: '/nonexistent', episodes: memoryEpisodes() });
  assert.deepEqual(d.devices.map((x) => [x.kind, x.name, x.level, x.readers]), [['phone', 'Pixel 8', 84, ['kdeconnect']]]);
});

test('a busctl too old for --json falls back to upower --dump', async () => {
  const { run, calls } = linuxLaptop({ oldBusctl: true });
  const res = await readAll({ run, platform: 'linux', sysfsRoot: '/nonexistent', signal: ctx.signal, timeoutMs: 1000 }, (id: ReaderId) => id === 'upower');
  assert.ok(calls.includes('upower --dump'));
  assert.equal(res[0]!.status.state, 'ok');
  assert.equal(res[0]!.readings.length, 4);
});

test('no busctl, no upower: off, not an error', async () => {
  const run: Run = async () => {
    throw missing();
  };
  const res = await readAll({ run, platform: 'linux', sysfsRoot: '/nonexistent', signal: ctx.signal, timeoutMs: 1000 }, () => true);
  assert.deepEqual(
    res.map((r) => [r.status.reader, r.status.state]),
    [
      ['upower', 'off'],
      ['bluez', 'off'],
      ['sysfs', 'off'],
      ['kdeconnect', 'off'],
      ['windows', 'off'],
      ['macos', 'off'],
    ],
  );
});

test('Windows and macOS run their own commands only', async () => {
  const seen: string[] = [];
  const run: Run = async (cmd) => {
    seen.push(cmd);
    if (cmd === 'powershell.exe') return fx('windows-out.json');
    if (cmd === 'ioreg') return fx('ioreg-battery.xml');
    if (cmd === 'pmset') return fx('pmset-discharging.txt');
    if (cmd === 'system_profiler') return fx('system-profiler-bluetooth.json');
    throw missing();
  };
  const win = await readBatteries(options, ctx, { run, platform: 'win32', episodes: memoryEpisodes() });
  assert.deepEqual(seen, ['powershell.exe']);
  assert.deepEqual(win.devices.map((d) => [d.kind, d.level]), [['mouse', 12], ['laptop', 67], ['headset', 72]]);
  seen.length = 0;
  const mac = await readBatteries(options, ctx, { run, platform: 'darwin', episodes: memoryEpisodes() });
  assert.deepEqual(seen.sort(), ['ioreg', 'pmset', 'system_profiler']);
  // The Magic Mouse is in ioreg and system_profiler: one device, by its address.
  assert.deepEqual(mac.devices.map((d) => [d.kind, d.name, d.level]), [
    ['mouse', 'Magic Mouse', 12],
    ['keyboard', 'Magic Keyboard with Touch ID', 58],
    ['headset', 'AirPods Pro', 72],
    ['laptop', '', 87],
  ]);
});

test('episodes are kept between reads', async () => {
  let saved = 0;
  let e = {};
  const episodes: ReadDeps['episodes'] = { load: async () => e, save: async (n) => void ((e = n), saved++) };
  const run: Run = async (cmd) => {
    if (cmd === 'powershell.exe') return JSON.stringify({ bluetooth: [{ name: 'MX Master 3S', id: 'BTHLE\\DEV_D1E0AB8B1A2C\\x', level: 4 }], batteries: [] });
    throw missing();
  };
  const a = await readBatteries(options, { ...ctx, now: 1000 }, { run, platform: 'win32', episodes });
  const b = await readBatteries(options, { ...ctx, now: 61_000 }, { run, platform: 'win32', episodes });
  assert.deepEqual(a.episodes, { 'bt:D1:E0:AB:8B:1A:2C': 1000 });
  assert.deepEqual(b.episodes, { 'bt:D1:E0:AB:8B:1A:2C': 1000 });
  assert.equal(saved, 2, 'started, then last seen moved on');
});
