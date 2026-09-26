# Inspect the installed-service tray UI without starting/stopping a server.
param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $Executable).Path)
$type = $assembly.GetType('Taproom.InstalledTray', $true)
$flags = [Reflection.BindingFlags]'Instance,NonPublic'
$signal = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset)
$context = $null
try {
    $constructor = $type.GetConstructor([type[]]@([Threading.EventWaitHandle], [bool]))
    $context = $constructor.Invoke([object[]]@($signal.PSObject.BaseObject, $false))
    $tray = $type.GetField('tray', $flags).GetValue($context)
    if (-not $tray.Visible -or -not $tray.Icon) { throw 'Installed tray icon was not initialized and made visible.' }
    if ($type.GetField('window', $flags).GetValue($context)) { throw 'Tray-only startup created a connection window.' }
    $menu = $type.GetField('menu', $flags).GetValue($context)
    foreach ($label in @('Open control app', 'Server addresses', 'Refresh status', 'Exit tray icon (server keeps running)')) {
        if (-not @($menu.Items | Where-Object Text -eq $label).Count) { throw "Missing tray action: $label" }
    }
    $timer = $type.GetField('timer', $flags).GetValue($context)
    if (-not $timer.Enabled) { throw 'Tray status monitoring did not start.' }
    $context.ExitThread()
    if ($tray.Visible) { throw 'Exiting left the notification icon visible.' }
    $context.Dispose(); $context = $null
    Write-Output 'PASS: installed tray icon visibility, menu actions, background startup, status timer and exit cleanup.'
} finally {
    if ($context) { $context.ExitThread(); $context.Dispose() }
    $signal.Dispose()
}
