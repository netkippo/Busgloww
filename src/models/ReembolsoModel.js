/**
 * MODELO: Posventa — reembolsos y reubicación de pasajeros
 *
 *  - Si la EMPRESA cancela el viaje: las reservas quedan canceladas con motivo VIAJE y un reembolso
 *    Pendiente del 100 %. El pasajero elige: devolución (reembolso Procesado) o cambio a otro viaje
 *    de la misma ruta sin costo (reubicación; el reembolso pasa a Anulado).
 *  - Si el PASAJERO anula su compra: se devuelve el pago menos la penalidad configurada
 *    (parámetro penalidad_anulacion_pct) y el reembolso queda Procesado de inmediato.
 *  - La devolución del dinero es simulada, igual que la pasarela de pagos (PagoModel).
 */
const { query, queryOne, withTransaction } = require('../config/db');
const { HttpError } = require('../utils/http');
const { randomCode } = require('../utils/security');
const Notificacion = require('./NotificacionModel');

const redondear = n => Math.round(n * 100) / 100;
const soles = n => `S/ ${Number(n).toFixed(2)}`;

/**
 * Pago con dinero de una reserva. Una reserva reubicada tiene un pago de S/ 0 (REUBICACION):
 * el dinero está en el pago de la reserva original.
 */
const SQL_PAGO_REAL = `
    SELECT TOP 1 p.id_pago, CAST(p.monto AS FLOAT) AS monto, p.metodo_pago
      FROM pago p JOIN reserva r ON r.id_reserva = @r
     WHERE p.id_reserva IN (r.id_reserva, r.id_reserva_origen) AND p.estado = 'Pagado' AND p.monto > 0
     ORDER BY p.id_pago`;

/** Datos de la reserva con su viaje (para validar empresa y armar mensajes). */
function datosReserva(idReserva) {
    return queryOne(`
        SELECT r.id_reserva, r.id_usuario, r.id_viaje, r.estado, r.motivo_cancelacion, r.id_reserva_origen,
               CAST(r.total AS FLOAT) AS total,
               b.id_empresa, e.razon_social AS empresa, ru.ciudad_origen, ru.ciudad_destino,
               co.nombre AS origen, cd.nombre AS destino,
               CONVERT(VARCHAR(10), v.fecha_salida, 23) AS fecha_salida, CONVERT(VARCHAR(5), v.hora_salida, 108) AS hora_salida,
               rb.id_reembolso, rb.estado AS estado_reembolso, CAST(rb.monto AS FLOAT) AS monto_reembolso
          FROM reserva r
          JOIN viaje v   ON v.id_viaje = r.id_viaje
          JOIN ruta ru   ON ru.id_ruta = v.id_ruta
          JOIN ciudad co ON co.id_ciudad = ru.ciudad_origen
          JOIN ciudad cd ON cd.id_ciudad = ru.ciudad_destino
          JOIN bus b     ON b.id_bus = v.id_bus
          JOIN empresa e ON e.id_empresa = b.id_empresa
          LEFT JOIN reembolso rb ON rb.id_reserva = r.id_reserva AND rb.estado <> 'Anulado'
         WHERE r.id_reserva = @id`, { id: idReserva });
}

/* ======================= Cancelaciones ======================= */

/**
 * La empresa cancela el viaje (se llama dentro de la transacción de ViajeModel.cambiarEstado).
 * Devuelve cuántas reservas pagadas quedaron afectadas.
 */
