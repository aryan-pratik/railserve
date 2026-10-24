# RailServe print agent: one-line install for a kitchen Windows PC.
#
# Open PowerShell on the PC that prints to the kitchen printer (Start, type
# PowerShell, Enter) and paste:
#
#   [Net.ServicePointManager]::SecurityProtocol = 'Tls12'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/aryan-pratik/railserve/main/agent/install-windows.ps1))) "<AGENT_TOKEN>"
#
# A second argument picks the printer when the PC has several, or gives a
# network printer's IP address when it is not installed on the PC:
#
#   ... "<AGENT_TOKEN>" "POS-80"
#   ... "<AGENT_TOKEN>" "192.168.1.50"
#
# and `... -Uninstall` removes everything again.
#
# Windows 10 or 11 (Node 22 runs on nothing older). Needs no admin rights. It
# puts its own copy of Node and the agent in %USERPROFILE%\railserve-print-agent,
# prints two test tickets, and registers the agent to start at login.
# See agent/README.md.
#
# Plain ASCII on purpose: Windows PowerShell 5.1 reads a file without a BOM
# in the computer's own code page.

param([string]$Token, [string]$Printer, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-Setting([string]$name, [string]$default) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { return $value }
    return $default
}

$ServerUrl = Get-Setting 'SERVER_URL' 'https://bitestation.elvo.in'
$AgentSource = Get-Setting 'AGENT_SOURCE' 'https://raw.githubusercontent.com/aryan-pratik/railserve/main/agent'
$AgentDir = Get-Setting 'AGENT_DIR' (Join-Path $env:USERPROFILE 'railserve-print-agent')
$NodeDist = 'https://nodejs.org/dist/latest-v22.x'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName = 'RailServe Print Agent'
$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# The classic console window, which -WindowStyle Hidden can hide. Windows 11's
# default Terminal ignores it and would leave a window for staff to close.
$ConhostExe = Join-Path $env:SystemRoot 'System32\conhost.exe'

function Say([string]$text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Die([string]$text) { throw $text }

function Get-Url([string]$url, [string]$file) {
    Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
}

function Write-Ascii([string]$file, [string]$text) {
    # No BOM: the agent's .env reader would take it for part of the first key.
    [System.IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding $false))
}

