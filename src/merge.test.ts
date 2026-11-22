import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceAlerts } from '@kiosko/sdk/testing';
import { advanceEpisodes, batteryAlerts, HYSTERESIS } from './episodes.ts';
import { parseBluezObjects, parseSysfs, parseUpowerDump } from './linux.ts';
import { applyUserChoices, mergeReadings, severity, sortDevices } from './merge.ts';
import { devicesSource } from './source.ts';
import type { BatteryData, Device, Reading } from './types.ts';

const fx = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8');

const r = (o: Partial<Reading> & Pick<Reading, 'reader' | 'id'>): Reading => ({ name: '', kind: 'other', level: 50, charging: null, ...o });

test('the same headset from UPower and BlueZ is one device, with BlueZ’s alias', () => {
  const d = mergeReadings([
    r({ reader: 'upower', id: '/u/headset', name: 'WH-1000XM5', kind: 'headset', level: 70, address: 'AC:80:0A:11:22:33' }),
    r({ reader: 'bluez', id: '/b/dev', name: 'Sony headphones', kind: 'headset', level: 72, charging: true, address: 'AC:80:0A:11:22:33' }),
  ]);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0], { key: 'bt:AC:80:0A:11:22:33', name: 'Sony headphones', kind: 'headset', level: 70, charging: true, readers: ['upower', 'bluez'] });
});

test('UPower’s rough level gives way to a reader with the percentage', () => {
  const d = mergeReadings([
    r({ reader: 'upower', id: '/u/kbd', name: 'Keychron K3', kind: 'keyboard', level: null, coarse: 'low', charging: false, address: 'DC:2C:26:44:55:66' }),
    r({ reader: 'bluez', id: '/b/kbd', name: 'Keychron K3', kind: 'keyboard', level: 58, address: 'DC:2C:26:44:55:66' }),
  ]);
  assert.equal(d.length, 1);
  assert.equal(d[0]!.level, 58);
  assert.equal(d[0]!.coarse, undefined);
  assert.equal(d[0]!.charging, false, 'charging from whoever knows');
  assert.deepEqual(d[0]!.readers, ['bluez', 'upower']);
});

test('a whole Linux laptop: UPower dump + BlueZ + sysfs give one device per battery', () => {
  const readings = [
    ...parseUpowerDump(fx('upower-dump-laptop.txt')),
    ...parseBluezObjects(fx('bluez-managed-objects.json')),
    ...parseSysfs([
      { name: 'BAT0', attrs: { type: 'Battery', capacity: '67', status: 'Charging', model_name: '5B10W51867' } },
      { name: 'hidpp_battery_0', attrs: { type: 'Battery', scope: 'Device', capacity: '12', status: 'Discharging', model_name: 'MX Master 3S' } },
      { name: 'hid-dc:2c:26:44:55:66-battery', attrs: { type: 'Battery', scope: 'Device', capacity: '58', status: 'Discharging', model_name: 'Keychron K3' } },
    ]),
  ];
  const devices = sortDevices(mergeReadings(readings), 15, 5);
  assert.deepEqual(
    devices.map((d) => [d.key, d.kind, d.level, d.readers.join('+')]),
    [
      ['sys:hidpp_battery_0', 'mouse', 12, 'upower+sysfs'],
      ['bt:DC:2C:26:44:55:66', 'keyboard', 58, 'bluez+upower+sysfs'],
      ['sys:BAT0', 'laptop', 67, 'upower+sysfs'],
      ['bt:AC:80:0A:11:22:33', 'headset', 70, 'upower+bluez'],
    ],
  );
});

test('KDE Connect phones are not merged with a Bluetooth device of the same name', () => {
  const d = mergeReadings([
    r({ reader: 'kdeconnect', id: 'abc', name: 'Pixel 8', kind: 'phone', level: 84 }),
    r({ reader: 'bluez', id: '/b/p', name: 'Pixel 8', kind: 'phone', level: 80, address: '11:22:33:44:55:66' }),
  ]);
  assert.equal(d.length, 2);
});

test('thresholds: amber under levelWarn, red under levelAlert, charging is never low', () => {
  const dev = (level: number | null, o: Partial<Device> = {}) => ({ level, charging: false, ...o });
  assert.equal(severity(dev(15), 15, 5), 'ok');
  assert.equal(severity(dev(14), 15, 5), 'warn');
  assert.equal(severity(dev(5), 15, 5), 'warn');
  assert.equal(severity(dev(4), 15, 5), 'alert');
  assert.equal(severity(dev(3, { charging: true }), 15, 5), 'ok');
  assert.equal(severity(dev(null, { coarse: 'low' }), 15, 5), 'warn');
  assert.equal(severity(dev(null, { coarse: 'critical' }), 15, 5), 'alert');
  assert.equal(severity(dev(null, { coarse: 'full' }), 15, 5), 'ok');
});

