/**
 * Parsers for what Linux says about batteries. No native code: the readers
 * (readers.ts) run `busctl` and `upower` and read sysfs, and hand the text
 * to these pure functions.
 *
 * - UPower, org.freedesktop.UPower on the system bus:
 *   https://upower.freedesktop.org/docs/UPower.html (EnumerateDevices) and
 *   https://upower.freedesktop.org/docs/Device.html (the Device properties).
 * - BlueZ, org.bluez on the system bus: org.bluez.Battery1
 *   (https://github.com/bluez/bluez/blob/master/doc/org.bluez.Battery.rst)
 *   next to org.bluez.Device1
 *   (https://github.com/bluez/bluez/blob/master/doc/org.bluez.Device.rst),
 *   all of them from one org.freedesktop.DBus.ObjectManager.GetManagedObjects.
 * - The kernel's power supply class, /sys/class/power_supply/<name>/…:
 *   https://www.kernel.org/doc/Documentation/ABI/testing/sysfs-class-power
 * - KDE Connect, org.kde.kdeconnect on the session bus (kdeconnect-kde
 *   sources: core/daemon.h, core/device.h, core/deviceinfo.h,
 *   plugins/battery/batteryplugin.h and .cpp).
 *
 * `busctl --json=short` (systemd 240 and later) writes every D-Bus value as
 * `{"type": "<signature>", "data": …}`; a variant inside a dict is the same
 * pair (see busctl(1), --json).
 */
import { UPOWER_KIND, UPOWER_TYPE, guessKind, kindOfIcon, kindOfKdeType } from './kinds.ts';
import type { Coarse, Kind, Reading } from './types.ts';

type Variant = { type: string; data: unknown };
type Props = Record<string, Variant>;

/** The `data` of a busctl --json reply, its first (or only) out argument. */
export function busctlData(json: string): unknown {
  const v = JSON.parse(json) as Variant;
  return Array.isArray(v.data) ? v.data[0] : v.data;
}

const str = (p: Props, k: string): string | undefined => (typeof p[k]?.data === 'string' ? (p[k]!.data as string) : undefined);
const num = (p: Props, k: string): number | undefined => (typeof p[k]?.data === 'number' ? (p[k]!.data as number) : undefined);
const bool = (p: Props, k: string): boolean | undefined => (typeof p[k]?.data === 'boolean' ? (p[k]!.data as boolean) : undefined);

const MAC = /([0-9a-f]{2})[:_-]([0-9a-f]{2})[:_-]([0-9a-f]{2})[:_-]([0-9a-f]{2})[:_-]([0-9a-f]{2})[:_-]([0-9a-f]{2})/i;

/** A Bluetooth address in any of the spellings readers use (`aa:bb…`, `dev_AA_BB…`, `aa-bb…`), as `AA:BB:CC:DD:EE:FF`. */
export function addressIn(s: string | undefined): string | undefined {
  const m = s ? MAC.exec(s) : null;
  return m ? m.slice(1, 7).join(':').toUpperCase() : undefined;
}

export const clampLevel = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/* UPower ----------------------------------------------------------------------------------- */

/** Object paths from `EnumerateDevices` (`ao`). */
export function parseUpowerEnumerate(json: string): string[] {
  const d = busctlData(json);
  return Array.isArray(d) ? d.filter((p): p is string => typeof p === 'string') : [];
}

/**
 * UPower's `BatteryLevel` (`u`): 0 Unknown, 1 None (the percentage is
 * valid), 3 Low, 4 Critical, 6 Normal, 7 High, 8 Full. When it is not None,
 * "the percentage … should be ignored" (Device.html, BatteryLevel).
 */
const UPOWER_LEVEL: Record<number, Coarse> = { 3: 'low', 4: 'critical', 6: 'normal', 7: 'high', 8: 'full' };
const UPOWER_LEVEL_TEXT: Record<string, Coarse> = { low: 'low', critical: 'critical', normal: 'normal', high: 'high', full: 'full' };

/**
 * UPower's `State` (`u`): 0 Unknown, 1 Charging, 2 Discharging, 3 Empty,
 * 4 Fully charged, 5 Pending charge, 6 Pending discharge. Only "charging"
 * gets the bolt; pending charge (plugged in, waiting) says nothing.
 */
function charging(state: number | string | undefined): boolean | null {
  if (state === 1 || state === 'charging') return true;
  if (state === 2 || state === 3 || state === 4 || state === 6) return false;
  if (state === 'discharging' || state === 'empty' || state === 'fully-charged' || state === 'pending-discharge') return false;
  return null;
}

interface UpowerFields {
  path: string;
  kind: Kind | 'line-power' | 'battery' | undefined;
  powerSupply: boolean | undefined;
  present: boolean | undefined;
  model?: string;
  vendor?: string;
  serial?: string;
  nativePath?: string;
  percentage: number | undefined;
  coarse?: Coarse;
  state: number | string | undefined;
}

