/**
 * The battery of your gadgets on the panel: Bluetooth headphones, mouse,
 * keyboard, game controller, the laptop and the phone, from what the system
 * already knows, with a warning before one runs out.
 */
import { definePlugin } from '@kiosko/sdk';
import { L, LANGUAGES } from './i18n.ts';
import { devicesSource } from './source.ts';
import { WIDGETS } from './widgets.ts';

export { devicesSource } from './source.ts';
export { list, low } from './widgets.ts';

export default definePlugin({
  id: 'batteries',
  name: L('Batteries', 'Baterías', 'Akkus', '电池', '電池'),
  version: '0.1.0',
  description: L(
    'The battery of your gadgets on the panel: Bluetooth headphones, mouse, keyboard, game controller, the laptop and the phone, with a warning before one runs out.',
    'La batería de tus cacharros en el panel: auriculares Bluetooth, ratón, teclado, mando, el portátil y el móvil, con un aviso antes de que uno se quede sin batería.',
    'Der Akku deiner Geräte auf dem Panel: Bluetooth-Kopfhörer, Maus, Tastatur, Controller, der Laptop und das Handy, mit einer Warnung, bevor einer leer ist.',
    '在副屏上查看各种设备的电量：蓝牙耳机、鼠标、键盘、手柄、笔记本电脑和手机，快没电前提醒你。',
    '在面板上查看各種裝置的電量：藍牙耳機、滑鼠、鍵盤、手把、筆電和手機，快沒電前提醒你。',
  ),
  author: 'Loksly',
  license: 'MIT',
  homepage: 'https://github.com/kiosko-lcd/kiosko-plugin-batteries#readme',
  repository: 'https://github.com/kiosko-lcd/kiosko-plugin-batteries',
  icon: 'battery-medium',
  sdk: '^0.2.0',
  platforms: ['linux', 'darwin', 'win32'],
  languages: LANGUAGES,
  permissions: {
    exec: ['busctl', 'upower', 'powershell', 'ioreg', 'pmset', 'system_profiler'],
    files: ['/sys/class/power_supply'],
    devices: ['upower', 'bluetooth', 'kdeconnect'],
  },
  resources: { memoryMb: 10, cpu: 'low' },
  widgets: WIDGETS,
  sources: [devicesSource],
});
