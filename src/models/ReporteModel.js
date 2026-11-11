/**
 * MODELO: Reportes (RF25) — puntualidad, retrasos, ocupación, ventas y pasajeros por ruta y período.
 */
const { query, queryOne } = require('../config/db');

const RUTA_NOMBRE = `CONCAT(co.nombre, N' → ', cd.nombre)`;
const JOIN_RUTA = `
    JOIN ruta ru   ON ru.id_ruta = v.id_ruta
    JOIN ciudad co ON co.id_ciudad = ru.ciudad_origen
    JOIN ciudad cd ON cd.id_ciudad = ru.ciudad_destino`;

/**
 * Genera todos los reportes del período.
 * @param {{desde: string, hasta: string, idRuta?: number, idEmpresa?: number}} f
 *        idEmpresa limita los reportes a los viajes de esa empresa.
 */
async function generar({ desde, hasta, idRuta, idEmpresa }) {
    const params = { desde, hasta };
    let filtroRuta = '';
    if (idRuta) { filtroRuta = 'AND v.id_ruta = @ruta'; params.ruta = idRuta; }
    if (idEmpresa) { filtroRuta += ' AND v.id_bus IN (SELECT id_bus FROM bus WHERE id_empresa = @emp)'; params.emp = idEmpresa; }

    // Ventas y pasajeros por ruta
    const ventasPorRuta = await query(`
        SELECT ${RUTA_NOMBRE} AS ruta,
               COUNT(DISTINCT r.id_reserva) AS reservas,
               COUNT(ra.id_reserva_asiento) AS pasajeros,
               CAST(ISNULL(SUM(ra.precio), 0) AS FLOAT) AS ventas
          FROM viaje v ${JOIN_RUTA}
          JOIN reserva r          ON r.id_viaje = v.id_viaje AND r.estado = 'Confirmada'
          JOIN reserva_asiento ra ON ra.id_reserva = r.id_reserva AND ra.activo = 1
         WHERE v.fecha_salida BETWEEN @desde AND @hasta ${filtroRuta}
         GROUP BY co.nombre, cd.nombre
         ORDER BY ventas DESC`, params);

    // Ventas por día
    const ventasPorDia = await query(`
        SELECT CONVERT(VARCHAR(10), v.fecha_salida, 23) AS fecha,
               COUNT(ra.id_reserva_asiento) AS pasajeros,
               CAST(ISNULL(SUM(ra.precio), 0) AS FLOAT) AS ventas
          FROM viaje v
          JOIN reserva r          ON r.id_viaje = v.id_viaje AND r.estado = 'Confirmada'
          JOIN reserva_asiento ra ON ra.id_reserva = r.id_reserva AND ra.activo = 1
         WHERE v.fecha_salida BETWEEN @desde AND @hasta ${filtroRuta}
         GROUP BY v.fecha_salida
         ORDER BY v.fecha_salida`, params);

    // Ocupación por ruta (asientos vendidos / capacidad ofertada)
    const ocupacionPorRuta = await query(`
        SELECT ${RUTA_NOMBRE} AS ruta, COUNT(*) AS viajes,
               SUM(b.capacidad) AS capacidad,
               SUM(x.vendidos) AS vendidos,
               CAST(ROUND(100.0 * SUM(x.vendidos) / NULLIF(SUM(b.capacidad), 0), 1) AS FLOAT) AS ocupacion_pct
          FROM viaje v ${JOIN_RUTA}
          JOIN bus b ON b.id_bus = v.id_bus
          CROSS APPLY (SELECT COUNT(*) AS vendidos FROM reserva_asiento ra JOIN reserva r ON r.id_reserva = ra.id_reserva
                        WHERE ra.id_viaje = v.id_viaje AND ra.activo = 1 AND r.estado = 'Confirmada') x
         WHERE v.fecha_salida BETWEEN @desde AND @hasta AND v.estado <> 'Cancelado' ${filtroRuta}
         GROUP BY co.nombre, cd.nombre
         ORDER BY ocupacion_pct DESC`, params);

    // Ocupación por bus
    const ocupacionPorBus = await query(`
        SELECT b.placa, e.razon_social AS empresa, b.tipo_servicio, COUNT(*) AS viajes,
               CAST(ROUND(100.0 * SUM(x.vendidos) / NULLIF(SUM(b.capacidad), 0), 1) AS FLOAT) AS ocupacion_pct
          FROM viaje v
          JOIN bus b ON b.id_bus = v.id_bus
          JOIN empresa e ON e.id_empresa = b.id_empresa
          CROSS APPLY (SELECT COUNT(*) AS vendidos FROM reserva_asiento ra JOIN reserva r ON r.id_reserva = ra.id_reserva
                        WHERE ra.id_viaje = v.id_viaje AND ra.activo = 1 AND r.estado = 'Confirmada') x
         WHERE v.fecha_salida BETWEEN @desde AND @hasta AND v.estado <> 'Cancelado' ${filtroRuta}
         GROUP BY b.placa, e.razon_social, b.tipo_servicio
         ORDER BY ocupacion_pct DESC`, params);

    // Puntualidad y retrasos por ruta (tolerancia: 5 minutos)
    const puntualidad = await query(`
        SELECT ${RUTA_NOMBRE} AS ruta,
               COUNT(*) AS viajes_salidos,
               SUM(CASE WHEN DATEDIFF(MINUTE, v.salida_dt, v.hora_real_salida) <= 5 THEN 1 ELSE 0 END) AS puntuales,
               SUM(CASE WHEN DATEDIFF(MINUTE, v.salida_dt, v.hora_real_salida) > 5 THEN 1 ELSE 0 END) AS retrasados,
               CAST(ROUND(100.0 * SUM(CASE WHEN DATEDIFF(MINUTE, v.salida_dt, v.hora_real_salida) <= 5 THEN 1 ELSE 0 END) / COUNT(*), 1) AS FLOAT) AS puntualidad_pct,
               CAST(ROUND(AVG(CAST(CASE WHEN DATEDIFF(MINUTE, v.salida_dt, v.hora_real_salida) > 0
                                        THEN DATEDIFF(MINUTE, v.salida_dt, v.hora_real_salida) ELSE 0 END AS FLOAT)), 1) AS FLOAT) AS retraso_promedio_min,
               MAX(DATEDIFF(MINUTE, v.salida_dt, v.hora_real_salida)) AS retraso_maximo_min
          FROM viaje v ${JOIN_RUTA}
         WHERE v.hora_real_salida IS NOT NULL AND v.fecha_salida BETWEEN @desde AND @hasta ${filtroRuta}
         GROUP BY co.nombre, cd.nombre
         ORDER BY puntualidad_pct`, params);

    const totales = await queryOne(`
        SELECT
            (SELECT COUNT(*) FROM viaje v WHERE v.fecha_salida BETWEEN @desde AND @hasta ${filtroRuta}) AS viajes,
            (SELECT COUNT(*) FROM viaje v WHERE v.estado = 'Cancelado' AND v.fecha_salida BETWEEN @desde AND @hasta ${filtroRuta}) AS cancelados,
            (SELECT COUNT(*) FROM reserva_asiento ra JOIN reserva r ON r.id_reserva = ra.id_reserva JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE r.estado = 'Confirmada' AND ra.activo = 1 AND v.fecha_salida BETWEEN @desde AND @hasta ${filtroRuta}) AS pasajeros,
            (SELECT CAST(ISNULL(SUM(ra.precio), 0) AS FLOAT) FROM reserva_asiento ra JOIN reserva r ON r.id_reserva = ra.id_reserva JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE r.estado = 'Confirmada' AND ra.activo = 1 AND v.fecha_salida BETWEEN @desde AND @hasta ${filtroRuta}) AS ventas,
            (SELECT CAST(ISNULL(SUM(rb.monto), 0) AS FLOAT) FROM reembolso rb JOIN reserva r ON r.id_reserva = rb.id_reserva JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE rb.estado = 'Procesado' AND v.fecha_salida BETWEEN @desde AND @hasta ${filtroRuta}) AS reembolsos,
            (SELECT COUNT(*) FROM reembolso rb JOIN reserva r ON r.id_reserva = rb.id_reserva JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE rb.estado = 'Pendiente' AND v.fecha_salida BETWEEN @desde AND @hasta ${filtroRuta}) AS reembolsos_pendientes`, params);

    const salidos = puntualidad.reduce((s, r) => s + r.viajes_salidos, 0);
    const puntuales = puntualidad.reduce((s, r) => s + r.puntuales, 0);
    const capacidad = ocupacionPorRuta.reduce((s, r) => s + r.capacidad, 0);
    const vendidos = ocupacionPorRuta.reduce((s, r) => s + r.vendidos, 0);
    totales.puntualidad_pct = salidos ? Math.round(1000 * puntuales / salidos) / 10 : null;
    totales.ocupacion_pct = capacidad ? Math.round(1000 * vendidos / capacidad) / 10 : null;

    return { desde, hasta, totales, ventasPorRuta, ventasPorDia, ocupacionPorRuta, ocupacionPorBus, puntualidad };
}

