/**
 * "Once per device per discharge": a device that goes under the red level
 * starts an episode, remembered by when it began. Its full-screen alert has
 * that in its id, so once the alert is seen (or its time is up) it stays
 * away until the device has been charged and runs down again.
 */
import type { Alert } from '@kiosko/sdk';
import { KIND_LABELS } from './kinds.ts';
import { L } from './i18n.ts';
import { severity } from './merge.ts';
import type { BatteryData, Device } from './types.ts';

/** Points above the red level a device must reach (or be charging) for its episode to end: no new alert for a reading that wobbles. */
export const HYSTERESIS = 5;
/** Episodes of devices not seen for this long are forgotten. */
export const FORGET_MS = 7 * 24 * 3600_000;
/** How long an alert stays on screen if nobody says "Seen". */
export const ALERT_TTL_MS = 15 * 60_000;

/** Device key → { since, seen }: when its episode started and when the device was last seen. */
export type Episodes = Record<string, { since: number; seen: number }>;

export function advanceEpisodes(prev: Episodes, devices: Device[], levelAlert: number, now: number): Episodes {
  const next: Episodes = {};
  for (const [k, e] of Object.entries(prev)) if (now - e.seen < FORGET_MS) next[k] = e;
  for (const d of devices) {
    const low = severity(d, Infinity, levelAlert) === 'alert';
    const recovered = d.charging === true || (d.level !== null && d.level >= levelAlert + HYSTERESIS) || (d.level === null && d.coarse !== 'critical');
    const e = next[d.key];
    if (e && recovered) delete next[d.key];
    else if (e) next[d.key] = { since: e.since, seen: now };
    else if (low) next[d.key] = { since: now, seen: now };
  }
  return next;
}

const pctText = (d: Device) => (d.level === null ? '' : ` ${d.level} %`);

/** The full-screen alerts for the data: one per device under the red level, with its episode in the id. */
export function batteryAlerts(data: BatteryData | undefined): Alert[] {
  if (!data?.fullScreen) return [];
  const out: Alert[] = [];
  for (const d of data.devices) {
    const since = data.episodes[d.key];
    if (since === undefined || severity(d, data.levelWarn, data.levelAlert) !== 'alert') continue;
    const kind = KIND_LABELS[d.kind] as Record<'en' | 'es' | 'de' | 'zh-Hans' | 'zh-Hant', string>;
    const name = d.name;
    const p = pctText(d);
    out.push({
      id: `${d.key}@${since}`,
      level: 'warn',
      icon: 'zap',
      title: name
        ? L(`${name}:${p} battery`, `${name}:${p} de batería`, `${name}:${p} Akku`, `${name}：电量${p}`, `${name}：電量${p}`)
        : L(`${kind.en}:${p} battery`, `${kind.es}:${p} de batería`, `${kind.de}:${p} Akku`, `${kind['zh-Hans']}：电量${p}`, `${kind['zh-Hant']}：電量${p}`),
      text: L('Charge it soon', 'Ponlo a cargar pronto', 'Bald aufladen', '请尽快充电', '請盡快充電'),
      ttlMs: ALERT_TTL_MS,
    });
  }
  return out;
}
