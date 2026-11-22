import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addressIn,
  parseBluezObjects,
  parseKdeBattery,
  parseKdeDeviceNames,
  parseKdeType,
  parseSysfs,
  parseUpowerDump,
  parseUpowerEnumerate,
  parseUpowerProps,
} from './linux.ts';

const fx = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8');

test('addresses in the spellings readers use', () => {
  assert.equal(addressIn('/org/bluez/hci0/dev_ac_80_0a_11_22_33'), 'AC:80:0A:11:22:33');
  assert.equal(addressIn('hid-dc:2c:26:44:55:66-battery'), 'DC:2C:26:44:55:66');
  assert.equal(addressIn('a4-83-e7-12-34-56'), 'A4:83:E7:12:34:56');
  assert.equal(addressIn('hidpp_battery_0'), undefined);
});

test('UPower over busctl: a desktop with no batteries (captured) has nothing', () => {
  assert.deepEqual(parseUpowerEnumerate(fx('upower-enumerate-empty.json')), []);
  assert.equal(parseUpowerProps('/org/freedesktop/UPower/devices/DisplayDevice', fx('upower-getall-display.json')), null);
});

test('UPower over busctl: laptop, mouse, headset and a keyboard with a rough level', () => {
  const paths = parseUpowerEnumerate(fx('upower-enumerate.json'));
  assert.equal(paths.length, 5);
  assert.equal(parseUpowerProps(paths[0]!, fx('upower-getall-line-power.json')), null, 'line power has no battery');
  assert.deepEqual(parseUpowerProps(paths[1]!, fx('upower-getall-laptop.json')), {
    reader: 'upower',
    id: paths[1],
    name: '5B10W51867',
    kind: 'laptop',
    level: 67,
    charging: true,
    native: 'BAT0',
    serial: '1234',
  });
  const mouse = parseUpowerProps(paths[2]!, fx('upower-getall-mouse.json'))!;
  assert.equal(mouse.kind, 'mouse');
  assert.equal(mouse.level, 12);
  assert.equal(mouse.charging, false);
  assert.equal(mouse.native, 'hidpp_battery_0');
  const headset = parseUpowerProps(paths[3]!, fx('upower-getall-headset.json'))!;
  assert.equal(headset.kind, 'headset');
  assert.equal(headset.address, 'AC:80:0A:11:22:33');
  assert.equal(headset.charging, null, 'state unknown');
  const kbd = parseUpowerProps(paths[4]!, fx('upower-getall-keyboard.json'))!;
  assert.equal(kbd.level, null, 'BatteryLevel is not None: the percentage is ignored');
  assert.equal(kbd.coarse, 'low');
  assert.equal(kbd.address, 'DC:2C:26:44:55:66');
});

test('upower --dump says the same as busctl', () => {
  assert.deepEqual(parseUpowerDump(fx('upower-dump-desktop.txt')), [], 'the display device alone is skipped');
  const r = parseUpowerDump(fx('upower-dump-laptop.txt'));
  assert.deepEqual(
    r.map((x) => [x.kind, x.name, x.level, x.coarse, x.charging, x.address ?? x.native]),
    [
      ['laptop', '5B10W51867', 67, undefined, true, 'BAT0'],
      ['mouse', 'MX Master 3S', 12, undefined, false, 'hidpp_battery_0'],
      ['keyboard', 'Keychron K3', null, 'low', false, 'DC:2C:26:44:55:66'],
      ['headset', 'Sony headphones', 70, undefined, null, 'AC:80:0A:11:22:33'],
    ],
  );
});

test('BlueZ: connected devices with Battery1, named by their alias', () => {
  const r = parseBluezObjects(fx('bluez-managed-objects.json'));
  assert.deepEqual(
    r.map((x) => [x.name, x.kind, x.level, x.address, x.charging]),
    [
      ['Sony headphones', 'headset', 72, 'AC:80:0A:11:22:33', null],
      ['Keychron K3', 'keyboard', 58, 'DC:2C:26:44:55:66', null],
    ],
  );
});

