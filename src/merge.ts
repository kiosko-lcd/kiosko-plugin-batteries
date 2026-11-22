/**
 * Several readers often see the same battery: UPower and BlueZ the same
 * headset, UPower and sysfs the same laptop battery or Logitech mouse. They
 * are merged into one device when they share a Bluetooth address, a kernel
 * name or a serial; failing that, the same kind and name.
 */
import { matchFilter } from '@kiosko/sdk';
import type { Coarse, Device, Reading, ReaderId } from './types.ts';

/** Whose data wins when two readers see the same device: the most complete first. */
const PRIORITY: Record<ReaderId, number> = { upower: 0, bluez: 1, sysfs: 2, kdeconnect: 3, windows: 4, macos: 5 };

const keysOf = (r: Reading): string[] => {
  const k: string[] = [];
  if (r.address) k.push(`bt:${r.address}`);
  if (r.native) k.push(`sys:${r.native}`);
  if (r.serial) k.push(`sn:${r.serial}`);
  if (!k.length) k.push(`${r.reader === 'kdeconnect' ? 'kde' : 'name'}:${r.kind}:${r.name.toLowerCase().replace(/\s+/g, ' ').trim() || r.id}`);
  return k;
};

/** Merges the readings into devices, one per physical battery. */
export function mergeReadings(readings: Reading[]): Device[] {
  // Union-find over the readings, joined by any key they share.
  const parent = readings.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  readings.forEach((r, i) => {
    for (const k of keysOf(r)) {
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, Reading[]>();
  readings.forEach((r, i) => {
    const g = find(i);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  });

  const out: Device[] = [];
  for (const group of groups.values()) {
    // A reading with a percentage beats one with a rough level, then by reader.
    const sorted = [...group].sort((a, b) => Number(a.level === null) - Number(b.level === null) || PRIORITY[a.reader] - PRIORITY[b.reader]);
    const best = sorted[0]!;
    const byReader = [...group].sort((a, b) => PRIORITY[a.reader] - PRIORITY[b.reader]);
    const keys = group.flatMap(keysOf);
    const key = keys.find((k) => k.startsWith('bt:')) ?? keys.find((k) => k.startsWith('sys:')) ?? keys.find((k) => k.startsWith('sn:')) ?? keys[0]!;
    const d: Device = {
      key,
      // BlueZ's alias is the name the user gave it; else the first name any reader has.
      name: (group.find((r) => r.reader === 'bluez' && r.name) ?? byReader.find((r) => r.name))?.name ?? '',
      kind: byReader.find((r) => r.kind !== 'other')?.kind ?? 'other',
      level: best.level,
      charging: best.charging ?? sorted.find((r) => r.charging !== null)?.charging ?? null,
      readers: [...new Set([best.reader, ...byReader.map((r) => r.reader)])],
    };
    if (best.level === null && best.coarse) d.coarse = best.coarse;
    out.push(d);
  }
  return out;
}

/**
 * A level to compare devices by: the percentage, or for a rough level what
 * it stands for (critical and low are under any warning level; the rest
 * only for the bar).
 */
const COARSE_VALUE: Record<Coarse, number> = { critical: 2, low: 10, normal: 55, high: 80, full: 100 };
export const levelOf = (d: Pick<Device, 'level' | 'coarse'>): number => d.level ?? (d.coarse ? COARSE_VALUE[d.coarse] : 100);

/** How the source's thresholds see a device. */
export function severity(d: Pick<Device, 'level' | 'coarse' | 'charging'>, warn: number, alert: number): 'ok' | 'warn' | 'alert' {
  if (d.charging === true) return 'ok';
  if (d.level === null) return d.coarse === 'critical' ? 'alert' : d.coarse === 'low' ? 'warn' : 'ok';
  if (d.level < alert) return 'alert';
  return d.level < warn ? 'warn' : 'ok';
}

/** The order on the panel: the lowest that needs charging first, then the rest from the emptiest. */
export function sortDevices(devices: Device[], warn: number, alert: number): Device[] {
  const rank = { alert: 0, warn: 1, ok: 2 } as const;
  return [...devices].sort(
    (a, b) => rank[severity(a, warn, alert)] - rank[severity(b, warn, alert)] || levelOf(a) - levelOf(b) || a.name.localeCompare(b.name),
  );
}

/**
 * Hides and renames: `devices` is a filter over the name, the kind and the
 * key (`!Xbox*`, `mouse`, `bt:AA:BB:…`); `names` maps a name or a key to the
 * name to show.
 */
export function applyUserChoices(devices: Device[], o: { devices?: string[]; names?: Record<string, string> }): Device[] {
  const names = o.names ?? {};
  return devices
    .filter((d) => matchFilter([d.name, d.kind, d.key].filter(Boolean), o.devices))
    .map((d) => {
      const n = names[d.key] ?? names[d.name];
      return n && n.trim() ? { ...d, name: n.trim() } : d;
    });
}
