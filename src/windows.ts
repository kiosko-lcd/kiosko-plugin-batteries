/**
 * Windows: one PowerShell run (Windows PowerShell 5.1, which every Windows
 * 10 and 11 has, with its PnpDevice and CimCmdlets modules) that prints JSON.
 *
 * - Bluetooth devices: the device property `{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2`
 *   of the present Bluetooth device nodes (instance ids `BTHENUM\…`,
 *   `BTHLE\…`, `BTHLEDEVICE\…`, `BTHHFENUM\…`), read with
 *   Get-PnpDeviceProperty (https://learn.microsoft.com/en-us/powershell/module/pnpdevice/get-pnpdeviceproperty,
 *   which takes a key as "{GUID} pid"). It is the battery level, a byte in
 *   percent, that Windows shows in Settings → Bluetooth & devices: what
 *   Device Manager lists as "Bluetooth battery level" (not in the SDK's
 *   devpkey.h; see https://learn.microsoft.com/en-us/answers/questions/1272102/how-to-get-bluetooth-battery-percentage-in-powersh).
 *   Hands-free headsets and Bluetooth LE devices with the Battery Service
 *   report it; devices whose level only their vendor's app knows don't.
 * - The laptop's battery: Win32_Battery
 *   (https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-battery),
 *   EstimatedChargeRemaining (percent) and BatteryStatus.
 */
import { guessKind } from './kinds.ts';
import { addressIn, clampLevel } from './linux.ts';
import type { Reading } from './types.ts';

export const BT_BATTERY_KEY = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2';

/** The script, written to print `{"bluetooth":[{name,id,level}],"batteries":[{Name,DeviceID,EstimatedChargeRemaining,BatteryStatus}]}`. */
export const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$ProgressPreference = \'SilentlyContinue\'',
  `$key = '${BT_BATTERY_KEY}'`,
  "$devs = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE|BTHLEDEVICE|BTHHFENUM)\\\\' })",
  '$names = @{}; foreach ($d in $devs) { $names[$d.InstanceId] = $d.FriendlyName }',
  '$bt = @(if ($devs.Count) { $devs | Get-PnpDeviceProperty -KeyName $key | Where-Object { $_.Data -ne $null } | ForEach-Object { [pscustomobject]@{ name = $names[$_.InstanceId]; id = $_.InstanceId; level = [int]$_.Data } } })',
  '$bat = @(Get-CimInstance -ClassName Win32_Battery | Select-Object Name, DeviceID, EstimatedChargeRemaining, BatteryStatus)',
  '[pscustomobject]@{ bluetooth = $bt; batteries = $bat } | ConvertTo-Json -Depth 4 -Compress',
].join('; ');

/** ConvertTo-Json writes a list of one as the object alone, and none as null. */
const list = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * BatteryStatus of Win32_Battery: 1 discharging, 2 on AC "not necessarily
 * charging", 3 fully charged, 4 low, 5 critical, 6 charging, 7 charging and
 * high, 8 charging and low, 9 charging and critical, 10 undefined,
 * 11 partially charged.
 */
function charging(status: number | undefined): boolean | null {
  if (status === 6 || status === 7 || status === 8 || status === 9) return true;
  if (status === 1 || status === 3 || status === 4 || status === 5) return false;
  return null;
}

/** A Bluetooth address in a PnP instance id: `…\DEV_AABBCCDDEEFF\…`, `…&0&AABBCCDDEEFF_C00000000`, `…_AABBCCDDEEFF\…`. */
export function addressOfInstance(id: string): string | undefined {
  const m = /(?:DEV_|&|_)([0-9A-F]{12})(?=_|\\|$)/i.exec(id);
  return m ? addressIn(m[1]!.match(/../g)!.join(':')) : undefined;
}

/** Windows names a device's profile nodes after it: "WH-1000XM5 Hands-Free AG", "… Avrcp Transport", "… Stereo". */
export const cleanName = (n: string): string => n.trim().replace(/\s+(Hands-Free( AG)?( Audio)?|Avrcp Transport|Stereo)$/i, '').trim();

interface Out {
  bluetooth?: { name?: string; id?: string; level?: number } | { name?: string; id?: string; level?: number }[] | null;
  batteries?: { Name?: string; DeviceID?: string; EstimatedChargeRemaining?: number; BatteryStatus?: number } | { Name?: string; DeviceID?: string; EstimatedChargeRemaining?: number; BatteryStatus?: number }[] | null;
}

export function parseWindows(json: string): Reading[] {
  const text = json.replace(/^﻿/, '').trim();
  if (!text) return [];
  const o = JSON.parse(text) as Out;
  const out: Reading[] = [];
  const byAddress = new Map<string, Reading>();
  const byName = new Map<string, Reading>();
  for (const b of list(o.bluetooth)) {
    if (typeof b.level !== 'number' || !b.id) continue;
    const name = cleanName(b.name ?? '');
    const address = addressOfInstance(b.id);
    // One device has several nodes (one per profile, named after it): keep one, by address or name.
    const prev = (address && byAddress.get(address)) || (name && byName.get(name.toLowerCase()));
    if (prev) {
      if (!prev.name && name) prev.name = name;
      if (!prev.address && address) {
        prev.address = address;
        byAddress.set(address, prev);
      }
      continue;
    }
    const r: Reading = { reader: 'windows', id: b.id, name, kind: guessKind(name), level: clampLevel(b.level), charging: null };
    if (address) {
      r.address = address;
      byAddress.set(address, r);
    }
    if (name) byName.set(name.toLowerCase(), r);
    out.push(r);
  }
  for (const b of list(o.batteries)) {
    if (typeof b.EstimatedChargeRemaining !== 'number') continue;
    out.push({ reader: 'windows', id: `Win32_Battery:${b.DeviceID ?? b.Name ?? out.length}`, name: '', kind: 'laptop', level: clampLevel(b.EstimatedChargeRemaining), charging: charging(b.BatteryStatus) });
  }
  return out;
}
