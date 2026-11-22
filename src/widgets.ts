/**
 * Two widgets on the same source: the list of every device (`list`) and
 * the ones running low, or a calm "all charged" (`low`).
 */
import { defineWidget, drawMore, listLayout, listOptions, t, type Graphics, type Localized, type RenderContext, type StateContext } from '@kiosko/sdk';
import { demoData } from './demo.ts';
import { drawBar, drawBolt, drawCheck, drawKindIcon } from './draw.ts';
import { L } from './i18n.ts';
import { KIND_LABELS } from './kinds.ts';
import { levelOf, severity } from './merge.ts';
import type { BatteryData, Coarse, Device } from './types.ts';

export const SOURCE = 'batteries/devices';
/** The smallest text drawn, in px of the box: readable on a panel across the desk. */
export const MIN_PX = 11;

type Ctx = RenderContext<any, any>;

export const dataOf = (sources: Record<string, unknown>): BatteryData | undefined => sources[SOURCE] as BatteryData | undefined;

const COARSE_LABELS: Record<Coarse, Localized> = {
  critical: L('Critical', 'Crítica', 'Kritisch', '极低', '極低'),
  low: L('Low', 'Baja', 'Niedrig', '偏低', '偏低'),
  normal: L('OK', 'Bien', 'OK', '正常', '正常'),
  high: L('High', 'Alta', 'Hoch', '充足', '充足'),
  full: L('Full', 'Llena', 'Voll', '已充满', '已充滿'),
};

/** "72%" or "72 %", as each language writes it. */
export function levelText(ctx: Pick<Ctx, 't'>, d: Pick<Device, 'level' | 'coarse'>): string {
  if (d.level === null) return d.coarse ? ctx.t(COARSE_LABELS[d.coarse]) : '–';
  const n = String(d.level);
  return ctx.t({ en: `${n}%`, es: `${n} %`, de: `${n} %`, 'zh-Hans': `${n}%`, 'zh-Hant': `${n}%` });
}

export const nameOf = (ctx: Pick<Ctx, 't'>, d: Device): string => d.name || ctx.t(KIND_LABELS[d.kind]);

const colorOf = (ctx: Ctx, data: BatteryData, d: Device) => {
  const c = ctx.theme.colors;
  const s = severity(d, data.levelWarn, data.levelAlert);
  return s === 'alert' ? c.alert : s === 'warn' ? c.warn : c.ink;
};

