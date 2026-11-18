$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)

if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy Bypass",
    "-File `"$PSCommandPath`""
  )
  exit
}

$profiles = Get-NetConnectionProfile
foreach ($profile in $profiles) {
  if ($profile.InterfaceAlias -like "*Wi-Fi*" -or $profile.InterfaceAlias -like "*Wireless*") {
    try {
      Set-NetConnectionProfile -InterfaceIndex $profile.InterfaceIndex -NetworkCategory Private
    } catch {
      Write-Warning "Could not change the Wi-Fi profile: $($_.Exception.Message)"
    }
  }
}

Remove-NetFirewallRule -DisplayName "Remote PC Signaling" -ErrorAction SilentlyContinue
New-NetFirewallRule `
  -DisplayName "Remote PC Signaling" `
  -Description "Allow phone browser access to TCP port 8787" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8787 `
  -Action Allow `
  -Profile Any `
  -Enabled True | Out-Null

Write-Host "Remote PC firewall access enabled."
Write-Host "Open http://192.168.1.34:8787/app on the phone."
Read-Host "Press Enter to close"
