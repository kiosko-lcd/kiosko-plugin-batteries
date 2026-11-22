/**
 * Sample data for the gallery, the editor and the tests: a believable desk
 * (headphones charging, a mouse running low, keyboard, controller, phone,
 * laptop) with the names people there would see.
 */
import { sortDevices } from './merge.ts';
import type { BatteryData, Device, Kind } from './types.ts';

type Names = Record<'headset' | 'mouse' | 'keyboard' | 'gamepad' | 'phone', string>;

const NAMES: Record<string, Names> = {
  en: { headset: 'WH-1000XM5', mouse: 'MX Master 3S', keyboard: 'Keychron K3', gamepad: 'Xbox Wireless Controller', phone: 'Pixel 8' },
  es: { headset: 'WH-1000XM5', mouse: 'MX Master 3S', keyboard: 'Keychron K3', gamepad: 'DualSense', phone: 'Móvil de Lucía' },
  de: { headset: 'WH-1000XM5', mouse: 'MX Master 3S', keyboard: 'Keychron K3', gamepad: 'Xbox Wireless Controller', phone: 'Galaxy S24' },
  'zh-Hans': { headset: 'HUAWEI FreeBuds Pro 3', mouse: 'MX Master 3S', keyboard: 'Keychron K3', gamepad: '8BitDo 猎户座', phone: 'Xiaomi 14' },
  'zh-Hant': { headset: 'WH-1000XM5', mouse: 'MX Master 3S', keyboard: 'Keychron K3', gamepad: 'DualSense 無線控制器', phone: 'iPhone 15' },
};

/** The script of a locale tag: `zh-TW`, `zh-HK` and `zh-Hant` are Traditional; other `zh` Simplified. */
export function namesFor(locale: string): Names {
  const l = locale.toLowerCase();
  if (l.startsWith('zh')) return /hant|tw|hk|mo/.test(l) ? NAMES['zh-Hant']! : NAMES['zh-Hans']!;
  return NAMES[l.split('-')[0]!] ?? NAMES.en!;
}

export function demoData(now: number, locale: string): BatteryData {
  const n = namesFor(locale);
  const dev = (kind: Kind, name: string, level: number, charging: boolean, key: string, readers: Device['readers']): Device => ({ key, name, kind, level, charging, readers });
  const devices: Device[] = [
    dev('headset', n.headset, 72, true, 'bt:AC:80:0A:11:22:33', ['bluez', 'upower']),
    dev('mouse', n.mouse, 12, false, 'sys:hidpp_battery_0', ['upower', 'sysfs']),
    dev('keyboard', n.keyboard, 58, false, 'bt:DC:2C:26:44:55:66', ['upower', 'bluez']),
    dev('gamepad', n.gamepad, 31, false, 'bt:98:7A:14:77:88:99', ['sysfs']),
    dev('phone', n.phone, 84, false, 'kde:phone', ['kdeconnect']),
    dev('laptop', '', 67, false, 'sys:BAT0', ['upower', 'sysfs']),
  ];
  return {
    at: now,
    devices: sortDevices(devices, 15, 5),
    readers: [
      { reader: 'upower', state: 'ok', count: 4 },
      { reader: 'bluez', state: 'ok', count: 2 },
      { reader: 'sysfs', state: 'ok', count: 3 },
      { reader: 'kdeconnect', state: 'ok', count: 1 },
    ],
    levelWarn: 15,
    levelAlert: 5,
    fullScreen: true,
    episodes: {},
  };
}
