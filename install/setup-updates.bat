@echo off
rem AliSwift updates. Run this once. It puts the extension's files in %LOCALAPPDATA%\AliSwift\extension and checks GitHub for
rem a new release at every sign-in and every hour; Chrome reloads the extension by itself when its files change.
rem Already loaded AliSwift from a folder? Keep that one so your settings stay:  setup-updates.bat "C:\path\to\that\folder"
rem Stop the updates later with:  powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\AliSwift\update.ps1" -Unschedule
setlocal
set "HOME_DIR=%LOCALAPPDATA%\AliSwift"
if not exist "%HOME_DIR%" mkdir "%HOME_DIR%"
if "%~1"=="" (set "EXT=%HOME_DIR%\extension") else (set "EXT=%~1")

echo Getting the updater...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://github.com/envyxyz/aliswift/releases/latest/download/update.ps1' -OutFile '%HOME_DIR%\update.ps1' -UseBasicParsing"
if errorlevel 1 goto :failed

powershell -NoProfile -ExecutionPolicy Bypass -File "%HOME_DIR%\update.ps1" -Extension "%EXT%" -Schedule
if errorlevel 1 goto :failed

echo.
echo Done. The extension's files are in:
echo   %EXT%
echo.
echo First time only: in Chrome open chrome://extensions, turn on Developer mode, press "Load unpacked" and pick that folder.
echo After that, updates need nothing from you.
start "" explorer "%EXT%"
echo.
pause
exit /b 0

:failed
echo.
echo That did not work. Check your internet connection and run this file again.
pause
exit /b 1