/** Indicadores rápidos del día para el panel de operaciones (de una empresa o de toda la plataforma). */
function dashboard(idEmpresa = null) {
    const emp = idEmpresa ? 'AND v.id_bus IN (SELECT id_bus FROM bus WHERE id_empresa = @emp)' : '';
    return queryOne(`
        SELECT
            (SELECT COUNT(*) FROM viaje v WHERE v.fecha_salida = CAST(GETDATE() AS DATE) ${emp}) AS viajes_hoy,
            (SELECT COUNT(*) FROM viaje v WHERE v.fecha_salida = CAST(GETDATE() AS DATE) AND v.estado = 'Retrasado' ${emp}) AS retrasados_hoy,
            (SELECT COUNT(*) FROM viaje v WHERE v.estado = 'Salido' ${emp}) AS en_ruta,
            (SELECT COUNT(*) FROM reserva_asiento ra JOIN reserva r ON r.id_reserva = ra.id_reserva JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE r.estado = 'Confirmada' AND ra.activo = 1 AND CAST(r.fecha_reserva AS DATE) = CAST(GETDATE() AS DATE) ${emp}) AS boletos_vendidos_hoy,
            -- Ingresos netos del día: pagos cobrados hoy menos reembolsos devueltos hoy
            (SELECT CAST(ISNULL(SUM(p.monto), 0) AS FLOAT) FROM pago p JOIN reserva r ON r.id_reserva = p.id_reserva JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE p.estado IN ('Pagado','Reembolsado') AND CAST(p.fecha_pago AS DATE) = CAST(GETDATE() AS DATE) ${emp})
          - (SELECT CAST(ISNULL(SUM(rb.monto), 0) AS FLOAT) FROM reembolso rb JOIN reserva r ON r.id_reserva = rb.id_reserva JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE rb.estado = 'Procesado' AND CAST(rb.fecha_proceso AS DATE) = CAST(GETDATE() AS DATE) ${emp}) AS ventas_hoy,
            (SELECT COUNT(*) FROM reembolso rb JOIN reserva r ON r.id_reserva = rb.id_reserva JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE rb.estado = 'Pendiente' ${emp}) AS reembolsos_pendientes,
            (SELECT COUNT(*) FROM bus WHERE estado = 1 ${idEmpresa ? 'AND id_empresa = @emp' : ''}) AS buses_activos,
            (SELECT COUNT(*) FROM conductor WHERE estado = 1 ${idEmpresa ? 'AND id_empresa = @emp' : ''}) AS conductores_activos`,
        idEmpresa ? { emp: idEmpresa } : {});
}

module.exports = { generar, dashboard };