async function cancelarPorViaje(q, viaje, motivo) {
    const afectadas = await q(`
        DECLARE @afectadas TABLE (id_reserva INT, estado_anterior VARCHAR(20));
        UPDATE reserva
           SET estado = 'Cancelada', motivo_cancelacion = 'VIAJE', fecha_cancelacion = SYSDATETIME(), expira_en = NULL
        OUTPUT INSERTED.id_reserva, DELETED.estado INTO @afectadas
         WHERE id_viaje = @id AND estado IN ('Pendiente','Confirmada');

        UPDATE reserva_asiento SET activo = 0 WHERE id_viaje = @id;
        UPDATE bo SET estado = 'Anulado' FROM boleto bo JOIN reserva r ON r.id_reserva = bo.id_reserva WHERE r.id_viaje = @id;

        SELECT a.id_reserva, CAST(r.total AS FLOAT) AS total
          FROM @afectadas a JOIN reserva r ON r.id_reserva = a.id_reserva
         WHERE a.estado_anterior = 'Confirmada';`, { id: viaje.id_viaje });

    const motivoTexto = motivo || 'motivos operativos';
    for (const a of afectadas) {
        const pago = (await q(SQL_PAGO_REAL, { r: a.id_reserva }))[0];
        if (pago) {
            await q(`
                INSERT INTO reembolso (id_reserva, id_pago, monto_pagado, penalidad, monto, motivo, estado)
                VALUES (@r, @p, @m, 0, @m, @motivo, 'Pendiente')`,
                { r: a.id_reserva, p: pago.id_pago, m: pago.monto, motivo: `Viaje cancelado por la empresa: ${motivoTexto}`.slice(0, 300) });
        }
        await Notificacion.avisarReserva(q, a.id_reserva,
            `Tu viaje ${viaje.origen} → ${viaje.destino} fue cancelado`,
            `La empresa ${viaje.empresa} canceló el viaje del ${viaje.fecha_salida} a las ${viaje.hora_salida} (${motivoTexto}). ` +
            `Tus boletos fueron anulados. Puedes pedir la devolución del 100 % (${soles(pago ? pago.monto : a.total)}) desde "Mis viajes" ` +
            'o acercarte a ventanilla para cambiarte a otro viaje de la misma ruta sin costo.');
    }
    return afectadas.length;
}

/**
 * El pasajero (o la ventanilla a su pedido) anula la reserva.
 * Si estaba pagada, se devuelve el pago menos la penalidad y el reembolso queda Procesado.
 */
async function cancelarPorCliente(reserva, penalidadPct, idUsuario) {
    return withTransaction(async (q, q1) => {
        const r = await q1(`
            UPDATE reserva SET estado = 'Cancelada', motivo_cancelacion = 'CLIENTE', fecha_cancelacion = SYSDATETIME(), expira_en = NULL
            OUTPUT DELETED.estado AS estado_anterior
             WHERE id_reserva = @r AND estado IN ('Pendiente','Confirmada')`, { r: reserva.id_reserva });
        if (!r) throw new HttpError(409, 'La reserva ya no está activa.');
        await q(`
            UPDATE reserva_asiento SET activo = 0 WHERE id_reserva = @r;
            UPDATE boleto SET estado = 'Anulado' WHERE id_reserva = @r;`, { r: reserva.id_reserva });

        if (r.estado_anterior !== 'Confirmada') return { reembolso: null };

        const pago = await q1(SQL_PAGO_REAL, { r: reserva.id_reserva });
        if (!pago) return { reembolso: null };
        const penalidad = redondear(pago.monto * penalidadPct / 100);
        const monto = redondear(pago.monto - penalidad);
        const codigo = randomCode('RF', 8);
        await q(`
            INSERT INTO reembolso (id_reserva, id_pago, monto_pagado, penalidad, monto, motivo, estado, codigo, fecha_proceso, id_usuario)
            VALUES (@r, @p, @pagado, @pen, @m, @motivo, 'Procesado', @c, SYSDATETIME(), @u);
            UPDATE pago SET estado = 'Reembolsado' WHERE id_pago = @p;`,
            { r: reserva.id_reserva, p: pago.id_pago, pagado: pago.monto, pen: penalidad, m: monto, c: codigo, u: idUsuario,
              motivo: penalidad ? `Anulación del pasajero (retención del ${penalidadPct} %)` : 'Anulación del pasajero' });
        await Notificacion.avisarReserva(q, reserva.id_reserva, 'Anulaste tu pasaje',
            `Tu reserva #${reserva.id_reserva} fue anulada. Te devolvemos ${soles(monto)} por ${pago.metodo_pago}` +
            `${penalidad ? ` (se retuvo ${soles(penalidad)}, el ${penalidadPct} %)` : ''}. Código de operación: ${codigo}.`);
        return { reembolso: { monto, penalidad, codigo } };
    });
}

