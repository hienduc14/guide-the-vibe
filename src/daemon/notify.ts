// Best-effort desktop notifications (Windows balloon, macOS osascript, Linux notify-send).
// Missing tools must never crash the daemon: spawn errors arrive asynchronously, so they are swallowed
// on the child's "error" event. Set GTV_NO_NOTIFY=1 to disable notifications entirely.

import { spawn } from "node:child_process";

function fire(cmd: string, args: string[], windowsHide = false): void {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide });
  child.on("error", () => undefined);
  child.unref();
}

export function desktopNotify(title: string, body: string): void {
  if (process.env.GTV_NO_NOTIFY) return;
  const t = title.replace(/["'`$]/g, "").slice(0, 60);
  const b = body
    .replace(/["'`$]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 240);
  try {
    if (process.platform === "win32") {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(8000, '${t}', '${b}', 'Info'); Start-Sleep -Seconds 9; $n.Dispose()`;
      fire("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], true);
    } else if (process.platform === "darwin") {
      fire("osascript", ["-e", `display notification "${b}" with title "${t}"`]);
    } else {
      fire("notify-send", [t, b]);
    }
  } catch {
    // notifications are optional
  }
}
