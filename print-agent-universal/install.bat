@echo off
title Tech Cross Print Agent - Installer
color 0A
echo.
echo  ========================================
echo   Tech Cross Print Agent - Installer
echo  ========================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js is not installed!
    echo.
    echo  Please download and install Node.js from:
    echo  https://nodejs.org/
    echo.
    echo  After installing, run this script again.
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js found: 
node --version
echo.

:: Install dependencies
echo  Installing dependencies...
npm install --production
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] npm install failed!
    pause
    exit /b 1
)
echo  [OK] Dependencies installed.
echo.

:: Setup auto-start
echo  Setting up auto-start on Windows boot...
set AGENT_DIR=%~dp0
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

:: Create VBS launcher in Startup folder
echo Set WshShell = CreateObject("WScript.Shell") > "%STARTUP_DIR%\PrintAgent.vbs"
echo WshShell.CurrentDirectory = "%AGENT_DIR%" >> "%STARTUP_DIR%\PrintAgent.vbs"
echo WshShell.Run "cmd /c cd /d ""%AGENT_DIR%"" && node index.js", 0, False >> "%STARTUP_DIR%\PrintAgent.vbs"

echo  [OK] Auto-start configured.
echo       Location: %STARTUP_DIR%\PrintAgent.vbs
echo.

:: Start now
echo  Starting Print Agent...
echo.
start "Print Agent" cmd /c "cd /d "%AGENT_DIR%" && node index.js"
timeout /t 2 >nul

echo  ========================================
echo   Installation Complete!
echo  ========================================
echo.
echo   Print Agent is now running on port 9100
echo   It will auto-start when Windows boots.
echo.
echo   To check status: http://localhost:9100/status
echo   To rescan printer: http://localhost:9100/rescan
echo.
echo   You can close this window.
echo.
pause