test('the low ones first, then from the emptiest', () => {
  const mk = (key: string, level: number, charging = false): Device => ({ key, name: key, kind: 'other', level, charging, readers: ['upower'] });
  assert.deepEqual(
    sortDevices([mk('a', 80), mk('b', 12), mk('c', 3, true), mk('d', 4), mk('e', 40)], 15, 5).map((d) => d.key),
    ['d', 'b', 'c', 'e', 'a'],
  );
});

test('hiding and renaming', () => {
  const ds: Device[] = [
    { key: 'bt:1', name: 'Xbox Wireless Controller', kind: 'gamepad', level: 31, charging: false, readers: ['bluez'] },
    { key: 'sys:hidpp_battery_0', name: 'MX Master 3S', kind: 'mouse', level: 12, charging: false, readers: ['upower'] },
  ];
  assert.deepEqual(applyUserChoices(ds, { devices: ['!Xbox*'] }).map((d) => d.name), ['MX Master 3S']);
  assert.deepEqual(applyUserChoices(ds, { devices: ['mouse'] }).map((d) => d.name), ['MX Master 3S']);
  assert.deepEqual(applyUserChoices(ds, { names: { 'MX Master 3S': 'Ratón', 'bt:1': 'Mando' } }).map((d) => d.name), ['Mando', 'Ratón']);
});

/* Alerts --------------------------------------------------------------------------------------- */

const mouse = (level: number, charging = false): Device => ({ key: 'sys:hidpp_battery_0', name: 'MX Master 3S', kind: 'mouse', level, charging, readers: ['upower'] });
const data = (devices: Device[], episodes: Record<string, number>, fullScreen = true): BatteryData => ({ at: 0, devices, readers: [], levelWarn: 15, levelAlert: 5, fullScreen, episodes });
const since = (e: ReturnType<typeof advanceEpisodes>) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v.since]));

test('one alert per device per discharge', () => {
  let e = advanceEpisodes({}, [mouse(12)], 5, 1000);
  assert.deepEqual(e, {}, 'amber is not an alert');
  e = advanceEpisodes(e, [mouse(4)], 5, 2000);
  const [first] = batteryAlerts(data([mouse(4)], since(e)));
  assert.equal(first!.id, 'sys:hidpp_battery_0@2000');
  assert.equal(first!.level, 'warn');
  assert.deepEqual(first!.title, { en: 'MX Master 3S: 4 % battery', es: 'MX Master 3S: 4 % de batería', de: 'MX Master 3S: 4 % Akku', 'zh-Hans': 'MX Master 3S：电量 4 %', 'zh-Hant': 'MX Master 3S：電量 4 %' });

  // Further down, still the same discharge: the same id, so once seen it stays hidden.
  e = advanceEpisodes(e, [mouse(3)], 5, 3000);
  e = advanceEpisodes(e, [], 5, 4000); // it died, or was turned off
  e = advanceEpisodes(e, [mouse(2)], 5, 5000);
  assert.deepEqual(batteryAlerts(data([mouse(2)], since(e))).map((a) => a.id), ['sys:hidpp_battery_0@2000']);

  // A wobble just over the line doesn't end it.
  e = advanceEpisodes(e, [mouse(5 + HYSTERESIS - 1)], 5, 6000);
  assert.equal(since(e)['sys:hidpp_battery_0'], 2000);

  // Charged: the episode ends; the next discharge is a new alert.
  e = advanceEpisodes(e, [mouse(30, true)], 5, 7000);
  assert.deepEqual(e, {});
  e = advanceEpisodes(e, [mouse(4)], 5, 9000);
  assert.deepEqual(batteryAlerts(data([mouse(4)], since(e))).map((a) => a.id), ['sys:hidpp_battery_0@9000']);
});

test('no alert when they are off, when charging, or for a device only amber', () => {
  const e = { 'sys:hidpp_battery_0': 2000 };
  assert.deepEqual(batteryAlerts(data([mouse(4)], e, false)), []);
  assert.deepEqual(batteryAlerts(data([mouse(4, true)], e)), []);
  assert.deepEqual(batteryAlerts(data([mouse(12)], e)), []);
  assert.deepEqual(batteryAlerts(undefined), []);
});

test('the source’s alerts, asked the way Kiosko does', () => {
  const [a] = sourceAlerts(devicesSource, { data: data([mouse(4)], { 'sys:hidpp_battery_0': 2000 }), options: {}, now: 3000 } as never);
  assert.equal(a?.id, 'sys:hidpp_battery_0@2000');
  assert.deepEqual(sourceAlerts(devicesSource, { now: 0 } as never), [], 'the demo has nothing under 5 %');
});

test('a device without a name is called by its kind', () => {
  const lap: Device = { key: 'sys:BAT0', name: '', kind: 'laptop', level: 3, charging: false, readers: ['upower'] };
  const [a] = batteryAlerts(data([lap], { 'sys:BAT0': 1 }));
  assert.equal((a!.title as Record<string, string>).es, 'Portátil: 3 % de batería');
  assert.equal((a!.title as Record<string, string>)['zh-Hant'], '筆電：電量 3 %');
});