test('BlueZ: a battery on its own object (experimental provider) finds its device', () => {
  const json = JSON.stringify({
    type: 'a{oa{sa{sv}}}',
    data: [
      {
        '/org/bluez/hci0/dev_98_7A_14_77_88_99': { 'org.bluez.Device1': { Address: { type: 's', data: '98:7A:14:77:88:99' }, Alias: { type: 's', data: 'Xbox Wireless Controller' }, Icon: { type: 's', data: 'input-gaming' }, Connected: { type: 'b', data: true } } },
        '/org/bluez/hci0/dev_98_7A_14_77_88_99/battery_main': { 'org.bluez.Battery1': { Percentage: { type: 'y', data: 31 }, Device: { type: 'o', data: '/org/bluez/hci0/dev_98_7A_14_77_88_99' }, Charging: { type: 'b', data: false } } },
      },
    ],
  });
  assert.deepEqual(parseBluezObjects(json).map((x) => [x.name, x.kind, x.level, x.charging, x.address]), [['Xbox Wireless Controller', 'gamepad', 31, false, '98:7A:14:77:88:99']]);
});

test('sysfs: the laptop, HID peripherals and controllers; chargers and USB-C ports are not batteries', () => {
  const r = parseSysfs([
    { name: 'AC', attrs: { type: 'Mains', online: '1' } },
    { name: 'ucsi-source-psy-USBC000:001', attrs: { type: 'USB', scope: 'Unknown' } },
    { name: 'BAT0', attrs: { type: 'Battery', present: '1', capacity: '67', capacity_level: 'Normal', status: 'Charging', model_name: '5B10W51867', serial_number: '1234' } },
    { name: 'hidpp_battery_0', attrs: { type: 'Battery', scope: 'Device', present: '1', capacity_level: 'Low', status: 'Discharging', model_name: 'MX Master 3S' } },
    { name: 'ps-controller-battery-98:7a:14:77:88:99', attrs: { type: 'Battery', scope: 'Device', capacity: '31', status: 'Discharging', model_name: 'Wireless Controller' } },
    { name: 'hid-dc:2c:26:44:55:66-battery', attrs: { type: 'Battery', scope: 'Device', capacity: '58', status: 'Unknown', model_name: 'Keychron K3' } },
    { name: 'BAT1', attrs: { type: 'Battery', present: '0', capacity: '0' } },
  ]);
  assert.deepEqual(
    r.map((x) => [x.id, x.kind, x.level, x.coarse, x.charging, x.address]),
    [
      ['BAT0', 'laptop', 67, undefined, true, undefined],
      ['hidpp_battery_0', 'mouse', null, 'low', false, undefined],
      ['ps-controller-battery-98:7a:14:77:88:99', 'gamepad', 31, undefined, false, '98:7A:14:77:88:99'],
      ['hid-dc:2c:26:44:55:66-battery', 'keyboard', 58, undefined, null, 'DC:2C:26:44:55:66'],
    ],
  );
});

test('KDE Connect: the phone, its charge and whether it charges', () => {
  const names = parseKdeDeviceNames(fx('kdeconnect-device-names.json'));
  assert.deepEqual(names, { a1b2c3d4_e5f6_4a7b_8c9d_0e1f2a3b4c5d: 'Pixel 8' });
  const type = parseKdeType(fx('kdeconnect-type.json'));
  assert.equal(type, 'phone');
  assert.deepEqual(parseKdeBattery('a1b2', 'Pixel 8', type, fx('kdeconnect-battery.json')), { reader: 'kdeconnect', id: 'a1b2', name: 'Pixel 8', kind: 'phone', level: 84, charging: false });
  assert.equal(parseKdeBattery('a1b2', 'Pixel 8', type, fx('kdeconnect-battery-unknown.json')), null, 'charge -1: not known yet');
});
