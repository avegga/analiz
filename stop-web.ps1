param(
    [int[]]$Ports = @(5173, 8001)
)

$ErrorActionPreference = "Stop"

$stopped = @()

foreach ($port in $Ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($processId in $connections) {
        try {
            Stop-Process -Id $processId -Force -ErrorAction Stop
            $stopped += [pscustomobject]@{ Port = $port; Pid = $processId }
        }
        catch {
        }
    }
}

if ($stopped.Count -eq 0) {
    Write-Host "No running web processes found on ports: $($Ports -join ', ')"
}
else {
    $stopped | Sort-Object Port, Pid | ForEach-Object {
        Write-Host "Stopped PID $($_.Pid) on port $($_.Port)"
    }
}