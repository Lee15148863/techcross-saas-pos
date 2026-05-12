@echo off
echo Stopping Print Agent...
taskkill /f /im node.exe /fi "WINDOWTITLE eq Print Agent" >nul 2>nul
echo Done.
timeout /t 2
