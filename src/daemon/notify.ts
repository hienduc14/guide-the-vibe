// Best-effort desktop notifications (Windows balloon, macOS osascript, Linux notify-send).

import { spawn } from "node:child_process";

export function desktopNotify(title: string, body: string): void {
  const t = title.replace(/["'`$]/g, "").slice(0, 60);
  const b = body.replace(/["'`$]/g, "").replace(/\s+/g, " ").slice(0, 240);
  try {
    if (process.platform === "win32") {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(8000, '${t}', '${b}', 'Info'); Start-Sleep -Seconds 9; $n.Dispose()`;
      spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (process.platform === "darwin") {
      spawn("osascript", ["-e", `display notification "${b}" with title "${t}"`], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("notify-send", [t, b], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // notifications are optional
  }
}
