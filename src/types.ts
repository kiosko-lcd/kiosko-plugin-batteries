/** What a device is, for its icon and its label. */
export type Kind = 'headset' | 'mouse' | 'keyboard' | 'gamepad' | 'phone' | 'laptop' | 'tablet' | 'pen' | 'other';

export const KINDS: readonly Kind[] = ['headset', 'mouse', 'keyboard', 'gamepad', 'phone', 'laptop', 'tablet', 'pen', 'other'];

/**
 * Some devices only say roughly how full they are (UPower's `BatteryLevel`,
 * the kernel's `capacity_level`): then the percentage is not known.
 */
export type Coarse = 'critical' | 'low' | 'normal' | 'high' | 'full';

/** Where a reading comes from. */
export type ReaderId = 'upower' | 'bluez' | 'sysfs' | 'kdeconnect' | 'windows' | 'macos';

export const READERS: readonly ReaderId[] = ['upower', 'bluez', 'sysfs', 'kdeconnect', 'windows', 'macos'];

/** One battery as one reader sees it. */
export interface Reading {
  reader: ReaderId;
  /** The reader's own id (a D-Bus path, a sysfs name, a PnP instance id). */
  id: string;
  name: string;
  kind: Kind;
  /** 0–100, or null when only `coarse` is known. */
  level: number | null;
  coarse?: Coarse;
  /** null: the reader doesn't say. */
  charging: boolean | null;
  /** Bluetooth address, upper case with colons, when the reader knows it: the same device seen by two readers is merged by it. */
  address?: string;
  /** The kernel's name for it (`BAT0`, `hidpp_battery_0`): UPower and sysfs give the same one. */
  native?: string;
  /** Serial number, when there is no address. */
  serial?: string;
}

/** One device on the panel, after merging what every reader saw. */
export interface Device {
  /** Stable while it is the same device: the address, the serial or the kind and name. */
  key: string;
  name: string;
  kind: Kind;
  level: number | null;
  coarse?: Coarse;
  charging: boolean | null;
  /** Readers that saw it, the one its data comes from first. */
  readers: ReaderId[];
}

export interface ReaderStatus {
  reader: ReaderId;
  /** `ok`: it ran (maybe finding nothing); `off`: not on this system, or turned off; `error`: it failed. */
  state: 'ok' | 'off' | 'error';
  count: number;
  message?: string;
}

/** What the source hands to the widgets. Plain data. */
export interface BatteryData {
  at: number;
  devices: Device[];
  readers: ReaderStatus[];
  /** The source's thresholds, so every widget colours the same. */
  levelWarn: number;
  levelAlert: number;
  /** Full-screen alerts at `levelAlert` are on. */
  fullScreen: boolean;
  /** Device key → when its current discharge went under `levelAlert` (the alert's id). */
  episodes: Record<string, number>;
}
