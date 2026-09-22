@echo off
setlocal
title Mapa LiDAR - lanzador
set "APP=%~dp0.."
set "PORT=4180"
set "URL=http://localhost:%PORT%"

call :portcheck
if %errorlevel%==0 goto open

where node >nul 2>&1 || (echo [ERROR] No se encuentra Node.js ^(20 o superior^). & pause & exit /b 1)

if not exist "%APP%\node_modules" (
  echo Instalando dependencias ^(solo la primera vez^)...
  pushd "%APP%"
  call npm install || (popd & echo [ERROR] Fallo npm install. & pause & exit /b 1)
  popd
)

echo Arrancando Mapa LiDAR...
start "MapaLidar servidor" /min /d "%APP%" cmd /k npm run dev

for /l %%i in (1,1,60) do (
  call :portcheck
  if not errorlevel 1 goto open
  timeout /t 2 /nobreak >nul
)
echo [ERROR] El servidor no respondio en %URL%. Mira la ventana "MapaLidar servidor".
pause
exit /b 1

:open
start "" "%URL%"
exit /b 0

:portcheck
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient('localhost',%PORT%);$c.Close();exit 0}catch{exit 1}"
exit /b %errorlevel%
