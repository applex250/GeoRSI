@echo off
REM GeoRSI Lab - 一键更新脚本 (Windows CMD 兼容入口)
REM 实际逻辑在 deploy.ps1，此脚本仅做转发，方便双击或 cmd 调用
REM 用法: deploy.cmd / deploy.cmd -Clean / deploy.cmd -Logs

setlocal
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%deploy.ps1" %*
if errorlevel 1 (
    echo [deploy.cmd] deploy.ps1 failed with errorlevel %errorlevel%
    pause
    exit /b %errorlevel%
)
endlocal
