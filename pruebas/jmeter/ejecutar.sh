#!/usr/bin/env bash
# BusGlow - Ejecuta la prueba de rendimiento sin interfaz (macOS / Linux)
set -e
cd "$(dirname "$0")"
JMETER="${JMETER:-jmeter}"
SALIDA="resultados/$(date +%Y%m%d-%H%M)"
mkdir -p "$SALIDA"
"$JMETER" -n -t busglow.jmx -q busglow.properties -l "$SALIDA/resultados.jtl" -j "$SALIDA/jmeter.log" -e -o "$SALIDA/reporte" "$@"
echo "Informe HTML: $SALIDA/reporte/index.html"
