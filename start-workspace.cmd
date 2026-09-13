@echo off
setlocal
title GeoRSI Research Workspace
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-workspace.ps1" %*
set "workspace_exit=%ERRORLEVEL%"
echo.
pause
exit /b %workspace_exit%
