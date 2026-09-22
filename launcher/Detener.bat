@echo off
taskkill /FI "WINDOWTITLE eq MapaLidar servidor*" /T /F
timeout /t 3 >nul
