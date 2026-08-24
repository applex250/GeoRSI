@echo off
rem GeoRSI research agent: normal pi chat + /research commands.
rem Run from ANY folder: the research scaffold lands in that folder.
node "%~dp0node_modules\@earendil-works\pi-coding-agent\dist\cli.js" -e "%~dp0extensions\georsi.ts" %*
