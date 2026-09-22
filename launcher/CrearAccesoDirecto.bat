@echo off
powershell -NoProfile -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Mapa LiDAR.lnk')); $s.TargetPath='%~dp0MapaLidar.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.IconLocation='%~dp0mapa-lidar.ico,0'; $s.Save(); Write-Host ('Acceso directo creado en ' + $d)"
pause
