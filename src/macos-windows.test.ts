import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIoreg, parsePmset, parseSystemProfiler } from './macos.ts';
import { parsePlist } from './plist.ts';
import { addressOfInstance, parseWindows, WINDOWS_SCRIPT } from './windows.ts';

const fx = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8');

test('plist: dicts, arrays, numbers, booleans and entities', () => {
  assert.deepEqual(parsePlist('<plist><dict><key>a</key><integer>3</integer><key>b</key><true/><key>c</key><array><string>x &amp; y</string><real>1.5</real></array><key>d</key><dict/></dict></plist>'), {
    a: 3,
    b: true,
    c: ['x & y', 1.5],
    d: {},
  });
});

test('ioreg: Apple HID devices with BatteryPercent, each once', () => {
  assert.deepEqual(
    parseIoreg(fx('ioreg-battery.xml')).map((r) => [r.name, r.kind, r.level, r.address ?? null]),
    [
      ['Magic Mouse', 'mouse', 12, 'A4:83:E7:12:34:56'],
      ['Magic Keyboard with Touch ID', 'keyboard', 58, null],
    ],
  );
  assert.deepEqual(parseIoreg('<?xml version="1.0"?><plist version="1.0"><array/></plist>'), []);
});

test('pmset: the internal battery, charging or not; a desktop has none', () => {
  assert.deepEqual(parsePmset(fx('pmset-charging.txt')).map((r) => [r.kind, r.level, r.charging]), [['laptop', 67, true]]);
  assert.deepEqual(parsePmset(fx('pmset-discharging.txt')).map((r) => [r.kind, r.level, r.charging]), [['laptop', 87, false]]);
  assert.deepEqual(parsePmset(' -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true').map((r) => r.charging), [false]);
  assert.deepEqual(parsePmset(' -InternalBattery-0 (id=1)\t80%; AC attached; not charging present: true').map((r) => r.charging), [false]);
  assert.deepEqual(parsePmset(fx('pmset-desktop.txt')), []);
});

test('system_profiler: connected devices with a level; earbuds by the lowest bud', () => {
  assert.deepEqual(
    parseSystemProfiler(fx('system-profiler-bluetooth.json')).map((r) => [r.name, r.kind, r.level, r.address]),
    [
      ['AirPods Pro', 'headset', 72, '90:9C:4A:AB:CD:EF'],
      ['Magic Mouse', 'mouse', 12, 'A4:83:E7:12:34:56'],
    ],
  );
});

test('Windows: one reading per Bluetooth device whatever its nodes, and the laptop', () => {
  const r = parseWindows(fx('windows-out.json'));
  assert.deepEqual(
    r.map((x) => [x.name, x.kind, x.level, x.address ?? null, x.charging]),
    [
      ['WH-1000XM5', 'headset', 72, 'AC:80:0A:11:22:33', null],
      ['MX Master 3S', 'mouse', 12, 'D1:E0:AB:8B:1A:2C', null],
      ['', 'laptop', 67, null, null],
    ],
  );
  assert.deepEqual(parseWindows(fx('windows-desktop.json')), []);
  assert.deepEqual(parseWindows('﻿'), []);
});

test('Windows: addresses in PnP instance ids', () => {
  assert.equal(addressOfInstance('BTHLE\\DEV_D1E0AB8B1A2C\\8&1F2E3D4C&0&D1E0AB8B1A2C'), 'D1:E0:AB:8B:1A:2C');
  assert.equal(addressOfInstance('BTHENUM\\{0000111E-0000-1000-8000-00805F9B34FB}_VID&0001054C_PID&0DF6\\7&2A6E3E1F&0&AC800A112233_C00000000'), 'AC:80:0A:11:22:33');
  assert.equal(addressOfInstance('BTHLEDEVICE\\{00001812-0000-1000-8000-00805F9B34FB}_DEV_VID&02046D_PID&B023_REV&0007_D1E0AB8B1A2C\\9&2&0'), 'D1:E0:AB:8B:1A:2C');
  assert.equal(addressOfInstance('BTHHFENUM\\BTHHFPAUDIO\\8&2A6E3E1F&0&97'), undefined);
});

test('Windows: the script asks for the battery key and the laptop, and prints JSON', () => {
  assert.match(WINDOWS_SCRIPT, /\{104EA319-6EE2-4701-BD47-8DDBF425BBE5\} 2/);
  assert.match(WINDOWS_SCRIPT, /Win32_Battery/);
  assert.match(WINDOWS_SCRIPT, /ConvertTo-Json/);
  assert.ok(WINDOWS_SCRIPT.includes("-match '^(BTHENUM|BTHLE|BTHLEDEVICE|BTHHFENUM)\\\\'"), 'a regex with one escaped backslash');
});