/* ======================= Reembolso de un viaje cancelado ======================= */

/** Devuelve el dinero de una reserva afectada por la cancelación del viaje (100 %). */
async function procesar(reserva, idUsuario) {
    if (reserva.motivo_cancelacion !== 'VIAJE' || reserva.estado !== 'Cancelada') {
        throw new HttpError(409, 'Solo se reembolsan aquí las reservas de viajes cancelados por la empresa.');
    }
    if (reserva.estado_reembolso !== 'Pendiente') {
        throw new HttpError(409, reserva.estado_reembolso === 'Procesado' ? 'El reembolso ya fue procesado.' : 'Esta reserva no tiene un reembolso pendiente.');
    }
    const codigo = randomCode('RF', 8);
    await withTransaction(async (q, q1) => {
        const ok = await q1(`
            UPDATE reembolso SET estado = 'Procesado', codigo = @c, fecha_proceso = SYSDATETIME(), id_usuario = @u
            OUTPUT INSERTED.id_pago
             WHERE id_reembolso = @id AND estado = 'Pendiente'`, { id: reserva.id_reembolso, c: codigo, u: idUsuario });
        if (!ok) throw new HttpError(409, 'El reembolso ya fue atendido.');
        await q("UPDATE pago SET estado = 'Reembolsado' WHERE id_pago = @p", { p: ok.id_pago });
        await Notificacion.avisarReserva(q, reserva.id_reserva, 'Reembolso procesado',
            `Devolvimos ${soles(reserva.monto_reembolso)} de tu viaje ${reserva.origen} → ${reserva.destino} del ${reserva.fecha_salida}. ` +
            `Código de operación: ${codigo}. Según tu banco, el abono puede tardar unos días.`);
    });
    return { codigo, monto: reserva.monto_reembolso };
}

/* ======================= Reubicación ======================= */

/** Viajes de la misma ruta y empresa a los que se puede reubicar a los pasajeros. */
function alternativas(reserva, pasajeros) {
    return query(`
        SELECT TOP 12 v.id_viaje, CONVERT(VARCHAR(10), v.fecha_salida, 23) AS fecha_salida, CONVERT(VARCHAR(5), v.hora_salida, 108) AS hora_salida,
               CONVERT(VARCHAR(5), v.hora_llegada, 108) AS hora_llegada, CAST(v.precio AS FLOAT) AS precio, v.estado,
               b.placa, b.tipo_servicio, x.libres
          FROM viaje v
          JOIN ruta r ON r.id_ruta = v.id_ruta
          JOIN bus b  ON b.id_bus = v.id_bus
         CROSS APPLY (SELECT COUNT(*) AS libres FROM asiento a
                       WHERE a.id_bus = v.id_bus AND a.estado = 'Disponible'
                         AND NOT EXISTS (SELECT 1 FROM reserva_asiento ra
                                          WHERE ra.id_viaje = v.id_viaje AND ra.id_asiento = a.id_asiento AND ra.activo = 1)) x
         WHERE r.ciudad_origen = @o AND r.ciudad_destino = @d AND b.id_empresa = @emp
           AND v.id_viaje <> @actual
           AND v.estado IN ('Programado','Embarcando','Proximo a salir','Retrasado')
           AND v.salida_dt > DATEADD(MINUTE, 30, GETDATE())
           AND x.libres >= @n
         ORDER BY v.salida_dt`,
        { o: reserva.ciudad_origen, d: reserva.ciudad_destino, emp: reserva.id_empresa, actual: reserva.id_viaje, n: pasajeros });
}

