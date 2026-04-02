param(
    [string]$HostAddress = "127.0.0.1",
    [int]$FrontendPort = 5173,
    [int]$BackendPort = 8001
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe = Join-Path $rootDir ".venv\Scripts\python.exe"
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"

if (-not (Test-Path $pythonExe)) {
    throw "Python virtual environment not found: $pythonExe"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is not available in PATH"
}

$backendJob = Start-Job -Name "analiz-backend" -ArgumentList $backendDir, $pythonExe, $HostAddress, $BackendPort -ScriptBlock {
    param($backendDir, $pythonExe, $hostAddress, $backendPort)

    Set-Location $backendDir
    & $pythonExe -m uvicorn src.main:app --host $hostAddress --port $backendPort
}

$frontendJob = Start-Job -Name "analiz-frontend" -ArgumentList $frontendDir, $HostAddress, $FrontendPort -ScriptBlock {
    param($frontendDir, $hostAddress, $frontendPort)

    Set-Location $frontendDir
    npm run dev -- --host $hostAddress --port $frontendPort --strictPort
}

$jobs = @($backendJob, $frontendJob)
$offsets = @{}

Write-Host "Backend: http://$HostAddress`:$BackendPort"
Write-Host "Frontend: http://$HostAddress`:$FrontendPort"
Write-Host "Press Ctrl+C to stop both services."

try {
    while ($true) {
        foreach ($job in $jobs) {
            $output = @(Receive-Job -Job $job -Keep -ErrorAction SilentlyContinue)

            if (-not $offsets.ContainsKey($job.Id)) {
                $offsets[$job.Id] = 0
            }

            $startIndex = [int]$offsets[$job.Id]
            if ($output.Count -gt $startIndex) {
                for ($i = $startIndex; $i -lt $output.Count; $i++) {
                    Write-Host "[$($job.Name)] $($output[$i])"
                }
                $offsets[$job.Id] = $output.Count
            }

            if ($job.State -in @("Completed", "Failed", "Stopped")) {
                throw "Job '$($job.Name)' exited with state '$($job.State)'"
            }
        }

        Start-Sleep -Milliseconds 500
    }
}
finally {
    foreach ($job in $jobs) {
        if ($job.State -eq "Running") {
            Stop-Job -Job $job -ErrorAction SilentlyContinue
        }
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
}