function upowerReading(f: UpowerFields): Reading | null {
  // The display device is a composite of the others, line power has no battery.
  if (/\/DisplayDevice$/.test(f.path) || f.kind === 'line-power') return null;
  if (f.kind === 'battery' && f.present === false) return null;
  const kind: Kind = f.kind === 'battery' ? (f.powerSupply ? 'laptop' : guessKind(f.model ?? '')) : (f.kind ?? guessKind(f.model ?? ''));
  const level = f.coarse ? null : f.percentage;
  if (level === undefined || (level === 0 && !f.coarse && f.present === false)) return null;
  const name = (f.model || f.vendor || '').trim();
  const r: Reading = { reader: 'upower', id: f.path, name, kind, level: level === null ? null : clampLevel(level), charging: charging(f.state) };
  if (f.coarse) r.coarse = f.coarse;
  // UPower's Bluetooth devices have a native path like /org/bluez/hci0/dev_AA_BB_…; HID ones hid-aa:bb:…-battery.
  const address = addressIn(f.nativePath) ?? addressIn(f.serial);
  if (address) r.address = address;
  if (f.nativePath && !f.nativePath.startsWith('/')) r.native = f.nativePath;
  if (f.serial && !address) r.serial = f.serial;
  return r;
}

/** One device from `org.freedesktop.DBus.Properties.GetAll("org.freedesktop.UPower.Device")`. */
export function parseUpowerProps(path: string, json: string): Reading | null {
  const p = busctlData(json) as Props;
  const type = num(p, 'Type');
  const level = num(p, 'BatteryLevel');
  const f: UpowerFields = {
    path,
    kind: type === undefined ? undefined : (UPOWER_TYPE[type] ?? 'other'),
    powerSupply: bool(p, 'PowerSupply'),
    present: bool(p, 'IsPresent'),
    model: str(p, 'Model'),
    vendor: str(p, 'Vendor'),
    serial: str(p, 'Serial'),
    nativePath: str(p, 'NativePath'),
    percentage: num(p, 'Percentage'),
    state: num(p, 'State'),
  };
  if (level !== undefined && UPOWER_LEVEL[level]) f.coarse = UPOWER_LEVEL[level];
  return upowerReading(f);
}

/**
 * `upower --dump`, run with LC_ALL=C. Its layout is up_device_to_text in
 * libupower-glib/up-device.c: a `Device: <path>` line, two-space `key: value`
 * lines (native-path, vendor, model, serial, power supply…), the kind alone
 * on a two-space line, then four-space `key: value` lines (present, state,
 * battery-level, percentage "50%" or "50% (should be ignored)"). `state` and
 * `present` are only written for some kinds, so they may be missing.
 */
export function parseUpowerDump(text: string): Reading[] {
  const out: Reading[] = [];
  for (const block of text.split(/^Device:\s*/m).slice(1)) {
    const lines = block.split('\n');
    const path = lines[0]!.trim();
    const kv: Record<string, string> = {};
    let kindText: string | undefined;
    for (const line of lines.slice(1)) {
      if (/^\S/.test(line)) break; // the next section (Daemon:)
      const m = /^\s+([a-z][a-z -]*?):\s+(.*)$/.exec(line);
      if (m) kv[m[1]!] = m[2]!.trim();
      else if (/^ {2}[a-z][a-z-]*\s*$/.test(line)) kindText = line.trim();
    }
    const pct = kv.percentage ? /^([\d.]+)%/.exec(kv.percentage) : null;
    const f: UpowerFields = {
      path,
      kind: kindText ? (UPOWER_KIND[kindText] ?? 'other') : undefined,
      powerSupply: kv['power supply'] ? kv['power supply'] === 'yes' : undefined,
      present: kv.present ? kv.present === 'yes' : undefined,
      model: kv.model,
      vendor: kv.vendor,
      serial: kv.serial,
      nativePath: kv['native-path'],
      percentage: pct ? Number(pct[1]) : undefined,
      state: kv.state,
    };
    const coarse = kv['battery-level'] ? UPOWER_LEVEL_TEXT[kv['battery-level']] : undefined;
    if (coarse) f.coarse = coarse;
    const r = upowerReading(f);
    if (r) out.push(r);
  }
  return out;
}

/* BlueZ ------------------------------------------------------------------------------------ */

/**
 * Every device with an org.bluez.Battery1, from GetManagedObjects (`a{oa{sa{sv}}}`).
 * Battery1 sits on the device's own object (…/dev_AA_BB_…), or, with
 * BlueZ's experimental battery provider, on …/dev_…/battery_<id> with a
 * `Device` property naming it.
 */