/**
 * Cambia a los pasajeros de una reserva afectada a otro viaje de la misma ruta y empresa, sin costo:
 *  - se crea una reserva Confirmada (con un pago de S/ 0 "REUBICACION") y boletos nuevos;
 *  - se intenta mantener el mismo número de asiento; si está ocupado, se asigna el primero libre;
 *  - la reserva original pasa a Reubicada y su reembolso a Anulado.
 */
async function reubicar(reserva, idViajeDestino, idUsuario) {
    if (reserva.motivo_cancelacion !== 'VIAJE' || reserva.estado !== 'Cancelada') {
        throw new HttpError(409, 'Solo se reubican reservas de viajes cancelados por la empresa.');
    }
    if (reserva.estado_reembolso === 'Procesado') throw new HttpError(409, 'Al pasajero ya se le devolvió el dinero.');
    // Sin reembolso pendiente no hay nada que trasladar (p. ej., una reserva que nunca se pagó)
    if (reserva.estado_reembolso !== 'Pendiente') throw new HttpError(409, 'Esta reserva no tiene un pago por compensar.');

    const destino = await queryOne(`
        SELECT v.id_viaje, v.id_bus, v.estado, v.salida_dt, b.id_empresa, r.ciudad_origen, r.ciudad_destino,
               CONVERT(VARCHAR(10), v.fecha_salida, 23) AS fecha_salida, CONVERT(VARCHAR(5), v.hora_salida, 108) AS hora_salida,
               CASE WHEN v.salida_dt > GETDATE() THEN 1 ELSE 0 END AS futuro
          FROM viaje v JOIN bus b ON b.id_bus = v.id_bus JOIN ruta r ON r.id_ruta = v.id_ruta
         WHERE v.id_viaje = @id`, { id: idViajeDestino });
    if (!destino || destino.id_empresa !== reserva.id_empresa ||
        destino.ciudad_origen !== reserva.ciudad_origen || destino.ciudad_destino !== reserva.ciudad_destino) {
        throw new HttpError(400, 'El viaje elegido no es de la misma ruta y empresa.');
    }
    if (!['Programado', 'Embarcando', 'Proximo a salir', 'Retrasado'].includes(destino.estado) || !destino.futuro) {
        throw new HttpError(409, 'El viaje elegido ya no admite pasajeros.');
    }

    const pasajeros = await query(`
        SELECT ra.id_pasajero, CAST(ra.precio AS FLOAT) AS precio, a.numero
          FROM reserva_asiento ra JOIN asiento a ON a.id_asiento = ra.id_asiento
         WHERE ra.id_reserva = @r ORDER BY a.fila, a.columna`, { r: reserva.id_reserva });

    try {
        return await withTransaction(async (q, q1) => {
            // Se "reclama" el reembolso pendiente primero: evita que el pasajero reciba devolución y cambio a la vez
            const reclamado = await q1(`
                UPDATE reembolso SET estado = 'Anulado', fecha_proceso = SYSDATETIME(), id_usuario = @u
                OUTPUT INSERTED.id_reembolso
                 WHERE id_reserva = @orig AND estado = 'Pendiente'
                   AND EXISTS (SELECT 1 FROM reserva WHERE id_reserva = @orig AND estado = 'Cancelada' AND motivo_cancelacion = 'VIAJE')`,
                { orig: reserva.id_reserva, u: idUsuario });
            if (!reclamado) throw new HttpError(409, 'La reserva ya fue atendida (reembolsada o cambiada de viaje).');

            const nueva = await q1(`
                INSERT INTO reserva (id_usuario, id_viaje, estado, total, id_reserva_origen)
                OUTPUT INSERTED.id_reserva
                VALUES (@u, @v, 'Confirmada', @total, @origen)`,
                { u: reserva.id_usuario, v: destino.id_viaje, total: reserva.total, origen: reserva.id_reserva_origen || reserva.id_reserva });

            const asignados = [];
            for (const p of pasajeros) {
                // mismo número de asiento si está libre; si no, el primero libre del bus
                const asiento = await q1(`
                    SELECT TOP 1 a.id_asiento, a.numero FROM asiento a
                     WHERE a.id_bus = @bus AND a.estado = 'Disponible'
                       AND NOT EXISTS (SELECT 1 FROM reserva_asiento ra
                                        WHERE ra.id_viaje = @v AND ra.id_asiento = a.id_asiento AND ra.activo = 1)
                     ORDER BY CASE WHEN a.numero = @num THEN 0 ELSE 1 END, a.piso, a.fila, a.columna`,
                    { bus: destino.id_bus, v: destino.id_viaje, num: p.numero });
                if (!asiento) throw new HttpError(409, 'El viaje elegido ya no tiene asientos suficientes.');
                const ra = await q1(`
                    INSERT INTO reserva_asiento (id_reserva, id_asiento, id_viaje, id_pasajero, precio)
                    OUTPUT INSERTED.id_reserva_asiento
                    VALUES (@r, @a, @v, @p, @precio)`,
                    { r: nueva.id_reserva, a: asiento.id_asiento, v: destino.id_viaje, p: p.id_pasajero, precio: p.precio });
                await q('INSERT INTO boleto (id_reserva, id_reserva_asiento, codigo_boleto) VALUES (@r, @ra, @c)',
                    { r: nueva.id_reserva, ra: ra.id_reserva_asiento, c: randomCode('BG', 8) });
                asignados.push(asiento.numero);
            }

            await q(`
                INSERT INTO pago (id_reserva, monto, metodo_pago, estado, codigo)
                VALUES (@r, 0, 'REUBICACION', 'Pagado', @c);
                UPDATE reserva SET estado = 'Reubicada' WHERE id_reserva = @orig AND estado = 'Cancelada';
                UPDATE reembolso SET motivo = LEFT(CONCAT(motivo, ' | Reubicado en la reserva #', @r), 300)
                 WHERE id_reembolso = @rb;`,
                { r: nueva.id_reserva, c: `REUB-${reserva.id_reserva}`, orig: reserva.id_reserva, rb: reclamado.id_reembolso });

            await Notificacion.avisarReserva(q, nueva.id_reserva, 'Te cambiamos de viaje',
                `Por la cancelación de tu viaje del ${reserva.fecha_salida}, ahora viajas ${reserva.origen} → ${reserva.destino} ` +
                `el ${destino.fecha_salida} a las ${destino.hora_salida}, asiento(s) ${asignados.join(', ')}, sin costo adicional. ` +
                'Tus nuevos boletos están en "Mis viajes".');
            return { id_reserva: nueva.id_reserva, asientos: asignados };
        });
    } catch (err) {
        if (err.number === 2601 || err.number === 2627) throw new HttpError(409, 'Un asiento acaba de ser vendido. Intenta nuevamente.');
        throw err;
    }
}

