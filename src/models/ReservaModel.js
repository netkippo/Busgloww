/**
 * MODELO: Reserva (con sus asientos, pagos y boletos)
 * Bloqueo temporal de asientos, confirmación por pago, cancelación y boletos electrónicos (RF22–RF24).
 */
const { query, queryOne, withTransaction } = require('../config/db');
const { HttpError } = require('../utils/http');
const { randomCode } = require('../utils/security');

const SQL_RESERVA = `
    SELECT r.id_reserva, r.id_usuario, r.id_viaje, r.estado, CAST(r.total AS FLOAT) AS total,
           CONVERT(VARCHAR(19), r.fecha_reserva, 120) AS fecha_reserva,
           CONVERT(VARCHAR(19), r.expira_en, 126) AS expira_en,
           DATEDIFF(SECOND, SYSDATETIME(), r.expira_en) AS segundos_restantes
      FROM reserva r`;

function obtener(id) {
    return queryOne(`${SQL_RESERVA} WHERE r.id_reserva = @id`, { id });
}

function asientos(id) {
    return query(`
        SELECT ra.id_reserva_asiento, a.id_asiento, a.numero, a.piso, CAST(ra.precio AS FLOAT) AS precio, ra.activo,
               p.id_pasajero, p.nombres, p.apellidos, p.dni
          FROM reserva_asiento ra
          JOIN asiento a  ON a.id_asiento = ra.id_asiento
          JOIN pasajero p ON p.id_pasajero = ra.id_pasajero
         WHERE ra.id_reserva = @id
         ORDER BY a.fila, a.columna`, { id });
}

function pagos(id) {
    return query(`
        SELECT id_pago, CONVERT(VARCHAR(19), fecha_pago, 120) AS fecha_pago, CAST(monto AS FLOAT) AS monto,
               metodo_pago, estado, codigo
          FROM pago WHERE id_reserva = @id ORDER BY id_pago`, { id });
}

/** Asientos del bus indicados (para validar que pertenecen al viaje). */
function asientosDelBus(idBus, ids) {
    return query(`
        SELECT id_asiento, numero, estado FROM asiento
         WHERE id_bus = @bus AND id_asiento IN (${ids.map(n => parseInt(n, 10)).join(',')})`, { bus: idBus });
}

/**
 * Crea una reserva Pendiente que bloquea los asientos por `minutos` (RF22).
 * El índice único filtrado uq_asiento_viaje_activo impide la doble venta (RF23).
 */
/*
 * Toda la reserva se ejecuta en UN solo lote de T-SQL (una ida y vuelta a la base).
 * Antes eran 3 + 2 por asiento consultas sueltas dentro de la transacción: con carga alta cada una
 * esperaba su turno y los bloqueos de la transacción duraban segundos, frenando a las demás compras
 * (F3.3 POST /reservas llegó a 66 % de error con 250 usuarios y 89 % con 1000).
 * Los asientos y pasajeros viajan como JSON y se leen con OPENJSON (SQL Server 2016 o superior).
 */
const SQL_CREAR_RESERVA = `
    SET NOCOUNT ON;
    SET XACT_ABORT ON;   -- ante cualquier error (p. ej. asiento duplicado) se revierte todo

    DECLARE @lista TABLE (id_asiento INT, dni VARCHAR(8), nombres VARCHAR(100), apellidos VARCHAR(100),
                          telefono VARCHAR(20), id_pasajero INT NULL);
    INSERT INTO @lista (id_asiento, dni, nombres, apellidos, telefono)
    SELECT id_asiento, dni, nombres, apellidos, telefono
      FROM OPENJSON(@json) WITH (id_asiento INT '$.id_asiento', dni VARCHAR(8) '$.dni',
                                 nombres VARCHAR(100) '$.nombres', apellidos VARCHAR(100) '$.apellidos',
                                 telefono VARCHAR(20) '$.telefono');

    BEGIN TRANSACTION;

    -- si el mismo usuario tenía otra reserva pendiente para este viaje, se libera
    UPDATE ra SET activo = 0
      FROM reserva_asiento ra JOIN reserva r ON r.id_reserva = ra.id_reserva
     WHERE r.id_usuario = @u AND r.id_viaje = @v AND r.estado = 'Pendiente' AND ra.activo = 1;
    UPDATE reserva SET estado = 'Cancelada' WHERE id_usuario = @u AND id_viaje = @v AND estado = 'Pendiente';

    -- pasajeros: se registran o actualizan por DNI (HOLDLOCK evita duplicados entre compras simultáneas)
    MERGE pasajero WITH (HOLDLOCK) AS t
    USING (SELECT dni, nombres, apellidos, telefono FROM @lista) AS s ON t.dni = s.dni
    WHEN MATCHED THEN UPDATE SET nombres = s.nombres, apellidos = s.apellidos, telefono = COALESCE(s.telefono, t.telefono)
    WHEN NOT MATCHED THEN INSERT (nombres, apellidos, dni, telefono) VALUES (s.nombres, s.apellidos, s.dni, s.telefono);

    UPDATE l SET id_pasajero = p.id_pasajero FROM @lista l JOIN pasajero p ON p.dni = l.dni;

    DECLARE @nueva TABLE (id_reserva INT);
    INSERT INTO reserva (id_usuario, id_viaje, estado, total, expira_en)
    OUTPUT INSERTED.id_reserva INTO @nueva
    VALUES (@u, @v, 'Pendiente', @total, DATEADD(MINUTE, @min, SYSDATETIME()));

    -- el índice único uq_asiento_viaje_activo impide que otro usuario tome el mismo asiento (RF23)
    INSERT INTO reserva_asiento (id_reserva, id_asiento, id_viaje, id_pasajero, precio)
    SELECT n.id_reserva, l.id_asiento, @v, l.id_pasajero, @precio FROM @lista l CROSS JOIN @nueva n;

    COMMIT TRANSACTION;

    SELECT id_reserva FROM @nueva;`;

