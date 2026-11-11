/**
 * MODELO: Parámetros configurables del sistema (tabla PARAMETRO)
 *   horas_descanso_conductor : descanso mínimo entre viajes de un conductor
 *   max_horas_conduccion     : horas máximas que conduce cada conductor en un viaje
 *   margen_bus_minutos       : tiempo mínimo entre la llegada de un bus y su siguiente salida
 *   penalidad_anulacion_pct  : % que se retiene cuando el pasajero anula su pasaje
 */
const { query } = require('../config/db');

/** Valores por defecto si la tabla no tiene el parámetro. */
const DEFAULTS = {
    horas_descanso_conductor: 8,
    max_horas_conduccion: 10,
    margen_bus_minutos: 60,
    penalidad_anulacion_pct: 10
};

/** Devuelve todos los parámetros como objeto { clave: número }. */
async function obtener() {
    const filas = await query('SELECT clave, CAST(valor AS FLOAT) AS valor FROM parametro');
    const p = { ...DEFAULTS };
    for (const f of filas) p[f.clave] = Number(f.valor);
    return p;
}

/** Conductores necesarios para una ruta: uno por cada bloque de horas máximas de conducción. */
function conductoresRequeridos(duracionMinutos, p) {
    return Math.max(1, Math.ceil(duracionMinutos / (p.max_horas_conduccion * 60)));
}

module.exports = { DEFAULTS, obtener, conductoresRequeridos };
