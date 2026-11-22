/**
 * Parsers for what macOS says about batteries, from three commands that
 * come with the system:
 *
 * - `ioreg -r -k BatteryPercent -a`: every I/O Registry entry with a
 *   `BatteryPercent` property, as an XML property list (ioreg(8): `-r` shows
 *   subtrees rooted at matching objects, `-k` matches a property key, `-a`
 *   archives the output in XML). Apple's own Bluetooth keyboards, mice and
 *   trackpads, and many other Bluetooth HID devices
 *   (AppleDeviceManagementHIDEventService), publish `Product` and
 *   `BatteryPercent` there; Apple doesn't document the keys, they are what
 *   the registry holds (see e.g. https://dev.to/aromig/macos-quirks-bluetooth-device-battery-low-dkm).
 * - `pmset -g batt` (pmset(1), `-g batt`: "battery status"): the Mac's own
 *   battery, as `-InternalBattery-0 (id=…)	87%; discharging; 4:23 remaining present: true`.
 * - `system_profiler SPBluetoothDataType -json`: connected Bluetooth
 *   devices under `SPBluetoothDataType[0].device_connected`, a list of
 *   `{ "<name>": { device_address, device_minorType, device_batteryLevelMain… } }`.
 *   Levels are strings ("85%"); AirPods-like devices give one per part
 *   (device_batteryLevelLeft / Right / Case). The keys are not documented by
 *   Apple; device_batteryLevelMain is read by
 *   https://forum.soundflow.org/-13951/get-bluetooth-names-charges-from-menubar
 *   and device_minorType / device_address by systeminformation
 *   (https://github.com/sebhildebrandt/systeminformation, lib/bluetooth.js).
 */
import { guessKind } from './kinds.ts';
import { addressIn, clampLevel } from './linux.ts';
import { parsePlist, type PlistValue } from './plist.ts';
import type { Reading } from './types.ts';

type Dict = Record<string, PlistValue>;
const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);

/** The entries of `ioreg -r -k BatteryPercent -a` that have a level. */
export function parseIoreg(xml: string): Reading[] {
  const root = parsePlist(xml);
  const entries = Array.isArray(root) ? root : isDict(root) ? [root] : [];
  const out: Reading[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!isDict(e)) continue;
    const pct = e.BatteryPercent;
    if (typeof pct !== 'number') continue;
    const name = typeof e.Product === 'string' ? e.Product.trim() : '';
    // A device's address, under whatever key holds one (DeviceAddress, BD_ADDR…).
    const address = Object.entries(e).find(([k, v]) => /addr/i.test(k) && typeof v === 'string' && addressIn(v))?.[1] as string | undefined;
    const id = `ioreg:${address ?? name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const r: Reading = { reader: 'macos', id, name, kind: guessKind(name), level: clampLevel(pct), charging: null };
    const a = addressIn(address);
    if (a) r.address = a;
    out.push(r);
  }
  return out;
}

/** The internal battery from `pmset -g batt`. */
export function parsePmset(text: string): Reading[] {
  const out: Reading[] = [];
  for (const line of text.split('\n')) {
    const m = /-InternalBattery-(\d+)[^\t]*\t\s*(\d+)%;\s*([^;]+);/.exec(line);
    if (!m) continue;
    if (/present:\s*false/.test(line)) continue;
    const state = m[3]!.trim();
    // States pmset writes: "charging", "finishing charge", "discharging", "charged", "AC attached; not charging".
    const charging = state === 'charging' || state === 'finishing charge' ? true : state === 'discharging' || state === 'charged' || /not charging/.test(state) || state === 'AC attached' ? false : null;
    out.push({ reader: 'macos', id: `pmset:InternalBattery-${m[1]}`, name: '', kind: 'laptop', level: clampLevel(Number(m[2])), charging, native: `InternalBattery-${m[1]}` });
  }
  return out;
}

const pct = (v: unknown): number | undefined => {
  const m = typeof v === 'string' ? /^(\d+)\s*%?$/.exec(v.trim()) : null;
  return m ? Number(m[1]) : typeof v === 'number' ? v : undefined;
};

/** Connected devices with a level, from `system_profiler SPBluetoothDataType -json`. */
export function parseSystemProfiler(json: string): Reading[] {
  const root = JSON.parse(json) as { SPBluetoothDataType?: { device_connected?: Record<string, Record<string, unknown>>[] }[] };
  const out: Reading[] = [];
  for (const section of root.SPBluetoothDataType ?? []) {
    for (const entry of section.device_connected ?? []) {
      for (const [name, d] of Object.entries(entry)) {
        if (!d || typeof d !== 'object') continue;
        // Main, or the lowest of the earbuds (the case is not worn).
        const main = pct(d.device_batteryLevelMain) ?? pct(d.device_batteryLevel);
        const parts = [pct(d.device_batteryLevelLeft), pct(d.device_batteryLevelRight)].filter((n): n is number => n !== undefined);
        const level = main ?? (parts.length ? Math.min(...parts) : undefined);
        if (level === undefined) continue;
        const minor = typeof d.device_minorType === 'string' ? d.device_minorType : '';
        const kind = guessKind(`${minor} ${name}`);
        const r: Reading = { reader: 'macos', id: `bt:${name}`, name: name.trim(), kind: kind === 'other' && parts.length ? 'headset' : kind, level: clampLevel(level), charging: null };
        const a = addressIn(String(d.device_address ?? d.device_addr ?? ''));
        if (a) r.address = a;
        out.push(r);
      }
    }
  }
  return out;
}
