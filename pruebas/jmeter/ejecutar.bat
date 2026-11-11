@echo off
REM =====================================================================
REM  BusGlow - Ejecuta la prueba de rendimiento sin interfaz (recomendado)
REM  Requisitos: JMeter en el PATH (o edita la variable JMETER) y el
REM  servidor BusGlow corriendo (npm start) con la base de prueba cargada.
REM =====================================================================
setlocal
cd /d "%~dp0"
if "%JMETER%"=="" set JMETER=jmeter

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set FECHA=%%i
set SALIDA=resultados\%FECHA%
mkdir "%SALIDA%" 2>nul

echo Ejecutando la prueba. Resultados en %SALIDA% ...
call %JMETER% -n -t busglow.jmx -q busglow.properties -l "%SALIDA%\resultados.jtl" -j "%SALIDA%\jmeter.log" -e -o "%SALIDA%\reporte" %*
if errorlevel 1 (
  echo La prueba termino con errores de ejecucion. Revisa %SALIDA%\jmeter.log
  exit /b 1
)

echo.
echo Informe HTML: %SALIDA%\reporte\index.html
start "" "%SALIDA%\reporte\index.html"
