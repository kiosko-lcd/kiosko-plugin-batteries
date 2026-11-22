# Fixtures

What the readers get back, for the parsers' tests. Line endings are kept as
they are (`.gitattributes`).

| File | What | Where its shape comes from |
|---|---|---|
| `upower-getall-display.json`, `upower-enumerate-empty.json`, `upower-dump-desktop.txt` | A desktop with no batteries | Captured on Ubuntu (UPower 1.91.1, systemd 259 `busctl --json=short`), as they came |
| `upower-getall-*.json`, `upower-enumerate.json` | A laptop with a Logitech mouse, a Bluetooth headset and keyboard | busctl's JSON as captured above; property names, types and enums from the UPower D-Bus API (upower.freedesktop.org/docs/Device.html) |
| `upower-dump-laptop.txt` | The same, as `upower --dump` (LC_ALL=C) | `up_device_to_text` in libupower-glib/up-device.c (UPower 1.91.5): which lines each kind gets, `%g%%`, "(should be ignored)" |
| `bluez-managed-objects.json` | Two connected devices with org.bluez.Battery1, one paired but off | Captured from BlueZ on this machine (paired, disconnected headsets), addresses and names replaced, Battery1 as in doc/org.bluez.Battery.rst |
| `kdeconnect-*.json` | A phone with KDE Connect | busctl's JSON; names and types from kdeconnect-kde core/daemon.h, core/device.h, core/deviceinfo.h, plugins/battery/batteryplugin.{h,cpp} |
| `windows-*.json` | The PowerShell script's output | ConvertTo-Json of the script in src/windows.ts; one battery comes out as an object, not a list |
| `ioreg-battery.xml` | `ioreg -r -k BatteryPercent -a` | Apple's XML plist; keys `Product`, `BatteryPercent` as Apple's HID services publish them (the same entry can appear twice) |
| `pmset-*.txt` | `pmset -g batt` | pmset(1); the InternalBattery line with its tab |
| `system-profiler-bluetooth.json` | `system_profiler SPBluetoothDataType -json` (macOS 12+) | `device_connected` / `device_batteryLevelMain`, AirPods' Left/Right/Case |
