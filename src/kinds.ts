/**
 * Device kinds: what each reader calls them, a guess from the name when the
 * reader doesn't say, and the label shown for each.
 */
import type { Localized } from '@kiosko/sdk';
import { L } from './i18n.ts';
import type { Kind } from './types.ts';

export const KIND_LABELS: Record<Kind, Localized> = {
  headset: L('Headphones', 'Auriculares', 'Kopfhörer', '耳机', '耳機'),
  mouse: L('Mouse', 'Ratón', 'Maus', '鼠标', '滑鼠'),
  keyboard: L('Keyboard', 'Teclado', 'Tastatur', '键盘', '鍵盤'),
  gamepad: L('Controller', 'Mando', 'Controller', '手柄', '手把'),
  phone: L('Phone', 'Móvil', 'Handy', '手机', '手機'),
  laptop: L('Laptop', 'Portátil', 'Laptop', '笔记本电脑', '筆電'),
  tablet: L('Tablet', 'Tableta', 'Tablet', '平板', '平板'),
  pen: L('Pen', 'Lápiz', 'Stift', '手写笔', '觸控筆'),
  other: L('Device', 'Dispositivo', 'Gerät', '设备', '裝置'),
};

/**
 * UPower's `Type` property (a `u`), by number. From the UPower D-Bus API,
 * org.freedesktop.UPower.Device, property Type:
 * https://upower.freedesktop.org/docs/Device.html#Device:Type
 * 0 Unknown, 1 Line Power, 2 Battery, 3 Ups, 4 Monitor, 5 Mouse, 6 Keyboard,
 * 7 Pda, 8 Phone, 9 Media Player, 10 Tablet, 11 Computer, 12 Gaming Input,
 * 13 Pen, 14 Touchpad, 15 Modem, 16 Network, 17 Headset, 18 Speakers,
 * 19 Headphones, 20 Video, 21 Other Audio, 22 Remote Control, 23 Printer,
 * 24 Scanner, 25 Camera, 26 Wearable, 27 Toy, 28 Bluetooth Generic.
 */
export const UPOWER_TYPE: Record<number, Kind | 'line-power' | 'battery'> = {
  1: 'line-power',
  2: 'battery',
  5: 'mouse',
  6: 'keyboard',
  8: 'phone',
  10: 'tablet',
  12: 'gamepad',
  13: 'pen',
  14: 'mouse',
  17: 'headset',
  18: 'headset',
  19: 'headset',
  21: 'headset',
};

/**
 * The same kinds as `upower --dump` writes them (up_device_kind_to_string in
 * libupower-glib/up-types.c of UPower 1.91: "line-power", "battery",
 * "mouse", "keyboard", "phone", "tablet", "gaming-input", "pen", "touchpad",
 * "headset", "speakers", "headphones", "audio-device"…).
 */
export const UPOWER_KIND: Record<string, Kind | 'line-power' | 'battery'> = {
  'line-power': 'line-power',
  battery: 'battery',
  mouse: 'mouse',
  keyboard: 'keyboard',
  phone: 'phone',
  tablet: 'tablet',
  'gaming-input': 'gamepad',
  pen: 'pen',
  touchpad: 'mouse',
  headset: 'headset',
  speakers: 'headset',
  headphones: 'headset',
  'audio-device': 'headset',
};

/**
 * BlueZ's `Icon` of org.bluez.Device1: "a suggested icon name from the
 * freedesktop.org icon naming specification"
 * (https://github.com/bluez/bluez/blob/master/doc/org.bluez.Device.rst).
 * BlueZ derives it from the class of device or the GAP appearance
 * (src/dbus-common.c, class_to_icon / gap_appearance_to_icon).
 */
export function kindOfIcon(icon: string | undefined): Kind | undefined {
  switch (icon) {
    case 'audio-headset':
    case 'audio-headphones':
    case 'audio-card':
      return 'headset';
    case 'input-mouse':
      return 'mouse';
    case 'input-tablet':
      return 'pen';
    case 'input-keyboard':
      return 'keyboard';
    case 'input-gaming':
      return 'gamepad';
    case 'phone':
      return 'phone';
    case 'computer':
      return 'laptop';
    default:
      return undefined;
  }
}

/**
 * KDE Connect's device `type` (DeviceType::toString in core/deviceinfo.h:
 * "desktop", "laptop", "phone", "tablet", "tv", "unknown").
 */
export function kindOfKdeType(type: string | undefined): Kind {
  return type === 'phone' || type === 'smartphone' ? 'phone' : type === 'tablet' ? 'tablet' : type === 'laptop' ? 'laptop' : 'other';
}

/** Words in a device's name that say what it is, first match wins (headphones before phones). */
const BY_NAME: [RegExp, Kind][] = [
  [/head(set|phone)|ear(bud|phone|pod)|\bbuds\b|airpods|\bw[hf]-\d|beats|jabra|auricular|kopfh[öo]rer|耳[机機]/i, 'headset'],
  [/controller|gamepad|joy-?con|dualsense|dualshock|xbox|8bitdo|\bmando\b|手[柄把]/i, 'gamepad'],
  [/mouse|trackball|trackpad|mx (master|anywhere|ergo)|rat[óo]n|\bmaus\b|鼠|滑鼠/i, 'mouse'],
  [/keyboard|keychron|mx keys|teclado|tastatur|键盘|鍵盤/i, 'keyboard'],
  [/\bpen\b|stylus|pencil|手写笔|觸控筆/i, 'pen'],
  [/ipad|tablet|\btab\b/i, 'tablet'],
  [/phone|iphone|pixel|galaxy|手机|手機/i, 'phone'],
];

/** The kind a device's name suggests, when its reader doesn't say. */
export function guessKind(name: string): Kind {
  for (const [re, kind] of BY_NAME) if (re.test(name)) return kind;
  return 'other';
}