async function crear({ idUsuario, viaje, asientos: lista, minutos }) {
    const json = JSON.stringify(lista.map(a => ({
        id_asiento: parseInt(a.id_asiento, 10),
        dni: String(a.pasajero.dni),
        nombres: String(a.pasajero.nombres).trim(),
        apellidos: String(a.pasajero.apellidos).trim(),
        telefono: a.pasajero.telefono ? String(a.pasajero.telefono).trim() : null
    })));
    try {
        const fila = await queryOne(SQL_CREAR_RESERVA, {
            json, u: idUsuario, v: viaje.id_viaje, precio: viaje.precio,
            total: viaje.precio * lista.length, min: minutos
        });
        return fila.id_reserva;
    } catch (err) {
        if (err.number === 2601 || err.number === 2627) {
            throw new HttpError(409, 'Uno de los asientos seleccionados acaba de ser reservado por otro usuario. Elige otro asiento.');
        }
        throw err;
    }
}

function deUsuario(idUsuario) {
    return query(`
        SELECT r.id_reserva, r.estado, CAST(r.total AS FLOAT) AS total,
               CONVERT(VARCHAR(19), r.fecha_reserva, 120) AS fecha_reserva,
               v.id_viaje, v.estado AS estado_viaje,
               CONVERT(VARCHAR(10), v.fecha_salida, 23) AS fecha_salida,
               CONVERT(VARCHAR(5), v.hora_salida, 108) AS hora_salida,
               CASE WHEN v.salida_dt > GETDATE() THEN 1 ELSE 0 END AS futuro,
               DATEDIFF(HOUR, GETDATE(), v.salida_dt) AS horas_para_salida,
               co.nombre AS origen, cd.nombre AS destino, e.razon_social AS empresa, b.tipo_servicio,
               r.motivo_cancelacion, r.id_reserva_origen,
               rb.estado AS estado_reembolso, CAST(rb.monto AS FLOAT) AS monto_reembolso,
               CAST(rb.penalidad AS FLOAT) AS penalidad_reembolso, rb.codigo AS codigo_reembolso,
               STUFF((SELECT ', ' + a.numero FROM reserva_asiento ra JOIN asiento a ON a.id_asiento = ra.id_asiento
                       WHERE ra.id_reserva = r.id_reserva ORDER BY a.fila, a.columna FOR XML PATH('')), 1, 2, '') AS asientos
          FROM reserva r
          JOIN viaje v   ON v.id_viaje = r.id_viaje
          JOIN ruta ru   ON ru.id_ruta = v.id_ruta
          JOIN ciudad co ON co.id_ciudad = ru.ciudad_origen
          JOIN ciudad cd ON cd.id_ciudad = ru.ciudad_destino
          JOIN bus b     ON b.id_bus = v.id_bus
          JOIN empresa e ON e.id_empresa = b.id_empresa
          OUTER APPLY (SELECT TOP 1 x.estado, x.monto, x.penalidad, x.codigo FROM reembolso x
                        WHERE x.id_reserva = r.id_reserva ORDER BY x.id_reembolso DESC) rb
         WHERE r.id_usuario = @u AND r.estado IN ('Confirmada','Pendiente','Cancelada','Reubicada')
         ORDER BY v.salida_dt DESC`, { u: idUsuario });
}

