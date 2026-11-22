import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import * as kit from '@loksly/lcd-canvas-kit';
import { THEMES, createBaseContext, defaultsOf } from '@kiosko/sdk';
import { widgetState } from '@kiosko/sdk/testing';
import { demoData } from './demo.ts';
import type { BatteryData } from './types.ts';
import { MIN_PX, SOURCE, columnsFor, list, low } from './widgets.ts';

const now = Date.parse('2026-11-22T10:42:00Z');
const theme = THEMES[0]!;
type W = typeof list | typeof low;

/** Paints a widget and returns every text drawn, with its size. */
function paint(w: W, data: BatteryData | undefined, size: [number, number], locale: string) {
  const texts: { text: string; size: number }[] = [];
  const spy = { ...kit, drawTracked: (g: never, text: string, x: number, y: number, o: { size: number }) => (texts.push({ text, size: o.size }), kit.drawTracked(g, text, x, y, o as never)) };
  const g = createCanvas(size[0], size[1]).getContext('2d');
  const opts = defaultsOf(w.options as never);
  w.render(g as never, { ...createBaseContext({ now, locale }), options: opts, data: undefined, sources: data ? { [SOURCE]: data } : {}, working: true, box: { x: 0, y: 0, w: size[0], h: size[1] }, theme, fonts: theme.fonts, kit: spy, canvas: { createCanvas }, preview: true } as never);
  return texts;
}

const SIZES: [number, number][] = [[1920, 462], [600, 462], [480, 240], [320, 110], [240, 240], [200, 60], [160, 24], [140, 18]];
const LOCALES = ['en', 'es', 'de', 'zh-Hant', 'zh-Hans'];

test('nothing under 11 px, in every language and size, and something is painted', () => {
  const calm = (l: string) => {
    const d = demoData(now, l);
    return { ...d, devices: d.devices.map((x) => (x.kind === 'mouse' ? { ...x, level: 64 } : x)) };
  };
  for (const locale of LOCALES)
    for (const size of SIZES)
      for (const [w, data] of [[list, demoData(now, locale)], [low, demoData(now, locale)], [low, calm(locale)], [list, undefined], [list, { ...demoData(now, locale), devices: [] }]] as [W, BatteryData | undefined][]) {
        const texts = paint(w, data, size, locale);
        assert.ok(texts.length > 0, `${w.id} ${size} ${locale} paints`);
        assert.deepEqual(texts.filter((t) => t.size < MIN_PX), [], `${w.id} ${size.join('x')} ${locale}`);
      }
});

test('the list puts the low mouse first, with its level', () => {
  const t = paint(list, demoData(now, 'es'), [480, 240], 'es').map((x) => x.text);
  assert.deepEqual(t.slice(0, 2), ['12 %', 'MX Master 3S']);
  assert.ok(t.includes('Portátil'), 'the laptop, without a name, by its kind');
});

test('a tile one line high shows the lowest device', () => {
  const t = paint(list, demoData(now, 'en'), [160, 24], 'en').map((x) => x.text);
  assert.equal(t[0], '12%');
  assert.match(t[1]!, /^MX/);
});

test('Traditional and Simplified Chinese use their own words', () => {
  const tw = paint(list, demoData(now, 'zh-Hant'), [600, 462], 'zh-Hant').map((x) => x.text).join(' ');
  const cn = paint(list, demoData(now, 'zh-Hans'), [600, 462], 'zh-Hans').map((x) => x.text).join(' ');
  assert.match(tw, /筆電/);
  assert.match(tw, /iPhone/);
  assert.match(cn, /笔记本电脑/);
  assert.match(cn, /Xiaomi/);
  const calm = demoData(now, 'zh-Hant');
  calm.devices = calm.devices.map((x) => (x.kind === 'mouse' ? { ...x, level: 64 } : x));
  assert.match(paint(low, calm, [320, 110], 'zh-Hant').map((x) => x.text).join(' '), /電量充足/);
});

test('low: only the ones to charge, or all charged; urgent only when one is almost empty', () => {
  const d = demoData(now, 'en');
  assert.deepEqual(paint(low, d, [320, 110], 'en').map((x) => x.text), ['12%', 'MX Master 3S']);
  const sources = { [SOURCE]: d };
  assert.equal(widgetState(low, 'urgent', { sources }), false);
  assert.equal(widgetState(low, 'empty', { sources }), false);
  const red = { ...d, devices: d.devices.map((x) => (x.kind === 'mouse' ? { ...x, level: 3 } : x)) };
  assert.equal(widgetState(low, 'urgent', { sources: { [SOURCE]: red } }), true);
  const calm = { ...d, devices: d.devices.map((x) => (x.kind === 'mouse' ? { ...x, level: 64 } : x)) };
  assert.equal(widgetState(low, 'empty', { sources: { [SOURCE]: calm } }), true);
  assert.equal(widgetState(list, 'idle', { sources: { [SOURCE]: calm } }), true);
  assert.equal(widgetState(list, 'idle', { sources }), false);
});

test('columns for a wide strip, one column elsewhere', () => {
  assert.equal(columnsFor(1920, 420, 6), 3);
  assert.equal(columnsFor(480, 200, 6), 1);
  assert.equal(columnsFor(320, 80, 6), 1);
  assert.equal(columnsFor(1920, 420, 1), 1);
});
