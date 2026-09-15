# Run after build-windows.mjs. Uses an isolated copy and never registers startup.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$package = Join-Path $repo 'dist\TaproomSignage'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('taproom-launcher-test-' + [guid]::NewGuid().ToString('N'))
$runtime = Join-Path $scratch 'runtime'
$savedData = Join-Path $scratch 'saved-content'
$launcher = $null
$child = $null
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
foreach ($name in @('TaproomSignage.exe', 'node.exe', 'app')) {
    Copy-Item -LiteralPath (Join-Path $package $name) -Destination $runtime -Recurse
}
@("port=18197", "password=launcher-test", "data_dir=$savedData") | Set-Content -LiteralPath (Join-Path $runtime 'taproom.config') -Encoding UTF8
function Wait-Healthy {
    for ($i = 0; $i -lt 80; $i++) {
        if ($launcher.HasExited) { throw 'Launcher exited before server became healthy' }
        $portFile = Join-Path $savedData 'port'
        if (Test-Path -LiteralPath $portFile) {
            $port = (Get-Content -LiteralPath $portFile -Raw).Trim()
            try {
                $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 1
                if ($health.ok -and $health.app -eq 'taproom-signage') { return $port }
            } catch { }
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Server did not become healthy; logs: $runtime\logs\server.log"
}
try {
    if (Get-Process -Name TaproomSignage -ErrorAction SilentlyContinue) { throw 'Quit the running tray app before this isolated test.' }
    $entry = Join-Path $runtime 'app\src\server.js'
    Move-Item -LiteralPath $entry -Destination ($entry + '.pending')
    # Simulate sign-in: launch by absolute path from an unrelated working folder.
    $launcher = Start-Process -FilePath (Join-Path $runtime 'TaproomSignage.exe') -ArgumentList '--startup' -WorkingDirectory $env:WINDIR -WindowStyle Hidden -PassThru
    $logFile = Join-Path $runtime 'logs\server.log'
    for ($i = 0; $i -lt 40; $i++) {
        if ((Test-Path -LiteralPath $logFile) -and (Select-String -LiteralPath $logFile -SimpleMatch 'is missing' -Quiet)) { break }
        Start-Sleep -Milliseconds 250
    }
    if (!(Test-Path -LiteralPath $logFile) -or !(Select-String -LiteralPath $logFile -SimpleMatch 'is missing' -Quiet)) { throw 'Missing app was not reported' }
    Move-Item -LiteralPath ($entry + '.pending') -Destination $entry
    $port = Wait-Healthy
    Write-Output 'PASS: initial startup failure retried successfully after missing file was restored'
    if (!(Test-Path -LiteralPath (Join-Path $savedData 'signage.db'))) { throw 'Custom data directory was not used' }
    if (Test-Path -LiteralPath (Join-Path $runtime 'data')) { throw 'Unexpected default data directory' }
    Write-Output "PASS: sign-in-style launch from unrelated directory, configured data folder, HTTP health on $port"
    $duplicate = Start-Process -FilePath (Join-Path $runtime 'TaproomSignage.exe') -ArgumentList '--startup' -WindowStyle Hidden -PassThru
    if (!$duplicate.WaitForExit(5000)) { Stop-Process -Id $duplicate.Id; throw 'Duplicate startup launch did not exit silently' }
    Write-Output 'PASS: duplicate startup invocation exits'
    $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launcher.Id)" | Where-Object Name -eq 'node.exe'
    if (!$child) { throw 'No supervised Node child found' }
    $oldId = $child.ProcessId
    Stop-Process -Id $oldId -Force
    for ($i = 0; $i -lt 80; $i++) {
        Start-Sleep -Milliseconds 250
        $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launcher.Id)" | Where-Object Name -eq 'node.exe'
        if ($child -and $child.ProcessId -ne $oldId) { break }
    }
    if (!$child -or $child.ProcessId -eq $oldId) { throw 'Launcher failed to replace crashed Node child' }
    $port = Wait-Healthy
    Write-Output "PASS: killed Node child was restarted automatically and HTTP health recovered on $port"
} finally {
    if ($launcher) {
        Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue
        Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launcher.Id)" | Where-Object Name -eq 'node.exe' | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Output "Isolated test files and logs: $scratch"
}
