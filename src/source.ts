/**
 * The `batteries/devices` source: runs the readers of this system every
 * minute, merges what they see, applies the user's hides and names, keeps
 * the low-battery episodes and gives the widgets plain data.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineSource, matchFilter, t } from '@kiosko/sdk';
import { demoData } from './demo.ts';
import { advanceEpisodes, batteryAlerts, type Episodes } from './episodes.ts';
import { L } from './i18n.ts';
import { applyUserChoices, mergeReadings, sortDevices } from './merge.ts';
import { execRun, readAll, type Run } from './readers.ts';
import type { BatteryData } from './types.ts';

export const sourceOptions = t.object({
  levelWarn: t.integer({
    default: 15,
    min: 0,
    max: 100,
    unit: '%',
    label: L('Low at', 'Baja a partir de', 'Niedrig ab', '低电量阈值', '低電量門檻'),
    help: L(
      'Under this level a device turns amber and goes to the top of the list.',
      'Por debajo de este nivel un dispositivo se pone ámbar y sube al principio de la lista.',
      'Unter diesem Stand wird ein Gerät gelb und rückt an den Anfang der Liste.',
      '低于此电量时，设备显示为琥珀色并排到列表最前。',
      '低於此電量時，裝置顯示為琥珀色並排到清單最前面。',
    ),
  }),
  levelAlert: t.integer({
    default: 5,
    min: 0,
    max: 100,
    unit: '%',
    label: L('Almost empty at', 'Casi vacía a partir de', 'Fast leer ab', '电量告急阈值', '電量告急門檻'),
    help: L(
      'Under this level a device turns red and, if full-screen alerts are on, shows one once per discharge.',
      'Por debajo de este nivel un dispositivo se pone rojo y, si los avisos a pantalla completa están activados, muestra uno una vez por descarga.',
      'Unter diesem Stand wird ein Gerät rot und zeigt, wenn Vollbild-Warnungen an sind, einmal pro Entladung eine.',
      '低于此电量时，设备显示为红色；若开启全屏提醒，每次放电只提醒一次。',
      '低於此電量時，裝置顯示為紅色；若開啟全螢幕提醒，每次放電只提醒一次。',
    ),
  }),
  showAlerts: t.boolean({
    default: true,
    label: L('Full-screen alert when almost empty', 'Aviso a pantalla completa cuando esté casi vacía', 'Vollbild-Warnung, wenn fast leer', '电量告急时全屏提醒', '電量告急時全螢幕提醒'),
  }),
  devices: t.filter({
    label: L('Devices', 'Dispositivos', 'Geräte', '设备', '裝置'),
    help: L(
      'Which devices to show, by name or kind: mouse, keyboard, headset, gamepad, phone, laptop; !Xbox* leaves one out. Empty: all.',
      'Qué dispositivos mostrar, por nombre o tipo: mouse, keyboard, headset, gamepad, phone, laptop; !Xbox* quita uno. Vacío: todos.',
      'Welche Geräte gezeigt werden, nach Name oder Art: mouse, keyboard, headset, gamepad, phone, laptop; !Xbox* lässt eines weg. Leer: alle.',
      '按名称或类型选择要显示的设备：mouse、keyboard、headset、gamepad、phone、laptop；用 !Xbox* 排除某个。留空：全部。',
      '依名稱或類型選擇要顯示的裝置：mouse、keyboard、headset、gamepad、phone、laptop；用 !Xbox* 排除某個。留空：全部。',
    ),
    choices: { source: 'batteries/devices', list: 'devices' },
  }),
  names: t.map({
    label: L('Names', 'Nombres', 'Namen', '名称', '名稱'),
    help: L(
      'Your own names: the name a reader gives (or the device key) → the name to show. "MX Master 3S" → "Mouse".',
      'Tus nombres: el que da el sistema (o la clave del dispositivo) → el que mostrar. "MX Master 3S" → "Ratón".',
      'Eigene Namen: der Name vom System (oder der Geräteschlüssel) → der angezeigte Name. "MX Master 3S" → "Maus".',
      '自定义名称：系统给出的名称（或设备键）→ 要显示的名称。"MX Master 3S" → "鼠标"。',
      '自訂名稱：系統給的名稱（或裝置鍵）→ 要顯示的名稱。"MX Master 3S" → "滑鼠"。',
    ),
    advanced: true,
  }),
  readers: t.filter({
    label: L('Readers', 'Lectores', 'Quellen', '读取方式', '讀取方式'),
    help: L(
      'Which to ask: upower, bluez, sysfs, kdeconnect (Linux), windows, macos; !sysfs leaves one out. Empty: every one this system has.',
      'A cuáles preguntar: upower, bluez, sysfs, kdeconnect (Linux), windows, macos; !sysfs quita uno. Vacío: todos los que haya en este sistema.',
      'Welche gefragt werden: upower, bluez, sysfs, kdeconnect (Linux), windows, macos; !sysfs lässt eine weg. Leer: alle, die dieses System hat.',
      '要读取哪些：upower、bluez、sysfs、kdeconnect（Linux）、windows、macos；用 !sysfs 排除某个。留空：本系统有的全部。',
      '要讀取哪些：upower、bluez、sysfs、kdeconnect（Linux）、windows、macos；用 !sysfs 排除某個。留空：本系統有的全部。',
    ),
    advanced: true,
  }),
});

type Options = {
  levelWarn: number;
  levelAlert: number;
  showAlerts: boolean;
  devices: string[];
  names: Record<string, string>;
  readers: string[];
};

export interface ReadDeps {
  run?: Run;
  platform?: NodeJS.Platform;
  sysfsRoot?: string;
  /** Episodes kept between reads (and restarts). */
  episodes: { load(): Promise<Episodes>; save(e: Episodes): Promise<void> };
}

