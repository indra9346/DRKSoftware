@echo off
rem FIT CRUSH bridge for the front-desk PC. Edit the address below, then double-click this file.
rem To start it automatically: Win+R, type shell:startup, and put a shortcut to this file there.
set FITCRUSH_URL=https://YOUR-FITCRUSH-SOFTWARE-DOMAIN
set BRIDGE_PORT=8081
title FIT CRUSH bridge
:loop
node "%~dp0fitcrush-bridge.mjs"
echo Bridge stopped, restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