/** Paints inside the box only, whatever happens. */
function clipped(g: Graphics, ctx: Ctx, paint: () => void): void {
  const { box } = ctx;
  g.save();
  g.beginPath();
  g.rect(box.x, box.y, box.w, box.h);
  g.clip();
  try {
    paint();
  } finally {
    g.restore();
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * One device on one line: icon, name, bar, bolt and level. The level, the
 * bolt's slot and the bar are columns from the right, so bars line up.
 */
/** Text size of a row: from its height, and never so big that a name has no room. */
const rowSize = (h: number, w: number) => clamp(Math.round(Math.min(h * 0.5, w / 12)), MIN_PX, 32);
const BAR_MIN = 40;
const barWidth = (w: number) => clamp(Math.round(w * 0.24), 0, 180);

interface RowStyle {
  /** Draw the bar (decided once for the whole list, so the rows look alike). */
  bar: boolean;
  /** Keep the bolt's column even on rows not charging, so bars line up. */
  anyCharging: boolean;
  /** Text size, when not from the row's height (a box too short for a row). */
  size?: number;
}

/** Whether every row keeps its name whole (or at least eight characters) with a bar: else no row gets one. */
function barsFit(g: Graphics, ctx: Ctx, devices: Device[], w: number, h: number): boolean {
  const size = rowSize(h, w);
  const icon = clamp(Math.round(Math.min(h * 0.66, size * 1.4)), 11, 44);
  const gap = Math.max(4, Math.round(size * 0.45));
  const font = { size, family: ctx.theme.fonts.sans };
  const pctW = ctx.kit.measureTracked(g, '100%', { size, family: ctx.theme.fonts.sansBold });
  const fixed = (w >= icon * 5 ? icon + gap : 0) + pctW + gap + Math.round(size * 0.62) + gap + barWidth(w) + gap;
  if (barWidth(w) < BAR_MIN) return false;
  return devices.every((d) => w - fixed >= Math.min(ctx.kit.measureTracked(g, nameOf(ctx, d), font), size * 8));
}

function drawRow(g: Graphics, ctx: Ctx, data: BatteryData, d: Device, row: { x: number; y: number; w: number; h: number }, o: RowStyle): void {
  const { kit, theme } = ctx;
  const c = theme.colors;
  const size = o.size ?? rowSize(row.h, row.w);
  const icon = clamp(Math.round(o.size ? size * 1.2 : Math.min(row.h * 0.66, size * 1.4)), 11, 44);
  const cy = row.y + row.h / 2;
  const sev = severity(d, data.levelWarn, data.levelAlert);
  const color = colorOf(ctx, data, d);
  const base = cy + size * 0.36;
  const gap = Math.max(4, Math.round(size * 0.45));
  let x = row.x;
  if (row.w >= icon * 5) {
    drawKindIcon(g, d.kind, x, cy - icon / 2, icon, sev === 'ok' ? c.inkDim : color);
    x += icon + gap;
  }
  const fontBold = { size, family: theme.fonts.sansBold, color };
  const pct = levelText(ctx, d);
  const pctW = Math.max(kit.measureTracked(g, pct, fontBold), kit.measureTracked(g, '100%', fontBold));
  const right = row.x + row.w;
  kit.drawTracked(g, pct, right, base, { ...fontBold, align: 'right' });
  let end = right - pctW - gap;
  const bw = Math.round(size * 0.62);
  if (d.charging || o.anyCharging) {
    const bh = Math.round(size * 0.95);
    if (d.charging) drawBolt(g, end - bw, cy - bh / 2, bw, bh, c.ok);
    end -= bw + Math.round(gap * 0.6);
  }
  const name = nameOf(ctx, d);
  const font = { size, family: theme.fonts.sans, color: sev === 'ok' ? c.ink : color };
  const barW = barWidth(row.w);
  if (o.bar) {
    const bh = clamp(Math.round(row.h * 0.22), 4, 12);
    const fill = sev === 'ok' ? (d.charging ? c.ok : c.inkDim) : color;
    drawBar(g, end - barW, cy - bh / 2, barW, bh, levelOf(d), fill, c.surfaceEdge);
    end -= barW + gap;
  }
  const room = Math.max(0, end - x);
  if (room <= MIN_PX) return;
  kit.drawTracked(g, kit.truncate(g, name, room, font), x, base, font);
}

/** A box too short for a row: the first device (the lowest) on one line, as big as fits. */
function drawCompact(g: Graphics, ctx: Ctx, data: BatteryData, d: Device): void {
  const { box } = ctx;
  drawRow(g, ctx, data, d, box, { bar: false, anyCharging: false, size: clamp(Math.round(box.h * 0.78), MIN_PX, 20) });
}

function drawMessage(g: Graphics, ctx: Ctx, text: string, o: { check?: boolean; sub?: string } = {}): void {
  const { box, kit, theme } = ctx;
  const c = theme.colors;
  const size = clamp(Math.round(Math.min(box.h * 0.32, box.w / 12)), MIN_PX, 34);
  const icon = o.check ? clamp(Math.round(size * 1.4), 14, 56) : 0;
  const sub = o.sub && box.h >= size * 2.9 ? o.sub : '';
  const subSize = clamp(Math.round(size * 0.6), MIN_PX, 20);
  const blockH = sub ? size + subSize * 1.5 : size;
  const top = box.y + Math.max(0, (box.h - Math.max(blockH, icon)) / 2);
  let x = box.x;
  if (icon && box.w >= icon * 3) {
    drawCheck(g, x, top + (Math.max(blockH, icon) - icon) / 2, icon, c.ok);
    x += icon + Math.round(size * 0.5);
  }
  const textTop = top + (Math.max(blockH, icon) - blockH) / 2;
  const font = { size, family: theme.fonts.sans, color: c.inkDim };
  kit.drawTracked(g, kit.truncate(g, text, box.x + box.w - x, font), x, textTop + size * 0.85, font);
  if (sub) {
    const f2 = { size: subSize, family: theme.fonts.sans, color: c.inkFaint };
    kit.drawTracked(g, kit.truncate(g, sub, box.x + box.w - x, f2), x, textTop + size + subSize * 1.15, f2);
  }
}

const WAITING = L('Reading batteries…', 'Leyendo baterías…', 'Akkus werden gelesen…', '正在读取电量…', '正在讀取電量…');
const NONE = L('No batteries found', 'No se encuentran baterías', 'Keine Akkus gefunden', '未找到电池', '找不到電池');
const NONE_HINT = L(
  'Connect a Bluetooth device, or see Settings → Data sources',
  'Conecta un dispositivo Bluetooth, o mira Ajustes → Fuentes de datos',
  'Verbinde ein Bluetooth-Gerät oder sieh unter Einstellungen → Datenquellen nach',
  '连接一个蓝牙设备，或查看“设置 → 数据源”',
  '連接一個藍牙裝置，或查看「設定 → 資料來源」',
);
const ALL_CHARGED = L('All charged', 'Todo cargado', 'Alles geladen', '电量充足', '電量充足');

/** Columns for a wide box (a strip of 1920×462): about one per 1.6 heights, each at least 300 px wide. */
export function columnsFor(w: number, h: number, n: number): number {
  return Math.max(1, Math.min(n, Math.floor(w / 300), Math.round(w / (h * 1.6))));
}

function drawList(g: Graphics, ctx: Ctx, data: BatteryData, devices: Device[], o: { rows: number; showBar: boolean; maxRow: number }): void {
  const { box } = ctx;
  if (box.h < 26) return drawCompact(g, ctx, data, devices[0]!);
  const cols = o.rows > 0 ? 1 : columnsFor(box.w, box.h, devices.length);
  if (cols > 1) {
    const per = Math.ceil(devices.length / cols);
    const gutter = Math.round(box.h * 0.08);
    const colW = (box.w - gutter * (cols - 1)) / cols;
    for (let i = 0; i < cols; i++) {
      const sub = { ...ctx, box: { x: box.x + i * (colW + gutter), y: box.y, w: colW, h: box.h } };
      drawList(g, sub, data, devices.slice(i * per, (i + 1) * per), { ...o, rows: 0 });
    }
    return;
  }
  const anyCharging = devices.some((d) => d.charging);
  const plan = listLayout(box, devices.length, { rows: o.rows }, { sizes: { 'one-line': { min: 20, max: o.maxRow } } });
  const pad = Math.round(plan.rowH * 0.08);
  const bar = o.showBar && barsFit(g, ctx, devices.slice(0, plan.shown), box.w, plan.rowH - pad * 2);
  plan.rows.forEach((row, i) => drawRow(g, ctx, data, devices[i]!, { x: row.x, y: row.y + pad, w: row.w, h: row.h - pad * 2 }, { bar, anyCharging }));
  drawMore(g, ctx, plan, {});
}

const lowOnes = (data: BatteryData) => data.devices.filter((d) => severity(d, data.levelWarn, data.levelAlert) !== 'ok');

const hasAlert = (data: BatteryData | undefined) => !!data && data.devices.some((d) => severity(d, data.levelWarn, data.levelAlert) === 'alert');

const demo = ({ now, locale }: { now: number; locale: string }) => ({ sources: { [SOURCE]: demoData(now, locale) } });

export const list = defineWidget({
  id: 'list',
  name: L('Batteries', 'Baterías', 'Akkus', '电池', '電池'),
  description: L(
    'Every device with a battery, one per line: the ones running low first, in amber and red, with a bolt on those charging. In a small tile, the lowest one.',
    'Cada dispositivo con batería, uno por línea: primero los que se están quedando sin batería, en ámbar y rojo, con un rayo en los que cargan. En una tesela pequeña, el más bajo.',
    'Jedes Gerät mit Akku, eines pro Zeile: die fast leeren zuerst, in Gelb und Rot, mit einem Blitz bei denen, die laden. In einer kleinen Kachel das niedrigste.',
    '每个带电池的设备各占一行：电量低的排在最前，以琥珀色和红色显示，正在充电的带闪电标志。小格子里只显示电量最低的那个。',
    '每個有電池的裝置各佔一行：電量低的排在最前面，以琥珀色和紅色顯示，正在充電的帶閃電標誌。小方格裡只顯示電量最低的那個。',
  ),
  icon: 'battery-medium',
  category: 'system',
  tags: ['battery', 'bluetooth'],
  size: { min: { w: 140, h: 24 }, preferred: { w: 480, h: 240 } },
  sources: [SOURCE],
  options: t.object({
    ...listOptions(),
    showBar: t.boolean({ default: true, label: L('Show the level bar', 'Mostrar la barra de nivel', 'Füllstandsbalken zeigen', '显示电量条', '顯示電量條') }),
  }),
  idle: ({ sources }) => {
    const d = dataOf(sources);
    return !d || lowOnes(d).length === 0;
  },
  empty: ({ sources }) => !!dataOf(sources) && dataOf(sources)!.devices.length === 0,
  render(g, ctx) {
    const data = dataOf(ctx.sources);
    clipped(g, ctx, () => {
      if (!data) return drawMessage(g, ctx, ctx.t(WAITING));
      if (!data.devices.length) return drawMessage(g, ctx, ctx.t(NONE), { sub: ctx.t(NONE_HINT) });
      drawList(g, ctx, data, data.devices, { rows: ctx.options.rows, showBar: ctx.options.showBar, maxRow: 88 });
    });
  },
  demo,
});

export const low = defineWidget({
  id: 'low',
  name: L('Low batteries', 'Baterías bajas', 'Schwache Akkus', '低电量', '低電量'),
  description: L(
    'Only the devices that need charging, or a calm "All charged": for a corner of a page. Takes its tile while one is almost empty.',
    'Solo los dispositivos que hay que cargar, o un tranquilo «Todo cargado»: para una esquina de la página. Se queda la tesela mientras uno esté casi vacío.',
    'Nur die Geräte, die geladen werden müssen, oder ein ruhiges „Alles geladen“: für eine Ecke der Seite. Behält die Kachel, solange eines fast leer ist.',
    '只显示需要充电的设备，或安静的“电量充足”：适合放在页面一角。有设备电量告急时会占用其格子。',
    '只顯示需要充電的裝置，或安靜的「電量充足」：適合放在頁面一角。有裝置電量告急時會佔用其方格。',
  ),
  icon: 'battery-low',
  category: 'system',
  tags: ['battery', 'bluetooth'],
  size: { min: { w: 120, h: 24 }, preferred: { w: 320, h: 110 } },
  sources: [SOURCE],
  options: t.object({ ...listOptions() }),
  urgent: ({ sources }) => hasAlert(dataOf(sources)),
  idle: ({ sources }) => {
    const d = dataOf(sources);
    return !d || lowOnes(d).length === 0;
  },
  empty: ({ sources }) => {
    const d = dataOf(sources);
    return !!d && lowOnes(d).length === 0;
  },
  render(g, ctx) {
    const data = dataOf(ctx.sources);
    clipped(g, ctx, () => {
      if (!data) return drawMessage(g, ctx, ctx.t(WAITING));
      const lows = lowOnes(data);
      if (!lows.length) {
        if (!data.devices.length) return drawMessage(g, ctx, ctx.t(NONE));
        const lowest = data.devices.filter((d) => !d.charging).sort((a, b) => levelOf(a) - levelOf(b))[0];
        const sub = lowest ? ctx.t(L('Lowest: {name} {pct}', 'La más baja: {name} {pct}', 'Am niedrigsten: {name} {pct}', '最低：{name} {pct}', '最低：{name} {pct}')).replace('{name}', nameOf(ctx, lowest)).replace('{pct}', levelText(ctx, lowest)) : undefined;
        return drawMessage(g, ctx, ctx.t(ALL_CHARGED), { check: true, ...(sub ? { sub } : {}) });
      }
      drawList(g, ctx, data, lows, { rows: ctx.options.rows, showBar: true, maxRow: 88 });
    });
  },
  demo,
});

export const WIDGETS = [list, low];

/** For tests: the state functions with a given source data. */
export const stateOf = (data: BatteryData | undefined): Pick<StateContext<any, any>, 'sources'> => ({ sources: data ? { [SOURCE]: data } : {} });
