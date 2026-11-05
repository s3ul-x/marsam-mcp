@echo off
rem Marsam MCP server (stdio).
rem
rem This file is meant to be launched by an MCP client, not double-clicked:
rem stdin and stdout carry the JSON-RPC stream, so every diagnostic goes to
rem stderr. Add it to a client as:
rem   command:  <path to this file>
rem or, preferably, run node directly:
rem   command:  node
rem   args:     ["<path to mcp\dist\server.js>"]
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Marsam MCP] Node.js was not found. Install Node.js 20 or newer. 1>&2
  exit /b 1
)

if not exist "mcp\node_modules\" (
  echo [Marsam MCP] Installing server dependencies... 1>&2
  call npm --prefix mcp install --no-fund --no-audit 1>&2
  if errorlevel 1 (
    echo [Marsam MCP] Could not install the server dependencies. 1>&2
    exit /b 1
  )
)

if not exist "mcp\dist\server.js" (
  echo [Marsam MCP] Building the server... 1>&2
  call npm --prefix mcp run build 1>&2
  if errorlevel 1 (
    echo [Marsam MCP] Could not build the server. 1>&2
    exit /b 1
  )
)

node "mcp\dist\server.js"
exit /b %errorlevel%