/** Registra un intento de pago rechazado. */
function registrarPagoRechazado(id, monto, metodo, codigo) {
    return query(`INSERT INTO pago (id_reserva, monto, metodo_pago, estado, codigo)
                  VALUES (@r, @m, @metodo, 'Rechazado', @c)`, { r: id, m: monto, metodo, c: codigo });
}

/** Confirma la reserva, registra el pago y emite un boleto por asiento (RF24). */
async function confirmarPago(reserva, metodo, codigo) {
    const id = reserva.id_reserva;
    await withTransaction(async (q, q1) => {
        // Se vuelve a verificar dentro de la transacción (evita doble pago / pago de reserva expirada)
        const ok = await q1(`
            UPDATE reserva SET estado = 'Confirmada', expira_en = NULL
            OUTPUT INSERTED.id_reserva
             WHERE id_reserva = @r AND estado = 'Pendiente' AND expira_en >= SYSDATETIME()`, { r: id });
        if (!ok) throw new HttpError(410, 'El tiempo para pagar expiró. Vuelve a seleccionar tus asientos.');

        await q(`INSERT INTO pago (id_reserva, monto, metodo_pago, estado, codigo)
                 VALUES (@r, @m, @metodo, 'Pagado', @c)`, { r: id, m: reserva.total, metodo, c: codigo });

        for (const a of reserva.asientos.filter(x => x.activo)) {
            await q(`INSERT INTO boleto (id_reserva, id_reserva_asiento, codigo_boleto)
                     VALUES (@r, @ra, @codigo)`, { r: id, ra: a.id_reserva_asiento, codigo: randomCode('BG', 8) });
        }
    });
}

/* La anulación con reembolso está en ReembolsoModel.cancelarPorCliente */

/* ---------- Boletos electrónicos (RF24) ---------- */
const SQL_BOLETO = `
    SELECT bo.codigo_boleto, bo.estado, CONVERT(VARCHAR(16), bo.fecha_emision, 120) AS fecha_emision,
           r.id_reserva, CAST(ra.precio AS FLOAT) AS precio,
           p.nombres, p.apellidos, p.dni,
           a.numero AS asiento, a.piso,
           CONVERT(VARCHAR(10), v.fecha_salida, 23) AS fecha_salida, CONVERT(VARCHAR(5), v.hora_salida, 108) AS hora_salida,
           CONVERT(VARCHAR(10), v.fecha_llegada, 23) AS fecha_llegada, CONVERT(VARCHAR(5), v.hora_llegada, 108) AS hora_llegada,
           v.estado AS estado_viaje,
           co.nombre AS origen, cd.nombre AS destino,
           tor.nombre AS terminal_origen, tor.direccion AS terminal_origen_direccion, tde.nombre AS terminal_destino,
           e.id_empresa, e.razon_social AS empresa, e.ruc, b.placa, b.tipo_servicio
      FROM boleto bo
      JOIN reserva r          ON r.id_reserva = bo.id_reserva
      JOIN reserva_asiento ra ON ra.id_reserva_asiento = bo.id_reserva_asiento
      JOIN pasajero p         ON p.id_pasajero = ra.id_pasajero
      JOIN asiento a          ON a.id_asiento = ra.id_asiento
      JOIN viaje v            ON v.id_viaje = r.id_viaje
      JOIN ruta ru            ON ru.id_ruta = v.id_ruta
      JOIN ciudad co          ON co.id_ciudad = ru.ciudad_origen
      JOIN ciudad cd          ON cd.id_ciudad = ru.ciudad_destino
      LEFT JOIN terminal tor  ON tor.id_terminal = ru.terminal_origen
      LEFT JOIN terminal tde  ON tde.id_terminal = ru.terminal_destino
      JOIN bus b              ON b.id_bus = v.id_bus
      JOIN empresa e          ON e.id_empresa = b.id_empresa`;

function boletos(idReserva) {
    return query(`${SQL_BOLETO} WHERE bo.id_reserva = @id ORDER BY a.fila, a.columna`, { id: idReserva });
}

function boletoPorCodigo(codigo) {
    return queryOne(`${SQL_BOLETO} WHERE bo.codigo_boleto = @c`, { c: String(codigo).toUpperCase() });
}

module.exports = {
    obtener, asientos, pagos, asientosDelBus, crear, deUsuario,
    registrarPagoRechazado, confirmarPago, boletos, boletoPorCodigo
};