/* ======================= Consultas para el panel ======================= */

/** Reservas afectadas por la cancelación de un viaje, con su situación de posventa. */
function afectadosDeViaje(idViaje) {
    return query(`
        SELECT r.id_reserva, r.estado, CAST(r.total AS FLOAT) AS total, u.rol AS rol_comprador,
               CONCAT(u.nombres, ' ', u.apellidos) AS comprador, u.correo,
               STUFF((SELECT ', ' + p.nombres + ' ' + p.apellidos + ' (' + a.numero + ')'
                        FROM reserva_asiento ra JOIN pasajero p ON p.id_pasajero = ra.id_pasajero JOIN asiento a ON a.id_asiento = ra.id_asiento
                       WHERE ra.id_reserva = r.id_reserva FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS pasajeros,
               (SELECT COUNT(*) FROM reserva_asiento ra WHERE ra.id_reserva = r.id_reserva) AS num_pasajeros,
               rb.estado AS estado_reembolso, CAST(rb.monto AS FLOAT) AS monto_reembolso, rb.codigo AS codigo_reembolso,
               nr.id_reserva AS reubicada_en,
               CONCAT(CONVERT(VARCHAR(10), nv.fecha_salida, 23), ' ', CONVERT(VARCHAR(5), nv.hora_salida, 108)) AS nuevo_viaje
          FROM reserva r
          JOIN usuario u ON u.id_usuario = r.id_usuario
          OUTER APPLY (SELECT TOP 1 * FROM reembolso x WHERE x.id_reserva = r.id_reserva ORDER BY x.id_reembolso DESC) rb
          -- reserva creada al reubicarla (todas apuntan a la reserva original de la cadena)
          OUTER APPLY (SELECT TOP 1 x.id_reserva, x.id_viaje FROM reserva x
                        WHERE x.id_reserva_origen = COALESCE(r.id_reserva_origen, r.id_reserva)
                          AND x.id_reserva > r.id_reserva AND x.estado = 'Confirmada'
                        ORDER BY x.id_reserva DESC) nr
          LEFT JOIN viaje nv   ON nv.id_viaje = nr.id_viaje
         WHERE r.id_viaje = @id AND r.motivo_cancelacion = 'VIAJE'
         ORDER BY r.id_reserva`, { id: idViaje });
}

