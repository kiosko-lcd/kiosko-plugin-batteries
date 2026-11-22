## Where the levels come from

Every reader asks something the system already has, read-only, about once a
minute (batteries change slowly). A reader that isn't on your system is
skipped; the same device seen by two readers is shown once (merged by its
Bluetooth address, its kernel name or its serial).

| Reader (`readers`) | System | What it sees | How |
|---|---|---|---|
| `upower` | Linux | The laptop, and most wireless mice, keyboards, headsets and controllers: UPower gathers the kernel's HID batteries, Logitech receivers and BlueZ's levels | [UPower's D-Bus API](https://upower.freedesktop.org/docs/Device.html) (`Percentage`, `BatteryLevel`, `State`, `Type`, `Model`, `IsPresent`) with `busctl --json`; `upower --dump` where busctl is too old |
| `bluez` | Linux | Bluetooth devices that report their battery (the GATT Battery Service, headsets over HFP) | [org.bluez.Battery1](https://github.com/bluez/bluez/blob/master/doc/org.bluez.Battery.rst) and [Device1](https://github.com/bluez/bluez/blob/master/doc/org.bluez.Device.rst), one `GetManagedObjects` call |
| `sysfs` | Linux | The laptop and HID batteries (`hid-…-battery`, `hidpp_battery_*`, `ps-controller-battery-*`…), when UPower isn't running | [/sys/class/power_supply](https://www.kernel.org/doc/Documentation/ABI/testing/sysfs-class-power) |
| `kdeconnect` | Linux | Your phone or tablet, paired with [KDE Connect](https://kdeconnect.kde.org) and its Battery plugin on | `org.kde.kdeconnect.device.battery` (`charge`, `isCharging`) on the session bus |
| `windows` | Windows 10, 11 | Bluetooth devices whose level Windows shows in Settings → Bluetooth & devices; the laptop's battery | Windows PowerShell: the device property `{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2` with [Get-PnpDeviceProperty](https://learn.microsoft.com/en-us/powershell/module/pnpdevice/get-pnpdeviceproperty), and [Win32_Battery](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-battery) |
| `macos` | macOS | Apple's Magic Mouse, Keyboard and Trackpad and many Bluetooth HID devices; AirPods and other headphones; the Mac's battery | `ioreg -r -k BatteryPercent -a`, `system_profiler SPBluetoothDataType -json` and `pmset -g batt` |

What none of them can see: devices whose level only their maker's app knows
(some gaming mice and headsets with their own dongle), and on Windows the
phone (KDE Connect for Windows keeps its own bus).

A few devices only say roughly how full they are (UPower's `BatteryLevel`,
the kernel's `capacity_level`): they show *Low*, *OK*, *Full* instead of a
percentage, and *Low* and *Critical* count as under the thresholds.

## Low and almost empty

- Under **Low at** (`levelWarn`, 15 % by default) a device turns amber and
  goes to the top of the list; the *Low batteries* widget shows it.
- Under **Almost empty at** (`levelAlert`, 5 %) it turns red, *Low
  batteries* keeps its tile, and, with **Full-screen alert when almost
  empty** on, Kiosko shows an amber full-screen alert, **once per
  discharge**: once you say *Seen* (or after 15 minutes) it doesn't come
  back until the device has been charged (or rises 5 points over the line)
  and runs down again. A restart doesn't repeat it. A device charging is
  never low. Quiet hours let only critical alerts through, so a mouse never
  wakes you up.

The source can run with no tile for its alerts alone: Settings → Data
sources → Batteries → *Watch for alerts without a widget*. Full-screen
alerts need Kiosko 0.2.7 or later; older ones show the widgets only.

## Names and hiding

- **Devices** (`devices`): `!Xbox*` hides a device, `mouse, keyboard` shows
  only those kinds (`headset`, `mouse`, `keyboard`, `gamepad`, `phone`,
  `laptop`, `tablet`, `pen`, `other`).
- **Names** (`names`): `"MX Master 3S" → "Mouse"`. A device with no name
  (the laptop's battery) is called by its kind.

Nothing leaves your machine: no network, no files written but the plugin's
own record of which device has already been alerted.
