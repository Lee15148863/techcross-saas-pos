@echo off
title Tech Cross Print Agent - Uninstall
echo.
echo  Removing auto-start...
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PrintAgent.vbs" >nul 2>nul
echo  [OK] Auto-start removed.
echo.
echo  Stopping Print Agent...
taskkill /f /im node.exe /fi "WINDOWTITLE eq Print Agent" >nul 2>nul
echo  [OK] Stopped.
echo.
echo  Uninstall complete. You can delete this folder.
echo.
pause