/** Lista de reembolsos (por estado y empresa) para el panel. */
function listar({ estado, idEmpresa }) {
    const params = {};
    const filtros = ['1 = 1'];
    if (estado) { filtros.push('rb.estado = @estado'); params.estado = estado; }
    if (idEmpresa) { filtros.push('b.id_empresa = @emp'); params.emp = idEmpresa; }
    return query(`
        SELECT TOP 300 rb.id_reembolso, rb.id_reserva, rb.estado, rb.motivo, rb.codigo,
               CAST(rb.monto_pagado AS FLOAT) AS monto_pagado, CAST(rb.penalidad AS FLOAT) AS penalidad, CAST(rb.monto AS FLOAT) AS monto,
               CONVERT(VARCHAR(16), rb.fecha_solicitud, 120) AS fecha_solicitud, CONVERT(VARCHAR(16), rb.fecha_proceso, 120) AS fecha_proceso,
               r.motivo_cancelacion, v.id_viaje, CONCAT(co.nombre, N' → ', cd.nombre) AS ruta,
               CONCAT(CONVERT(VARCHAR(10), v.fecha_salida, 23), ' ', CONVERT(VARCHAR(5), v.hora_salida, 108)) AS salida,
               e.razon_social AS empresa, CONCAT(u.nombres, ' ', u.apellidos) AS comprador, p.metodo_pago
          FROM reembolso rb
          JOIN reserva r ON r.id_reserva = rb.id_reserva
          JOIN usuario u ON u.id_usuario = r.id_usuario
          JOIN viaje v   ON v.id_viaje = r.id_viaje
          JOIN ruta ru   ON ru.id_ruta = v.id_ruta
          JOIN ciudad co ON co.id_ciudad = ru.ciudad_origen
          JOIN ciudad cd ON cd.id_ciudad = ru.ciudad_destino
          JOIN bus b     ON b.id_bus = v.id_bus
          JOIN empresa e ON e.id_empresa = b.id_empresa
          LEFT JOIN pago p ON p.id_pago = rb.id_pago
         WHERE ${filtros.join(' AND ')}
         ORDER BY CASE rb.estado WHEN 'Pendiente' THEN 0 ELSE 1 END, rb.fecha_solicitud DESC`, params);
}

module.exports = { datosReserva, cancelarPorViaje, cancelarPorCliente, procesar, alternativas, reubicar, afectadosDeViaje, listar };