/** One read, with everything it touches passed in (tests give fakes). */
export async function readBatteries(o: Options, ctx: { now: number; signal: AbortSignal; timeoutMs: number; log?: (m: string) => void }, deps: ReadDeps): Promise<BatteryData> {
  const results = await readAll(
    {
      run: deps.run ?? execRun,
      platform: deps.platform ?? process.platform,
      sysfsRoot: deps.sysfsRoot ?? '/sys/class/power_supply',
      signal: ctx.signal,
      // Each command gets a share of the read's budget, so one stuck reader can't eat the rest.
      timeoutMs: Math.max(3000, Math.min(20_000, ctx.timeoutMs - 2000)),
    },
    (id) => matchFilter(id, o.readers),
  );
  for (const r of results) if (r.status.state === 'error') ctx.log?.(`batteries/${r.status.reader}: ${r.status.message}`);
  const devices = sortDevices(applyUserChoices(mergeReadings(results.flatMap((r) => r.readings)), o), o.levelWarn, o.levelAlert);
  const prev = await deps.episodes.load();
  const next = advanceEpisodes(prev, devices, o.levelAlert, ctx.now);
  if (JSON.stringify(prev) !== JSON.stringify(next)) await deps.episodes.save(next);
  return {
    at: ctx.now,
    devices,
    readers: results.map((r) => r.status),
    levelWarn: o.levelWarn,
    levelAlert: o.levelAlert,
    fullScreen: o.showAlerts,
    episodes: Object.fromEntries(Object.entries(next).map(([k, e]) => [k, e.since])),
  };
}

/** Episodes in memory, and in `dataDir/episodes.json` so a restart doesn't alert again. */
function episodeStore(dataDir: string): ReadDeps['episodes'] {
  let cache: Episodes | undefined;
  const file = join(dataDir, 'episodes.json');
  return {
    async load() {
      if (cache) return cache;
      try {
        cache = JSON.parse(await readFile(file, 'utf8')) as Episodes;
      } catch {
        cache = {};
      }
      return cache;
    },
    async save(e) {
      cache = e;
      try {
        await mkdir(dataDir, { recursive: true });
        await writeFile(file, JSON.stringify(e));
      } catch {
        /* kept in memory */
      }
    },
  };
}

const stores = new Map<string, ReadDeps['episodes']>();

export const devicesSource = defineSource({
  id: 'devices',
  name: L('Batteries', 'Baterías', 'Akkus', '电池', '電池'),
  description: L(
    'The battery of your Bluetooth headphones, mouse, keyboard, controllers, laptop and phone, from what the system already knows: UPower, BlueZ and the kernel on Linux, KDE Connect for the phone, PowerShell on Windows, ioreg, pmset and system_profiler on macOS. Nothing to set up.',
    'La batería de tus auriculares Bluetooth, ratón, teclado, mandos, portátil y móvil, a partir de lo que el sistema ya sabe: UPower, BlueZ y el kernel en Linux, KDE Connect para el móvil, PowerShell en Windows, ioreg, pmset y system_profiler en macOS. Nada que configurar.',
    'Der Akku deiner Bluetooth-Kopfhörer, Maus, Tastatur, Controller, deines Laptops und Handys, aus dem, was das System schon weiß: UPower, BlueZ und der Kernel unter Linux, KDE Connect fürs Handy, PowerShell unter Windows, ioreg, pmset und system_profiler unter macOS. Nichts einzurichten.',
    '蓝牙耳机、鼠标、键盘、手柄、笔记本电脑和手机的电量，来自系统已有的信息：Linux 上的 UPower、BlueZ 和内核，手机用 KDE Connect，Windows 上的 PowerShell，macOS 上的 ioreg、pmset 和 system_profiler。无需设置。',
    '藍牙耳機、滑鼠、鍵盤、手把、筆電和手機的電量，來自系統已有的資訊：Linux 上的 UPower、BlueZ 和核心，手機用 KDE Connect，Windows 上的 PowerShell，macOS 上的 ioreg、pmset 和 system_profiler。無需設定。',
  ),
  options: sourceOptions,
  intervalMs: 60_000,
  minIntervalMs: 15_000,
  timeoutMs: 30_000,
  background: true,
  async read(ctx) {
    let episodes = stores.get(ctx.dataDir);
    if (!episodes) stores.set(ctx.dataDir, (episodes = episodeStore(ctx.dataDir)));
    return readBatteries(ctx.options as Options, ctx, { episodes });
  },
  demo: ({ now, locale }) => demoData(now, locale),
  alerts: ({ data }) => batteryAlerts(data),
  choices: {
    devices: (data) => data.devices.map((d) => ({ value: d.name || d.key, group: d.kind })),
  },
});
