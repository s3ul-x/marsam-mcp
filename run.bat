@echo off
setlocal EnableExtensions
title Marsam MCP - Painting Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "node_modules\" (
  echo.
  echo [Marsam MCP] First run: installing the studio dependencies, please wait...
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 goto install_failed
)

echo.
echo [Marsam MCP] Starting the painting studio on http://localhost:3000
echo [Marsam MCP] Close this window to stop the app.
echo.
start "" /min cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:3000"
call npm run dev
echo.
echo [Marsam MCP] Server stopped.
pause
exit /b 0

:no_node
echo.
echo [Marsam MCP] Node.js was not found.
echo Install Node.js 20 or newer from https://nodejs.org and run this file again.
echo.
pause
exit /b 1

:install_failed
echo.
echo [Marsam MCP] Could not install dependencies. Check the internet connection and try again.
echo.
pause
exit /b 1
