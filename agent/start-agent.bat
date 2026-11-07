@echo off
setlocal
rem ---------------------------------------------------------------------------
rem RailServe print agent: start the agent that install-windows.ps1 installed,
rem without reinstalling it, and keep it running in the background.
rem
rem Save this file as   %USERPROFILE%\railserve-print-agent\start-agent.bat
rem (the folder the installer made, next to print-agent.mjs) and double-click
rem it. It:
rem   - checks the agent is installed (node, print-agent.mjs, .env, run-agent.ps1)
rem   - does nothing if the agent is already running, so there are never two
rem   - starts the installer's run-agent.ps1 loop with no window at all; that
rem     loop restarts the agent whenever it stops and keeps the PC awake
rem   - registers itself to run again, hidden, at every login (HKCU Run key,
rem     replacing the entry the installer wrote)
rem   - waits for "connected to server" in agent.log and shows the result
rem
rem The station token is NOT in this file: the agent reads it from the .env
rem next to it, which the installer wrote. Nothing here needs admin rights.
rem Plain ASCII on purpose; Notepad must not save it as UTF-8 with BOM.
rem
rem   start-agent.bat          start, show what happened, wait for a key
rem   start-agent.bat /quiet   same with no output and no waiting (login entry)
rem ---------------------------------------------------------------------------

set "AGENT_DIR=%~dp0"
set "AGENT_DIR=%AGENT_DIR:~0,-1%"
set "LOG=%AGENT_DIR%\agent.log"
set "VBS=%AGENT_DIR%\start-agent-hidden.vbs"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "WSCRIPT=%SystemRoot%\System32\wscript.exe"
set "RUN_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "RUN_NAME=RailServe Print Agent"
set "QUIET="
if /i "%~1"=="/quiet" set "QUIET=1"

rem --- 1. Is the agent installed here? ---------------------------------------
for %%f in (node\node.exe print-agent.mjs run-agent.ps1 run-agent.cmd .env) do (
    if not exist "%AGENT_DIR%\%%f" (
        call :say Missing "%AGENT_DIR%\%%f".
        call :say This file must sit in the folder the installer made, normally
        call :say %%USERPROFILE%%\railserve-print-agent. If that folder is gone, run the installer again.
        goto :fail
    )
)

rem --- 2. Already running? Then leave it alone. ------------------------------
rem Looks for the loop (powershell.exe running run-agent.ps1) or the agent
rem itself (node.exe running print-agent.mjs) started from THIS folder.
rem wmic is gone on newer Windows 11, so PowerShell does the looking.
"%PS%" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$d = $env:AGENT_DIR; $running = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and ($_.Name -eq 'node.exe' -or $_.Name -eq 'powershell.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf($d, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and ($_.CommandLine -like '*run-agent.ps1*' -or $_.CommandLine -like '*print-agent.mjs*') }; if ($running) { exit 3 }; exit 0"
if errorlevel 3 (
    call :say The print agent is already running. Nothing to do.
    call :say Log: %LOG%
    goto :done
)

rem --- 3. The windowless launcher, rewritten every time so it matches this file.
rem VBScript because it is the one thing on every Windows 10/11 that can start
rem a console program with its window hidden from the very first moment.
rem (powershell -WindowStyle Hidden hides its window only after opening it.)
rem Uses + for string joins so this batch file needs no escaping.
>"%VBS%"  echo ' RailServe print agent: runs a command with no window. Written by start-agent.bat.
>>"%VBS%" echo '   wscript start-agent-hidden.vbs        runs start-agent.bat /quiet hidden: the start-at-login entry
>>"%VBS%" echo '   wscript start-agent-hidden.vbs loop   runs run-agent.ps1 hidden: used by start-agent.bat
>>"%VBS%" echo Option Explicit
>>"%VBS%" echo Dim sh, here, ps, mode
>>"%VBS%" echo Set sh = CreateObject("WScript.Shell")
>>"%VBS%" echo here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
>>"%VBS%" echo ps = sh.ExpandEnvironmentStrings("%%SystemRoot%%") + "\System32\WindowsPowerShell\v1.0\powershell.exe"
>>"%VBS%" echo mode = ""
>>"%VBS%" echo If WScript.Arguments.Count = 1 Then mode = WScript.Arguments(0)
>>"%VBS%" echo If mode = "loop" Then
>>"%VBS%" echo     sh.Run """" + ps + """ -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ + here + "\run-agent.ps1""", 0, False
>>"%VBS%" echo Else
>>"%VBS%" echo     sh.Run "cmd.exe /c """"" + here + "\start-agent.bat"" /quiet""", 0, False
>>"%VBS%" echo End If

rem --- 4. Start the loop in the background. ----------------------------------
rem Remember where the log ends now, so only lines from THIS start count.
set "LOG_BEFORE="
for %%s in ("%LOG%") do set "LOG_BEFORE=%%~zs"
if not defined LOG_BEFORE set "LOG_BEFORE=0"

call :say Starting the print agent in the background...
"%WSCRIPT%" //B //Nologo "%VBS%" loop
if errorlevel 1 (
    call :say Could not start the agent: wscript.exe failed. Run the installer again.
    goto :fail
)

rem --- 5. Start again at every login, hidden. --------------------------------
rem Same value name the installer used, so its conhost.exe entry is replaced,
rem never doubled. HKCU, so no admin rights are needed.
reg add "%RUN_KEY%" /v "%RUN_NAME%" /t REG_SZ /d "\"%WSCRIPT%\" //B //Nologo \"%VBS%\"" /f >nul 2>&1
if errorlevel 1 call :say Warning: could not register the start-at-login entry. The agent is running now, but will not start by itself after a reboot.

if defined QUIET goto :done

rem --- 6. Wait for the agent to connect, and say what happened. --------------
set /a TRIES=0
:wait
"%PS%" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$text = ''; try { $s = [IO.File]::Open($env:LOG, 'Open', 'Read', 'ReadWrite'); try { $from = [long]$env:LOG_BEFORE; if ($s.Length -ge $from) { $s.Position = $from }; $text = [IO.StreamReader]::new($s).ReadToEnd() } finally { $s.Close() } } catch {}; if ($text -match 'HTTP 401') { exit 2 }; if ($text -match 'connected to server') { exit 0 }; exit 1"
if errorlevel 2 goto :rejected
if not errorlevel 1 goto :connected
set /a TRIES+=1
if %TRIES% geq 30 goto :notyet
timeout /t 1 /nobreak >nul
goto :wait

:connected
call :blank
call :say DONE. The print agent is running and connected to the server.
call :say   - KOTs now print by themselves when you press Generate KOT or Print in the app.
call :say   - It starts again by itself after every login. Keep this PC on and logged in.
call :say   - Log: %LOG%
goto :done

:rejected
call :blank
call :say The server rejected the station token in %AGENT_DIR%\.env. Ask the admin for the correct line and run the installer again.
goto :fail

:notyet
call :blank
call :say The agent is running but has not connected to the server yet. Last lines of the log:
"%PS%" -NoProfile -NonInteractive -Command "Get-Content -LiteralPath $env:LOG -Tail 5"
call :say Is this PC online? The agent keeps trying by itself; check the log again in a minute.
goto :fail

:done
if not defined QUIET pause
endlocal
exit /b 0

:fail
if not defined QUIET pause
endlocal
exit /b 1

:say
if not defined QUIET echo %*
exit /b 0

:blank
if not defined QUIET echo(
exit /b 0
