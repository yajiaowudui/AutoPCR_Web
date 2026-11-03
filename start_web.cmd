@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0" || goto failed

set "AUTOPCR_NODE=node.exe"
where node.exe >nul 2>&1
if errorlevel 1 set "AUTOPCR_NODE=%ProgramFiles%\nodejs\node.exe"
"%AUTOPCR_NODE%" --version >nul 2>&1
if errorlevel 1 (
    echo Node.js was not found. Install Node.js, then double-click this file again.
    goto failed
)

if not exist "node_modules\vite\bin\vite.js" (
    echo Vite is missing. Install the project dependencies, then try again.
    goto failed
)

if not defined AUTOPCR_SERVER_HOST set "AUTOPCR_SERVER_HOST=http://127.0.0.1:8080"
echo Starting AutoPCR Web at http://localhost:5173/daily/arena/
echo Backend: %AUTOPCR_SERVER_HOST%
echo Keep this window open. Press Ctrl+C to stop.
"%AUTOPCR_NODE%" "node_modules\vite\bin\vite.js" --host localhost --port 5173 --strictPort --open /daily/arena/
if errorlevel 1 goto failed
exit /b 0

:failed
echo AutoPCR Web could not start. Check the message above.
pause
exit /b 1
