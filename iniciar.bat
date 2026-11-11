@echo off
REM Inicia BusGlow con 64 hilos de trabajo (necesario para pruebas de carga con msnodesqlv8)
set UV_THREADPOOL_SIZE=64
cd /d "%~dp0"
npm start
