# One-time setup on the menu server PC: lets the office laptop update this server
# over SSH, so app updates no longer need a download and Setup on this PC.
#
# Run in PowerShell opened with "Run as administrator". Normally fetched from the
# laptop by scripts/serve-direct-line-setup.mjs, which fills in the two values below.
# It can also be run from a USB stick:
#   powershell -ExecutionPolicy Bypass -File Enable-DirectLine.ps1 -PublicKey "ssh-ed25519 AAAA... name"
#
# What it changes:
#   - Installs and starts the Windows "OpenSSH Server" feature (service: sshd).
#   - Allows sign-in only with the supplied key (password sign-in over SSH is turned off).
#   - Allows SSH (TCP 22) only from the local network (LocalSubnet by default).
#   - Uses Windows PowerShell for remote commands.
# Undo: Settings > System > Optional features > OpenSSH Server > Uninstall.
param(
    [string]$PublicKey = '__TAPROOM_PUBLIC_KEY__',
    [string]$ReportUrl = '__TAPROOM_REPORT_URL__',
    [string[]]$AllowFrom = @('LocalSubnet')
)
& {
    $ErrorActionPreference = 'Stop'
    function Say([string]$text) { Write-Host "  $text" }
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Open PowerShell with "Run as administrator", then run this again.'
    }
    if ($PublicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]{60,} ?.*$') { throw 'Missing or invalid laptop public key.' }

    Write-Host ''
    Write-Host 'Taproom Signage - direct line for updates' -ForegroundColor Cyan

    # 1. OpenSSH Server (built into Windows 10/11 and Server 2019+ as an optional feature).
    if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
        Say 'Installing OpenSSH Server (this can take a few minutes)...'
        $capability = Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*' | Select-Object -First 1
        try {
            if (-not $capability) { throw 'OpenSSH Server is not offered by this Windows version.' }
            Add-WindowsCapability -Online -Name $capability.Name | Out-Null
        } catch {
            Say "Windows feature install failed ($($_.Exception.Message)). Trying winget..."
            winget install --id Microsoft.OpenSSH.Preview -e --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Null
        }
        if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) { throw 'OpenSSH Server could not be installed. Check Windows Update / internet access and try again.' }
    } else { Say 'OpenSSH Server is already installed.' }

    # First start creates host keys and the default configuration.
    Set-Service sshd -StartupType Automatic
    Start-Service sshd
    $sshDir = Join-Path $env:ProgramData 'ssh'
    $config = Join-Path $sshDir 'sshd_config'
    for ($i = 0; $i -lt 20 -and -not (Test-Path $config); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Path $config)) { throw "sshd did not create $config." }

    # 2. Key-only sign-in. Administrators read keys from administrators_authorized_keys.
    $keys = Join-Path $sshDir 'administrators_authorized_keys'
    $existing = if (Test-Path $keys) { @(Get-Content $keys) } else { @() }
    $keyBody = ($PublicKey -split ' ')[1]
    if (-not ($existing | Where-Object { $_ -match [regex]::Escape($keyBody) })) {
        Add-Content -Path $keys -Value $PublicKey -Encoding ascii
    }
    # sshd ignores this file unless only Administrators and SYSTEM can access it.
    & icacls.exe $keys /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not secure administrators_authorized_keys.' }

    $lines = [Collections.Generic.List[string]](Get-Content $config)
    $set = {
        param($name, $value)
        $index = -1
        for ($n = 0; $n -lt $lines.Count; $n++) {
            if ($lines[$n] -match '^\s*Match\s') { break }   # only edit global settings
            if ($lines[$n] -match "^\s*#?\s*$name\s") { $index = $n; break }
        }
        if ($index -ge 0) { $lines[$index] = "$name $value" } else { $lines.Insert(0, "$name $value") }
    }
    & $set 'PubkeyAuthentication' 'yes'
    & $set 'PasswordAuthentication' 'no'
    if (-not ($lines | Where-Object { $_ -match '^\s*Match Group administrators' })) {
        $lines.Add('Match Group administrators')
        $lines.Add('       AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys')
    }
    Set-Content -Path $config -Value $lines -Encoding ascii

    # 3. PowerShell for remote commands.
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
    New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value $powershell -PropertyType String -Force | Out-Null

    # 4. Firewall: SSH from the local network only, on any network profile.
    $rule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH SSH Server (sshd)' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow | Out-Null
    }
    Set-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -Enabled True -Profile Any -RemoteAddress $AllowFrom

    Restart-Service sshd
    $user = $env:USERNAME
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object IPAddress)
    $taproom = Get-Service TaproomSignage -ErrorAction SilentlyContinue

    Write-Host ''
    Write-Host '  Done. The laptop can now update this server.' -ForegroundColor Green
    Say "Account: $user   Computer: $env:COMPUTERNAME   Address: $($addresses -join ', ')"
    Say "Menu server service: $(if ($taproom) { $taproom.Status } else { 'not found' })"

    if ($ReportUrl -match '^http://') {
        try {
            $body = @{ user = $user; computer = $env:COMPUTERNAME; addresses = $addresses; taproomService = "$($taproom.Status)" } | ConvertTo-Json -Compress
            Invoke-RestMethod -Method Post -Uri $ReportUrl -Body $body -ContentType 'application/json' -TimeoutSec 10 | Out-Null
            Say 'The laptop has been told setup finished. You can close this window.'
        } catch {
            Say "Could not notify the laptop ($($_.Exception.Message)). Tell it the account name: $user"
        }
    }
}
