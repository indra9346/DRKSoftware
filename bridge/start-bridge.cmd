@echo off
rem DRK Fitness Gym bridge for the front-desk PC. Edit the address below, then double-click this file.
rem To start it automatically: Win+R, type shell:startup, and put a shortcut to this file there.
set GYM_SOFTWARE_URL=https://YOUR-GYM-SOFTWARE-ADDRESS
set BRIDGE_PORT=8081
title DRK Fitness Gym bridge
:loop
node "%~dp0gym-bridge.mjs"
echo Bridge stopped, restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
