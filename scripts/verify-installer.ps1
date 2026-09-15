# Run elevated on a clean Windows test machine / GitHub Actions runner.
# Uses its own empty database. Refuses to touch an existing installed server.
param([string]$Installer = "$PSScriptRoot\..\dist\TaproomSignage-Setup-win-x64.exe")
$ErrorActionPreference = 'Stop'
$serverHome = Join-Path $env:ProgramData 'TaproomSignage'
$testInstall = Join-Path $env:ProgramFiles 'Taproom Signage Release Test'
$port = 18196
if ((Get-Service TaproomSignage -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath $serverHome) -or (Test-Path -LiteralPath $testInstall)) {
    throw 'Installer checks require a clean test machine: the service or test folders already exist.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this verification as administrator.' }
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Wait-Healthy {
    for ($i = 0; $i -lt 60; $i++) {
        try { if ((Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2).app -eq 'taproom-signage') { return } } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw 'Server did not recover within 30 seconds.'
}
function Run-Installer {
    $run = Start-Process -FilePath (Resolve-Path -LiteralPath $Installer) -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR="' + $testInstall + '"') -WindowStyle Hidden -Wait -PassThru
    Assert ($run.ExitCode -eq 0) "Installer failed: $($run.ExitCode). Check ProgramData\TaproomSignage\logs\setup-error.txt."
    Wait-Healthy
}
$owned = $false
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\..\windows\Setup-Server.ps1" -Action Prepare -InstallDir $testInstall
    Assert ($LASTEXITCODE -eq 0) 'Preparing isolated settings failed.'
    $owned = $true
    Set-Content -LiteralPath "$serverHome\release-test-owner" -Value 'Taproom installer verification'
    $password = 'Release-test-' + [guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText("$serverHome\settings\taproom.config", "port=$port`r`npassword=$password`r`ndata_dir=..\data`r`n", (New-Object Text.UTF8Encoding($false)))
    Run-Installer
    $svc = Get-CimInstance Win32_Service -Filter "Name='TaproomSignage'"
    Assert ($svc.StartName -eq 'NT AUTHORITY\LocalService') 'Service is not running as LocalService.'
    Assert ($svc.StartMode -eq 'Auto') 'Service is not automatic.'
    Assert ($svc.PathName -eq ('"' + $testInstall + '\TaproomServer.exe" --service')) 'Executable path is not quoted correctly.'
    Assert ((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\TaproomSignage').DelayedAutoStart -eq 1) 'Delayed boot startup not set.'
    $rules = @(Get-NetFirewallRule -Name 'TaproomSignage-HTTP','TaproomSignage-Discovery')
    Assert ($rules.Count -eq 2) 'Firewall rules missing.'
    foreach ($rule in $rules) {
        Assert ($rule.Profile -eq 'Any' -and $rule.Enabled -eq 'True') 'Firewall must support all profiles.'
        Assert (($rule | Get-NetFirewallApplicationFilter).Program -eq "$testInstall\node.exe") 'Firewall program scope is wrong.'
    }
    $addresses = (Get-NetFirewallRule -Name 'TaproomSignage-HTTP' | Get-NetFirewallAddressFilter).RemoteAddress
    Assert (($addresses -join ',') -match '10.0.0.0') 'Routed subnet scope missing.'
    $listen = Get-NetTCPConnection -State Listen -LocalPort $port
    Assert ($listen.LocalAddress -contains '0.0.0.0') 'Server is not listening on all IPv4 adapters.'
    # Verify the actual discovery responder, including its advertised fixed port.
    $udp = New-Object Net.Sockets.UdpClient
    try {
        $udp.Client.ReceiveTimeout = 3000
        $probe = [Text.Encoding]::UTF8.GetBytes('TAPROOM-DISCOVER/1')
        [void]$udp.Send($probe, $probe.Length, '127.0.0.1', 41234)
        $remote = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0)
        $reply = [Text.Encoding]::UTF8.GetString($udp.Receive([ref]$remote)) | ConvertFrom-Json
        Assert ($reply.proto -eq 'taproom/1' -and $reply.port -eq $port) 'Discovery advertised the wrong server port.'
    } finally { $udp.Dispose() }
    $configAcl = Get-Acl "$serverHome\settings"
    Assert ($configAcl.AreAccessRulesProtected) 'Password folder inherits public permissions.'
    Write-Output 'PASS: installation, quoted path, LocalService, automatic boot startup, all-interface TCP, UDP discovery and scoped firewall.'

    $node = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($svc.ProcessId)" | Where-Object Name -eq 'node.exe')
    Assert ($node.Count -eq 1) 'Expected exactly one Node child.'
    Stop-Process -Id $node[0].ProcessId -Force
    Start-Sleep -Milliseconds 1000
    Wait-Healthy
    $replacement = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($svc.ProcessId)" | Where-Object Name -eq 'node.exe')
    Assert ($replacement.Count -eq 1 -and $replacement[0].ProcessId -ne $node[0].ProcessId) 'Node did not restart.'
    Stop-Process -Id $svc.ProcessId -Force
    Start-Sleep -Milliseconds 1000
    Wait-Healthy
    Assert (-not (Get-Process -Id $replacement[0].ProcessId -ErrorAction SilentlyContinue)) 'Host crash left an orphaned Node process.'
    Write-Output 'PASS: Node crash recovery and service host crash recovery without orphan listeners.'

    Set-Content -LiteralPath "$serverHome\data\upgrade-marker.txt" -Value 'preserve this data'
    Run-Installer
    Assert ((Get-Content "$serverHome\data\upgrade-marker.txt") -eq 'preserve this data') 'Upgrade lost user data.'
    Assert ((Get-Content "$serverHome\settings\taproom.config" -Raw).Contains($password)) 'Upgrade lost the password.'
    Assert (@(Get-NetFirewallRule -Name 'TaproomSignage-HTTP','TaproomSignage-Discovery').Count -eq 2) 'Upgrade duplicated firewall rules.'
    Write-Output 'PASS: repeat installation preserves data/password and repairs the service and firewall.'

    $uninstall = Start-Process -FilePath "$testInstall\unins000.exe" -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -Wait -PassThru
    Assert ($uninstall.ExitCode -eq 0) 'Uninstaller failed.'
    Assert (-not (Get-Service TaproomSignage -ErrorAction SilentlyContinue)) 'Uninstall left the service.'
    Assert (-not (Get-NetFirewallRule -Name 'TaproomSignage-HTTP','TaproomSignage-Discovery' -ErrorAction SilentlyContinue)) 'Uninstall left firewall rules.'
    Assert (Test-Path "$serverHome\data\upgrade-marker.txt") 'Uninstall deleted user data.'
    Write-Output 'PASS: uninstall removes service/firewall and retains data.'
} finally {
    # Only clean directories created by this run, never an existing installation.
    if ($owned -and (Test-Path "$serverHome\release-test-owner")) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\..\windows\Setup-Server.ps1" -Action Uninstall -InstallDir $testInstall
        $resolvedHome = [IO.Path]::GetFullPath($serverHome)
        Assert ($resolvedHome -eq (Join-Path $env:ProgramData 'TaproomSignage')) 'Unexpected cleanup path.'
        Assert (-not ((Get-Item -LiteralPath $resolvedHome).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'Redirected cleanup path.'
        Remove-Item -LiteralPath $resolvedHome -Recurse -Force
        # An unsuccessful installer leaves files behind for diagnosis. Do not remove them.
    }
}
