# Set up SSH access to a server from Windows: store the private key in ~/.ssh with owner-only access,
# record the server's host key in known_hosts, add a short alias to ~/.ssh/config, then test the login.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\ssh-setup.ps1 -HostIp <ip> [-User ubuntu] [-Port 2222] [-KeyPath <file>] [-Alias gtv-hoc]
# Afterwards: ssh gtv-hoc
param(
  [Parameter(Mandatory = $true)][string]$HostIp,
  [string]$User = "ubuntu",
  [string]$KeyPath = "$env:USERPROFILE\Desktop\ssh-key-2026-11-10.key",
  [string]$Alias = "gtv-hoc",
  [int]$Port = 2222
)
# Not "Stop": Windows PowerShell 5.1 turns any stderr line of ssh-keygen/ssh-keyscan into a terminating error.
$ErrorActionPreference = "Continue"

$sshDir = Join-Path $env:USERPROFILE ".ssh"
$keyDest = Join-Path $sshDir "$Alias.key"
$configPath = Join-Path $sshDir "config"
$knownHosts = Join-Path $sshDir "known_hosts"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir -ErrorAction Stop | Out-Null }

# 1) Key: copy into ~/.ssh and restrict it to the current user (OpenSSH refuses keys others can read).
if (-not (Test-Path $KeyPath)) { throw "Key not found: $KeyPath" }
# A copy left read-only by an earlier run: give the owner write access back so it can be replaced.
if (Test-Path $keyDest) { icacls $keyDest /grant:r "${env:USERNAME}:(F)" | Out-Null }
# Write LF line endings and a final newline: a key pasted into an editor often loses it, and OpenSSH then
# rejects the file as "not a key file".
$keyText = ([System.IO.File]::ReadAllText((Resolve-Path $KeyPath).Path) -replace "`r", "").TrimEnd() + "`n"
[System.IO.File]::WriteAllText($keyDest, $keyText, (New-Object System.Text.ASCIIEncoding))
icacls $keyDest /inheritance:r /grant:r "${env:USERNAME}:(F)" | Out-Null
$fp = ssh-keygen -l -f $keyDest 2>&1
if ($LASTEXITCODE -ne 0) { throw "Not a valid private key: $KeyPath ($fp)" }
Write-Host "[1/4] Key stored at $keyDest (only $env:USERNAME can read it): $fp"

# 2) known_hosts: fetch the server's host keys once, so later logins are checked against them.
$hostEntry = if ($Port -eq 22) { $HostIp } else { "[$HostIp]:$Port" }
$existing = $null
if (Test-Path $knownHosts) { $existing = ssh-keygen -F $hostEntry -f $knownHosts 2>$null }
if ($existing) {
  Write-Host "[2/4] $hostEntry is already in known_hosts"
} else {
  $scanned = ssh-keyscan -T 10 -p $Port -t ed25519,ecdsa,rsa $HostIp 2>$null | Where-Object { $_ -and -not $_.StartsWith("#") }
  if (-not $scanned) {
    # Windows' ssh-keyscan fails on some servers (unsupported key exchange); step 4 then records the key on first login.
    Write-Host "[2/4] ssh-keyscan got no host key from ${HostIp}:$Port; it will be saved on the first login in step 4"
  } else {
  Add-Content -Path $knownHosts -Value $scanned -Encoding ascii
  Write-Host "[2/4] Added host keys of $hostEntry to known_hosts. Fingerprints (ask the server owner to confirm):"
  $tmp = New-TemporaryFile
  [System.IO.File]::WriteAllLines($tmp, [string[]]$scanned, $utf8NoBom)
  ssh-keygen -l -f $tmp | ForEach-Object { Write-Host "      $_" }
  Remove-Item $tmp
  }
}

# 3) ~/.ssh/config: replace any earlier block for this alias, then append the new one.
$lines = @()
if (Test-Path $configPath) { $lines = [System.IO.File]::ReadAllLines($configPath) }
$kept = New-Object System.Collections.Generic.List[string]
$skip = $false
foreach ($line in $lines) {
  if ($line -match '^\s*Host\s+') { $skip = ($line -match "^\s*Host\s+$([regex]::Escape($Alias))\s*$") }
  if (-not $skip) { $kept.Add($line) }
}
while ($kept.Count -gt 0 -and $kept[$kept.Count - 1].Trim() -eq "") { $kept.RemoveAt($kept.Count - 1) }
if ($kept.Count -gt 0) { $kept.Add("") }
$kept.Add("Host $Alias")
$kept.Add("  HostName $HostIp")
$kept.Add("  User $User")
$kept.Add("  Port $Port")
$kept.Add("  IdentityFile ~/.ssh/$Alias.key")
$kept.Add("  IdentitiesOnly yes")
$kept.Add("  ServerAliveInterval 30")
[System.IO.File]::WriteAllLines($configPath, $kept.ToArray(), $utf8NoBom)
Write-Host "[3/4] Added 'Host $Alias' to $configPath"

# 4) Test the login without prompting.
Write-Host "[4/4] Testing: ssh $Alias"
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new $Alias "echo OK: logged in as `$(whoami) on `$(hostname)"
if ($LASTEXITCODE -eq 0) {
  Write-Host "Done. Connect with: ssh $Alias"
} else {
  Write-Host "Login failed (exit $LASTEXITCODE). Check the user name (-User) and that this key is authorized on the server."
  exit 1
}
