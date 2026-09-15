# Invoked by Setup with elevation. Also supports administrator firewall repair.
[CmdletBinding()]
param(
    [ValidateSet('Prepare', 'Install', 'Uninstall')][string]$Action = 'Install',
    [string]$InstallDir = $PSScriptRoot,
    [string[]]$RemoteAddress = @('LocalSubnet', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10')
)
$ErrorActionPreference = 'Stop'
$serverHome = Join-Path $env:ProgramData 'TaproomSignage'
$serviceName = 'TaproomSignage'
$ruleNames = @('TaproomSignage-HTTP', 'TaproomSignage-Discovery')
function Invoke-Sc([string[]]$Arguments) {
    & "$env:SystemRoot\System32\sc.exe" @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Service configuration failed ($LASTEXITCODE): $($Arguments[0])" }
}
function Assert-PlainPath([string]$Path) {
    $checkPath = [IO.Path]::GetFullPath($Path)
    while ($checkPath) {
        if ((Test-Path -LiteralPath $checkPath) -and ((Get-Item -LiteralPath $checkPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Cannot install through a redirected folder: $checkPath"
        }
        $checkPath = Split-Path -Parent $checkPath
    }
}
function Set-PrivateAcl([string]$Path, [bool]$PublicRead = $false) {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($entry in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'), @('S-1-5-19','Modify'))) {
        $sid = New-Object Security.Principal.SecurityIdentifier($entry[0])
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, $entry[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    if ($PublicRead) {
        $sid = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
try {
    Assert-PlainPath $serverHome
    Assert-PlainPath $InstallDir
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service) {
        Stop-Service -Name $serviceName -Force
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    if ($Action -eq 'Uninstall') {
        if ($service) { Invoke-Sc @('delete', $serviceName) }
        foreach ($ruleName in $ruleNames) { Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
        Write-Output 'Removed service and firewall rules. Saved data and settings were retained in ProgramData\TaproomSignage.'
        exit 0
    }
    foreach ($folder in @($serverHome, "$serverHome\data", "$serverHome\logs", "$serverHome\settings")) {
        Assert-PlainPath $folder
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        Set-PrivateAcl $folder ($folder -eq $serverHome)
    }
    if ($Action -eq 'Prepare') { exit 0 }
    # The settings directory has no ordinary-user access. No password travels on
    # a command line or in installer logs. The service receives it via environment.
    $configPath = Join-Path $serverHome 'settings\taproom.config'
    $config = @{}
    foreach ($line in Get-Content -LiteralPath $configPath -Encoding UTF8) {
        if ($line -match '^([a-z_]+)=(.*)$') { $config[$matches[1]] = $matches[2] }
    }
    $port = 0
    if (-not [int]::TryParse($config.port, [ref]$port) -or $port -lt 1024 -or $port -gt 65535) { throw 'Choose a port from 1024 to 65535 in Setup.' }
    if (-not $config.password -or $config.password.Trim().Length -lt 10 -or $config.password -eq 'changeme') { throw 'Set a password of at least 10 characters in Setup.' }
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $port)
    $listener.Server.ExclusiveAddressUse = $true
    try { $listener.Start() } catch { throw "TCP port $port is busy or reserved by Windows. Run Setup again and choose another port. $($_.Exception.Message)" } finally { $listener.Stop() }
    $discoverySocket = New-Object Net.Sockets.UdpClient
    try {
        $discoverySocket.Client.ExclusiveAddressUse = $true
        $discoverySocket.Client.Bind((New-Object Net.IPEndPoint([Net.IPAddress]::Any, 41234)))
    } catch { throw 'UDP discovery port 41234 is already in use. Quit any portable Taproom tray app or other menu server, then run Setup again.' }
    finally { $discoverySocket.Dispose() }
    $binary = '"' + (Join-Path $InstallDir 'TaproomServer.exe') + '" --service'
    if (-not $service) { New-Service -Name $serviceName -BinaryPathName $binary -StartupType Automatic -DisplayName 'Taproom Signage Server' | Out-Null }
    # Structured arguments preserve the executable quotes in paths with spaces.
    $change = Invoke-CimMethod -InputObject (Get-CimInstance Win32_Service -Filter "Name='$serviceName'") -MethodName Change -Arguments @{
        PathName = $binary; StartName = 'NT AUTHORITY\LocalService'; StartPassword = ''; StartMode = 'Automatic'
    }
    if ($change.ReturnValue -ne 0) { throw "Could not configure service account/path: $($change.ReturnValue)" }
    Invoke-Sc @('config', $serviceName, 'start=', 'delayed-auto')
    Invoke-Sc @('description', $serviceName, 'Serves menus, posters and TV controls. Starts before Windows sign-in.')
    Invoke-Sc @('failure', $serviceName, 'reset=', '86400', 'actions=', 'restart/5000/restart/15000/restart/60000')
    Invoke-Sc @('failureflag', $serviceName, '1')
    # Replace only our named rules. Any profile includes Public Wi-Fi and domain
    # networks; private routed ranges allow TVs beyond the immediate subnet.
    foreach ($ruleName in $ruleNames) { Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
    $node = Join-Path $InstallDir 'node.exe'
    New-NetFirewallRule -Name $ruleNames[0] -DisplayName 'Taproom Signage - menus and controls' -Direction Inbound -Action Allow -Enabled True -Profile Any -Program $node -Protocol TCP -LocalPort $port -RemoteAddress $RemoteAddress | Out-Null
    New-NetFirewallRule -Name $ruleNames[1] -DisplayName 'Taproom Signage - TV discovery' -Direction Inbound -Action Allow -Enabled True -Profile Any -Program $node -Protocol UDP -LocalPort 41234 -RemoteAddress $RemoteAddress | Out-Null
    Start-Service -Name $serviceName
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
            if ($health.app -eq 'taproom-signage') { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "The server did not become ready. See $serverHome\logs\server.log. Domain policy or endpoint security may require your IT administrator." }
    Write-Output "Server ready on TCP $port. Firewall rules installed for private routed networks on all Windows profiles."
    exit 0
} catch {
    $message = $_.Exception.Message
    if (Test-Path -LiteralPath "$serverHome\logs") { $message | Set-Content -LiteralPath "$serverHome\logs\setup-error.txt" -Encoding UTF8 }
    Write-Error $message -ErrorAction Continue
    exit 1
}
