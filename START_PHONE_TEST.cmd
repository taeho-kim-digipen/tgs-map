@echo off
title TGS 2026 - iPhone Preview
cd /d "%~dp0"
call npm.cmd run dev:phone
if errorlevel 1 pause