# The wrapper first, or it starts the agent again straight away.
function Stop-Agent {
    $mine = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -ne $PID -and $_.CommandLine -and
        $_.CommandLine.IndexOf($AgentDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    $wrappers = @($mine | Where-Object { $_.Name -eq 'powershell.exe' })
    $others = @($mine | Where-Object { $_.Name -ne 'powershell.exe' })
    foreach ($p in ($wrappers + $others)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    if ($mine.Count -gt 0) { Start-Sleep -Seconds 2 }
}

function Remove-Agent {
    Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
    Stop-Agent
    if (Test-Path $AgentDir) { Remove-Item -Recurse -Force $AgentDir }
    Say 'Print agent removed.'
}

# Printers that only exist on screen, never in the kitchen.
function Test-RealPrinter($p) {
    if ($p.Name -match 'PDF|XPS|OneNote|Fax') { return $false }
    if ($p.PortName -match '^(PORTPROMPT:|nul:|FILE:|SHRFAX:|XPSPort:)') { return $false }
    return $true
}

# A network printer's address, when its port is a plain raw TCP/IP one.
function Get-RawAddress($p) {
    $port = Get-PrinterPort -Name $p.PortName -ErrorAction SilentlyContinue
    if (-not $port -or -not $port.PrinterHostAddress) { return $null }
    # Protocol 1 is RAW; 2 is LPR, which does not take raw bytes on 9100.
    if ($port.Protocol -and [int]$port.Protocol -ne 1) { return $null }
    $number = 9100
    if ($port.PortNumber) { $number = [int]$port.PortNumber }
    return @{ Host = [string]$port.PrinterHostAddress; Port = $number }
}

function Test-Reachable([string]$address, [int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect($address, $port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne(3000)) { return $false }
        $client.EndConnect($attempt)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# Returns @{ Queue = name } or @{ Host = ip; Port = n }.
function Select-Printer([string]$wanted) {
    if ($wanted -match '^\d{1,3}(\.\d{1,3}){3}$') { return @{ Host = $wanted; Port = 9100 } }

    $all = @(Get-Printer | Where-Object { Test-RealPrinter $_ })
    $names = ($all | ForEach-Object { '"' + $_.Name + '"' }) -join ', '

    if ($wanted) {
        $chosen = $all | Where-Object { $_.Name -eq $wanted } | Select-Object -First 1
        if (-not $chosen) { Die "No printer called `"$wanted`" on this PC. Installed printers: $names" }
    } elseif ($all.Count -eq 1) {
        $chosen = $all[0]
    } elseif ($all.Count -eq 0) {
        Die "This PC has no printer installed. Add the kitchen printer in Settings > Printers first, or add the printer's IP address at the end of the line."
    } else {
        Write-Host ''
        Write-Host "This PC has several printers: $names"
        Die "Run the same line again with the kitchen printer's name added at the end, in quotes."
    }

    # A printer on the network is reached at its address, the way the agent
    # has always printed by IP; one on USB goes through the Windows queue.
    $raw = Get-RawAddress $chosen
    if ($raw) {
        $raw.Name = $chosen.Name
        return $raw
    }
    return @{ Queue = $chosen.Name }
}

function Install-Node {
    $node = Join-Path $AgentDir 'node\node.exe'
    if (Test-Path $node) {
        & $node -v *> $null
        if ($LASTEXITCODE -eq 0) { return }
    }

    $cpu = $env:PROCESSOR_ARCHITEW6432
    if (-not $cpu) { $cpu = $env:PROCESSOR_ARCHITECTURE }
    switch ($cpu) {
        'AMD64' { $arch = 'x64' }
        'ARM64' { $arch = 'arm64' }
        'x86' { $arch = 'x86' }
        default { Die "Unsupported PC type: $cpu" }
    }

    Say 'Downloading Node (about 35 MB)'
    $sums = Join-Path $AgentDir 'node-sums.txt'
    try { Get-Url "$NodeDist/SHASUMS256.txt" $sums } catch { Die 'Could not reach nodejs.org. Is this PC online?' }
    $file = $null
    $sum = $null
    foreach ($line in [System.IO.File]::ReadAllLines($sums)) {
        $parts = $line -split '\s+'
        if ($parts.Count -ge 2 -and $parts[1] -like "node-v*-win-$arch.zip") {
            $sum = $parts[0]
            $file = $parts[1]
            break
        }
    }
    if (-not $file) { Die 'Could not find a Node download for this PC.' }

    $zip = Join-Path $AgentDir 'node.zip'
    try { Get-Url "$NodeDist/$file" $zip } catch { Die 'Node download failed.' }
    if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $sum.ToUpperInvariant()) {
        Die 'Node download was corrupted. Run the line again.'
    }

    # The zip holds one folder, node-v22...-win-x64; it becomes node\.
    $unpacked = Join-Path $AgentDir 'node-unpacked'
    if (Test-Path $unpacked) { Remove-Item -Recurse -Force $unpacked }
    if (Test-Path (Join-Path $AgentDir 'node')) { Remove-Item -Recurse -Force (Join-Path $AgentDir 'node') }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpacked)
    $inner = Get-ChildItem $unpacked | Select-Object -First 1
    Move-Item $inner.FullName (Join-Path $AgentDir 'node')
    Remove-Item -Recurse -Force $unpacked
    Remove-Item -Force $zip, $sums
}

# Runs a program to the end and returns its exit code. Start-Process, not &:
# Windows PowerShell can turn a line a program writes to stderr into an error
# that stops this script. Reading Handle first is what makes ExitCode stick.
function Invoke-Program([string]$file, [string[]]$arguments, [hashtable]$more) {
    if (-not $more) { $more = @{} }
    $p = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $AgentDir -NoNewWindow -PassThru @more
    $null = $p.Handle
    $p.WaitForExit()
    return $p.ExitCode
}

function Read-Log([string]$file) {
    if (-not (Test-Path $file)) { return '' }
    # The running agent holds the log open for writing.
    try {
        $stream = [System.IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
        try { return (New-Object System.IO.StreamReader $stream).ReadToEnd() } finally { $stream.Close() }
    } catch {
        return ''
    }
}

function Install-Agent {
    if ([Environment]::OSVersion.Version.Major -lt 10) {
        Die 'This PC runs a Windows older than 10. The print agent needs Windows 10 or 11.'
    }
    if (-not (Get-Command Get-Printer -ErrorAction SilentlyContinue)) {
        Die 'This Windows has no printer commands (Get-Printer). Use Windows 10 or 11 desktop.'
    }
    if ($Uninstall -or $Token -eq '--uninstall' -or $Token -eq 'uninstall') {
        Remove-Agent
        return
    }
    if (-not $Token) { Die "The station's agent token is missing. Paste the whole line you were sent, including the part in quotes." }

    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $target = Select-Printer $Printer
    if ($target.Queue) {
        Say "Kitchen printer: $($target.Queue) (through the Windows print queue)"
    } else {
        $label = "$($target.Host):$($target.Port)"
        if ($target.Name) { $label = "$($target.Name) at $label" }
        Say "Kitchen printer: $label"
        if (-not (Test-Reachable $target.Host $target.Port)) {
            Die "Cannot reach the printer at $($target.Host):$($target.Port). Is it switched on and on the same Wi-Fi as this PC?"
        }
    }

    # Stop a previous install before replacing its files.
    Stop-Agent
    New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null

    Install-Node
    $nodeDir = Join-Path $AgentDir 'node'
    $node = Join-Path $nodeDir 'node.exe'
    $env:Path = "$nodeDir;$env:Path"

    Say 'Installing the print agent'
    foreach ($f in 'print-agent.mjs', 'package.json', 'package-lock.json', 'win-print.ps1') {
        try { Get-Url "$AgentSource/$f" (Join-Path $AgentDir $f) } catch { Die "Could not download $f." }
    }
    $npmLogs = @{
        RedirectStandardOutput = (Join-Path $AgentDir 'npm.log')
        RedirectStandardError = (Join-Path $AgentDir 'npm-errors.log')
    }
    $code = Invoke-Program (Join-Path $nodeDir 'npm.cmd') @('ci', '--omit=dev', '--no-audit', '--no-fund') $npmLogs
    if ($code -ne 0) { Die "npm install failed. See $AgentDir\npm-errors.log" }

    $envText = "SERVER_URL=`"$ServerUrl`"`nAGENT_TOKEN=`"$Token`"`n"
    if ($target.Queue) {
        $envText += "PRINTER_QUEUE=`"$($target.Queue)`"`n"
    } else {
        $envText += "PRINTER_HOST=`"$($target.Host)`"`nPRINTER_PORT=`"$($target.Port)`"`n"
    }
    Write-Ascii (Join-Path $AgentDir '.env') $envText

    $retry = 'Check the printer is on and has paper, then run the line again.'
    if ($target.Queue) {
        $retry += " If the printer is on Wi-Fi or a network cable, add its IP address at the end of the line instead."
    }

    Say 'Printing two test tickets'
    if ((Invoke-Program $node @('print-agent.mjs', '--test')) -ne 0) { Die "The test print did not go through. $retry" }

    Write-Host ''
    $answer = Read-Host 'Did TWO SEPARATE pieces of paper come out? Type y or n, then Enter'
    if ($answer -notmatch '^(y|yes)$') {
        Die 'Not installed. Tell the admin what came out of the printer (a photo helps).'
    }

    Say 'Starting the agent (it will start by itself after every login)'
    $log = Join-Path $AgentDir 'agent.log'
    Write-Ascii $log ''

    # One run of the agent, its output appended to the log.
    Write-Ascii (Join-Path $AgentDir 'run-agent.cmd') ("@echo off`r`n" +
        "`"%~dp0node\node.exe`" `"%~dp0print-agent.mjs`" >> `"%~dp0agent.log`" 2>&1`r`n")

    # What launchd's KeepAlive and caffeinate do on the Mac: run the agent
    # again whenever it stops, and keep the PC from going to sleep meanwhile.
    Write-Ascii (Join-Path $AgentDir 'run-agent.ps1') @'
# RailServe print agent. Started hidden at every login by the Run entry the
# installer added; restarts the agent whenever it stops, and keeps the PC
# from sleeping while it runs. Remove with the installer's -Uninstall.
Add-Type -Namespace RailServe -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED
[void][RailServe.Power]::SetThreadExecutionState([uint32]2147483649)
while ($true) {
    & (Join-Path $PSScriptRoot 'run-agent.cmd')
    Start-Sleep -Seconds 10
}
'@

    $wrapper = "`"$PowerShellExe`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $AgentDir 'run-agent.ps1')`""
    # Never New-Item -Force here: on the registry it empties an existing key,
    # taking every other program's start-at-login entry with it.
    if (-not (Test-Path $RunKey)) { New-Item -Path $RunKey | Out-Null }
    New-ItemProperty -Path $RunKey -Name $RunName -Value "`"$ConhostExe`" $wrapper" -PropertyType String -Force | Out-Null
    Start-Process -FilePath $ConhostExe -ArgumentList $wrapper -WindowStyle Hidden

    # Only the background copy counts: it is the one that will be running tomorrow.
    $waited = 0
    while ((Read-Log $log) -notmatch 'connected to server') {
        if ((Read-Log $log) -match 'HTTP 401') {
            Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
            Stop-Agent
            Die 'The server rejected the token. Ask the admin for the correct line.'
        }
        $waited++
        if ($waited -ge 30) {
            Write-Host ((Read-Log $log) -split "`n" | Select-Object -Last 5 | Out-String)
            Die "The agent started but could not reach $ServerUrl. Is this PC online?"
        }
        Start-Sleep -Seconds 1
    }

    Write-Host ''
    Write-Host 'DONE. The print agent is running.' -ForegroundColor Green
    Write-Host '  - KOTs now print by themselves, each one cut, when you press Generate KOT or Print in the app.'
    Write-Host '  - Do not use Ctrl+P for KOTs any more: it prints a second copy as one long strip.'
    Write-Host '  - Keep this PC switched on and logged in while the kitchen is working.'
    Write-Host "  - Log: $log"
}

# No `exit` anywhere: pasted into PowerShell, it would close the window and
# take the error message with it.
try {
    Install-Agent
} catch {
    Write-Host ''
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
