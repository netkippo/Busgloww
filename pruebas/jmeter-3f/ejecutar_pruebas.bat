@echo off
REM =====================================================================
REM  BusGlow - Pruebas de carga de 250, 500 y 1000 usuarios
REM  (inicio de sesion, busqueda de viajes y compra de pasaje)
REM
REM  Uso:   ejecutar_pruebas.bat              -> 250, 500 y 1000 usuarios
REM         ejecutar_pruebas.bat 250          -> solo una carga
REM
REM  Antes: servidor BusGlow corriendo (iniciar.bat, con 64 hilos) y JMeter en el PATH
REM         (o define JMETER con la ruta completa a jmeter.bat).
REM  Entre cargas se reinicia la base (npm run db:init) para que todas
REM  partan de los mismos datos. Para no reiniciarla: set REINICIAR_BD=0
REM  BUSGLOW = carpeta del proyecto (donde esta package.json). Por defecto
REM  se asume que esta carpeta esta dentro de busglow\pruebas\
REM =====================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
if "%JMETER%"=="" set JMETER=jmeter
if "%REINICIAR_BD%"=="" set REINICIAR_BD=1
if "%BUSGLOW%"=="" set BUSGLOW=%~dp0..\..
if "%REINICIAR_BD%"=="1" if not exist "%BUSGLOW%\package.json" (
  echo No encuentro el proyecto BusGlow en "%BUSGLOW%".
  echo Escribe antes:  set BUSGLOW=C:\ruta\de\busglow
  echo o desactiva el reinicio de la base:  set REINICIAR_BD=0
  exit /b 1
)
REM Memoria para JMeter: 1000 usuarios no caben en la memoria por defecto
if "%HEAP%"=="" set HEAP=-Xms1g -Xmx4g -XX:MaxMetaspaceSize=256m

set CARGAS=%*
if "%CARGAS%"=="" set CARGAS=250 500 1000

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set SESION=%%i
set BASE=resultados\%SESION%
mkdir "%BASE%" 2>nul
set CARPETAS=

for %%N in (%CARGAS%) do (
  echo.
  echo ================================================================
  echo  Prueba con %%N usuarios
  echo ================================================================
  if "!REINICIAR_BD!"=="1" (
    echo Reiniciando la base de datos de prueba...
    pushd "%BUSGLOW%"
    call npm run db:init
    popd
    timeout /t 15 /nobreak >nul
  )
  set SALIDA=%BASE%\carga_%%N
  mkdir "!SALIDA!" 2>nul
  call "%JMETER%" -n -t busglow_3_funcionalidades.jmx -q busglow.properties -q carga_%%N.properties ^
       -l "!SALIDA!\resultados.jtl" -j "!SALIDA!\jmeter.log" -e -o "!SALIDA!\reporte"
  set CARPETAS=!CARPETAS! "!SALIDA!"
  echo Informe HTML de %%N usuarios: !SALIDA!\reporte\index.html
  echo Pausa de 60 s para que el servidor se recupere...
  timeout /t 60 /nobreak >nul
)

echo.
echo Generando la comparativa...
node comparar.js %CARPETAS% --salida "%BASE%\comparativa.html"
start "" "%BASE%\comparativa.html"
endlocal