export function parseBluezObjects(json: string): Reading[] {
  const objects = busctlData(json) as Record<string, Record<string, Props>>;
  const out: Reading[] = [];
  for (const [path, ifaces] of Object.entries(objects ?? {})) {
    const bat = ifaces['org.bluez.Battery1'];
    if (!bat) continue;
    const pct = num(bat, 'Percentage');
    if (pct === undefined) continue;
    const devPath = str(bat, 'Device') ?? path.replace(/\/battery_[^/]+$/, '');
    const dev = objects[devPath]?.['org.bluez.Device1'] ?? ifaces['org.bluez.Device1'] ?? {};
    if (bool(dev, 'Connected') === false) continue;
    const name = (str(dev, 'Alias') ?? str(dev, 'Name') ?? '').trim();
    const r: Reading = {
      reader: 'bluez',
      id: path,
      name,
      kind: kindOfIcon(str(dev, 'Icon')) ?? guessKind(name),
      level: clampLevel(pct),
      charging: bool(bat, 'Charging') ?? null,
    };
    const address = addressIn(str(dev, 'Address')) ?? addressIn(devPath);
    if (address) r.address = address;
    out.push(r);
  }
  return out;
}

/* sysfs ------------------------------------------------------------------------------------ */

/** One folder of /sys/class/power_supply: its name and the attribute files read (trimmed). */
export interface SysfsSupply {
  name: string;
  attrs: Record<string, string>;
}

/** `capacity_level`: "Unknown", "Critical", "Low", "Normal", "High", "Full" (sysfs-class-power). */
const SYSFS_LEVEL: Record<string, Coarse> = { Critical: 'critical', Low: 'low', Normal: 'normal', High: 'high', Full: 'full' };

/**
 * Names given by the kernel's HID drivers to a peripheral's battery:
 * hid-input.c "hid-<uniq>-battery", hid-logitech-hidpp.c "hidpp_battery_<n>",
 * hid-playstation.c "ps-controller-battery-<mac>", hid-nintendo.c
 * "nintendo_switch_controller_battery_<mac>", hid-sony.c
 * "sony_controller_battery_<mac>", hid-wiimote-modules.c "wiimote_battery_<uniq>".
 */
const GAMEPAD_SUPPLY = /^(ps-controller-battery|nintendo_switch_controller_battery|sony_controller_battery|wiimote_battery)/;

export function parseSysfs(supplies: SysfsSupply[]): Reading[] {
  const out: Reading[] = [];
  for (const { name, attrs } of supplies) {
    // `type`: "Battery", "UPS", "Mains", "USB", "Wireless" — only batteries here.
    if (attrs.type !== 'Battery') continue;
    if (attrs.present === '0') continue;
    const cap = attrs.capacity !== undefined && /^\d+$/.test(attrs.capacity) ? Number(attrs.capacity) : undefined;
    const coarse = cap === undefined ? SYSFS_LEVEL[attrs.capacity_level ?? ''] : undefined;
    if (cap === undefined && !coarse) continue;
    // `scope`: "System" (powers this machine), "Device" (a peripheral's), "Unknown".
    const peripheral = attrs.scope === 'Device' || /^(hid-|hidpp_battery|ps-controller|nintendo|sony_controller|wiimote)/.test(name);
    const model = (attrs.model_name ?? '').trim();
    const kind: Kind = !peripheral ? 'laptop' : GAMEPAD_SUPPLY.test(name) ? 'gamepad' : guessKind(model);
    // `status`: "Unknown", "Charging", "Discharging", "Not charging", "Full".
    const st = attrs.status;
    const r: Reading = {
      reader: 'sysfs',
      id: name,
      name: model || (peripheral ? '' : name),
      kind,
      level: cap === undefined ? null : clampLevel(cap),
      charging: st === 'Charging' ? true : st === 'Discharging' || st === 'Not charging' || st === 'Full' ? false : null,
      native: name,
    };
    if (coarse) r.coarse = coarse;
    const address = addressIn(name);
    if (address) r.address = address;
    if (attrs.serial_number && !address) r.serial = attrs.serial_number;
    out.push(r);
  }
  return out;
}

/* KDE Connect ------------------------------------------------------------------------------ */

/**
 * `deviceNames(bool onlyReachable, bool onlyPaired)` of
 * org.kde.kdeconnect.daemon at /modules/kdeconnect (`a{ss}`: id → name).
 */
export function parseKdeDeviceNames(json: string): Record<string, string> {
  const d = busctlData(json);
  return d && typeof d === 'object' ? Object.fromEntries(Object.entries(d as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};
}

/** A KDE Connect device id is used in an object path: only the characters a path element may have. */
export const KDE_ID = /^[A-Za-z0-9_]+$/;

/**
 * The battery plugin, org.kde.kdeconnect.device.battery at
 * /modules/kdeconnect/devices/<id>/battery: properties `charge` (int, -1
 * when unknown), `isCharging` (bool) and `hasBattery` (bool).
 */
export function parseKdeBattery(id: string, name: string, type: string | undefined, json: string): Reading | null {
  const p = busctlData(json) as Props;
  const charge = num(p, 'charge');
  if (charge === undefined || charge < 0 || bool(p, 'hasBattery') === false) return null;
  return { reader: 'kdeconnect', id, name: name.trim(), kind: kindOfKdeType(type), level: clampLevel(charge), charging: bool(p, 'isCharging') ?? null };
}

/** The `type` property of org.kde.kdeconnect.device, from `busctl get-property` (`s`). */
export function parseKdeType(json: string): string | undefined {
  const d = busctlData(json);
  return typeof d === 'string' ? d : undefined;
}
