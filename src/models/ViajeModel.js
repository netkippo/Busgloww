/**
 * MODELO: Viaje
 * Consultas y reglas de negocio de los viajes: búsqueda, disponibilidad de asientos,
 * programación, validación de cruces (RF12, RF13), estados, horas reales y retrasos (RF17–RF20).
 *
 * Reglas de programación (versión 3):
 *  - Cruce de horarios del bus con margen configurable (RF12).
 *  - Cadena de ubicación: el bus debe salir desde la ciudad donde terminó su viaje anterior
 *    (o donde está estacionado). Se puede autorizar un "traslado en vacío".
 *  - Conductores: titular + relevos según la duración de la ruta (máx. de horas de conducción)
 *    y descanso mínimo entre viajes (RF13 ampliado).
 *  - Multiempresa: una empresa solo ve y programa sus propios viajes.
 */
const { query, queryOne, withTransaction } = require('../config/db');
const { HttpError } = require('../utils/http');
const Parametro = require('./ParametroModel');
const Reembolso = require('./ReembolsoModel');

/** Estados de viaje permitidos (RF17). */
const ESTADOS = ['Programado', 'Embarcando', 'Proximo a salir', 'Salido', 'Retrasado', 'Cancelado', 'Finalizado'];
/** Estados en los que todavía se pueden vender pasajes. */
const ESTADOS_VENDIBLES = ['Programado', 'Embarcando', 'Proximo a salir', 'Retrasado'];
const IN_VENDIBLES = ESTADOS_VENDIBLES.map(e => `'${e}'`).join(',');

/** Retraso en minutos (RF19): real vs programado; si aún no sale y ya pasó la hora, el retraso acumulado. */
const SQL_RETRASO = `
    CASE
        WHEN v.hora_real_salida IS NOT NULL THEN DATEDIFF(MINUTE, v.salida_dt, v.hora_real_salida)
        WHEN v.estado NOT IN ('Cancelado','Finalizado','Salido') AND GETDATE() > v.salida_dt
            THEN DATEDIFF(MINUTE, v.salida_dt, GETDATE())
        ELSE 0
    END`;

/** Asientos libres de un viaje (sin mantenimiento ni reservas activas). */
const SQL_DISPONIBLES = `
    (SELECT COUNT(*) FROM asiento a
      WHERE a.id_bus = v.id_bus AND a.estado = 'Disponible'
        AND NOT EXISTS (SELECT 1 FROM reserva_asiento ra
                         WHERE ra.id_viaje = v.id_viaje AND ra.id_asiento = a.id_asiento AND ra.activo = 1))`;

const SQL_VENDIDOS = `
    (SELECT COUNT(*) FROM reserva_asiento ra
       JOIN reserva r ON r.id_reserva = ra.id_reserva
      WHERE ra.id_viaje = v.id_viaje AND ra.activo = 1 AND r.estado = 'Confirmada')`;

/** SELECT base de viajes con todos sus datos descriptivos. */
const SQL_BASE = `
    SELECT v.id_viaje, v.id_ruta, v.id_bus, tit.id_conductor,
           CONVERT(VARCHAR(10), v.fecha_salida, 23)  AS fecha_salida,
           CONVERT(VARCHAR(5),  v.hora_salida, 108)  AS hora_salida,
           CONVERT(VARCHAR(10), v.fecha_llegada, 23) AS fecha_llegada,
           CONVERT(VARCHAR(5),  v.hora_llegada, 108) AS hora_llegada,
           CONVERT(VARCHAR(16), v.hora_real_embarque, 120) AS hora_real_embarque,
           CONVERT(VARCHAR(16), v.hora_real_salida, 120)   AS hora_real_salida,
           CONVERT(VARCHAR(16), v.hora_real_llegada, 120)  AS hora_real_llegada,
           v.traslado_vacio,
           CAST(v.precio AS FLOAT) AS precio, v.estado,
           ${SQL_RETRASO} AS retraso_min,
           r.duracion_estimada, r.duracion_minutos, CAST(r.distancia_km AS FLOAT) AS distancia_km,
           co.id_ciudad AS id_origen,  co.nombre AS origen,
           cd.id_ciudad AS id_destino, cd.nombre AS destino,
           tor.nombre AS terminal_origen, tor.direccion AS terminal_origen_direccion,
           tde.nombre AS terminal_destino,
           e.id_empresa, e.razon_social AS empresa, e.logo AS empresa_logo,
           b.placa, b.modelo, b.tipo_servicio, b.capacidad, b.pisos,
           CASE WHEN tit.id_conductor IS NULL THEN NULL ELSE CONCAT(tit.nombres, ' ', tit.apellidos) END AS conductor,
           (SELECT COUNT(*) FROM viaje_conductor vc WHERE vc.id_viaje = v.id_viaje) AS num_conductores,
           STUFF((SELECT ', ' + c2.nombres + ' ' + c2.apellidos
                    FROM viaje_conductor vc2 JOIN conductor c2 ON c2.id_conductor = vc2.id_conductor
                   WHERE vc2.id_viaje = v.id_viaje AND vc2.rol = 'RELEVO'
                   FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS relevos
      FROM viaje v
      JOIN ruta r      ON r.id_ruta = v.id_ruta
      JOIN ciudad co   ON co.id_ciudad = r.ciudad_origen
      JOIN ciudad cd   ON cd.id_ciudad = r.ciudad_destino
      LEFT JOIN terminal tor ON tor.id_terminal = r.terminal_origen
      LEFT JOIN terminal tde ON tde.id_terminal = r.terminal_destino
      JOIN bus b       ON b.id_bus = v.id_bus
      JOIN empresa e   ON e.id_empresa = b.id_empresa
      OUTER APPLY (SELECT TOP 1 c.id_conductor, c.nombres, c.apellidos
                     FROM viaje_conductor vc JOIN conductor c ON c.id_conductor = vc.id_conductor
                    WHERE vc.id_viaje = v.id_viaje AND vc.rol = 'TITULAR') tit`;

/** Agrega columnas calculadas al inicio del SELECT base. */
const baseCon = extra => SQL_BASE.replace('SELECT v.id_viaje', `SELECT ${extra}, v.id_viaje`);

/** Filtro por empresa (null = todas las empresas). */
const filtroEmpresa = (idEmpresa, params) => {
    if (!idEmpresa) return '';
    params.__emp = idEmpresa;
    return ' AND e.id_empresa = @__emp';
};

/* ======================= Consultas ======================= */

/** Obtiene un viaje. Si se indica empresa, el viaje debe pertenecerle. */
async function obtener(id, idEmpresa = null) {
    const params = { id };
    const viaje = await queryOne(`${SQL_BASE} WHERE v.id_viaje = @id${filtroEmpresa(idEmpresa, params)}`, params);
    if (!viaje) throw new HttpError(404, 'El viaje no existe.');
    return viaje;
}

/** Conductores asignados a un viaje (titular primero). */
function conductores(idViaje) {
    return query(`
        SELECT c.id_conductor, c.nombres, c.apellidos, c.dni, c.licencia, c.telefono, vc.rol
          FROM viaje_conductor vc JOIN conductor c ON c.id_conductor = vc.id_conductor
         WHERE vc.id_viaje = @id
         ORDER BY CASE vc.rol WHEN 'TITULAR' THEN 0 ELSE 1 END, c.apellidos`, { id: idViaje });
}

const esVendible = viaje => ESTADOS_VENDIBLES.includes(viaje.estado);

/** Búsqueda de viajes disponibles (se acepta id o nombre de ciudad). */
async function buscar({ origen, destino, fecha, pasajeros }) {
    const filtroCiudad = alias => `(CAST(${alias}.id_ciudad AS VARCHAR(10)) = @${alias} OR ${alias}.nombre = @${alias})`;
    const viajes = await query(`
        SELECT * FROM (
            ${baseCon(`${SQL_DISPONIBLES} AS asientos_disponibles`)}
             WHERE ${filtroCiudad('co')} AND ${filtroCiudad('cd')}
               AND v.fecha_salida = @fecha
               AND v.estado IN (${IN_VENDIBLES})
               AND v.salida_dt > GETDATE()
               AND e.estado = 1
        ) x
        WHERE x.asientos_disponibles >= @pasajeros
        ORDER BY x.hora_salida`,
        { co: String(origen), cd: String(destino), fecha, pasajeros });

    let sugerencias = [];
    if (!viajes.length) {
        sugerencias = await query(`
            SELECT TOP 5 CONVERT(VARCHAR(10), v.fecha_salida, 23) AS fecha, COUNT(*) AS viajes, CAST(MIN(v.precio) AS FLOAT) AS precio_desde
              FROM viaje v
              JOIN ruta r ON r.id_ruta = v.id_ruta
              JOIN ciudad co ON co.id_ciudad = r.ciudad_origen
              JOIN ciudad cd ON cd.id_ciudad = r.ciudad_destino
             WHERE ${filtroCiudad('co')} AND ${filtroCiudad('cd')}
               AND v.salida_dt > GETDATE() AND v.estado IN (${IN_VENDIBLES})
             GROUP BY v.fecha_salida
             ORDER BY ABS(DATEDIFF(DAY, @fecha, v.fecha_salida))`,
            { co: String(origen), cd: String(destino), fecha });
    }
    return { viajes, sugerencias };
}

/** Mapa de asientos con su estado para un viaje (RF21). */
function asientos(idViaje) {
    return query(`
        SELECT a.id_asiento, a.numero, a.piso, a.fila, a.columna,
               CASE
                   WHEN a.estado = 'Mantenimiento' THEN 'Mantenimiento'
                   WHEN r.estado = 'Confirmada'    THEN 'Ocupado'
                   WHEN r.estado = 'Pendiente'     THEN 'Reservado'
                   ELSE 'Disponible'
               END AS estado
          FROM asiento a
          JOIN viaje v ON v.id_bus = a.id_bus AND v.id_viaje = @id
          LEFT JOIN reserva_asiento ra ON ra.id_asiento = a.id_asiento AND ra.id_viaje = v.id_viaje AND ra.activo = 1
          LEFT JOIN reserva r ON r.id_reserva = ra.id_reserva
         ORDER BY a.piso, a.fila, a.columna`, { id: idViaje });
}

function rutasPopulares() {
    return query(`
        SELECT TOP 6 r.id_ruta, co.nombre AS origen, cd.nombre AS destino, r.duracion_estimada,
               CAST(MIN(v.precio) AS FLOAT) AS precio_desde,
               COUNT(DISTINCT e.id_empresa) AS empresas,
               (SELECT COUNT(*) FROM reserva_asiento ra JOIN viaje v2 ON v2.id_viaje = ra.id_viaje
                 WHERE v2.id_ruta = r.id_ruta AND ra.activo = 1
                   AND v2.fecha_salida >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE))) AS vendidos
          FROM ruta r
          JOIN ciudad co ON co.id_ciudad = r.ciudad_origen
          JOIN ciudad cd ON cd.id_ciudad = r.ciudad_destino
          JOIN viaje v   ON v.id_ruta = r.id_ruta AND v.salida_dt > GETDATE() AND v.estado IN (${IN_VENDIBLES})
          JOIN bus b     ON b.id_bus = v.id_bus
          JOIN empresa e ON e.id_empresa = b.id_empresa
         WHERE r.estado = 1
         GROUP BY r.id_ruta, co.nombre, cd.nombre, r.duracion_estimada
         ORDER BY vendidos DESC`);
}

/** Programación diaria (RF14). */
function programacionDiaria({ fecha, idRuta, estado, idEmpresa }) {
    const filtros = ['v.fecha_salida = @fecha'];
    const params = { fecha };
    if (idEmpresa) { filtros.push('e.id_empresa = @emp'); params.emp = idEmpresa; }
    if (idRuta) { filtros.push('v.id_ruta = @ruta'); params.ruta = idRuta; }
    if (estado) { filtros.push('v.estado = @estado'); params.estado = estado; }
    return query(`
        ${baseCon(`${SQL_DISPONIBLES} AS asientos_disponibles, ${SQL_VENDIDOS} AS vendidos`)}
         WHERE ${filtros.join(' AND ')}
         ORDER BY v.salida_dt`, params);
}

function pasajeros(idViaje) {
    return query(`
        SELECT a.numero AS asiento, p.nombres, p.apellidos, p.dni, p.telefono, r.estado AS estado_reserva,
               bo.codigo_boleto, bo.estado AS estado_boleto
          FROM reserva_asiento ra
          JOIN reserva r  ON r.id_reserva = ra.id_reserva
          JOIN asiento a  ON a.id_asiento = ra.id_asiento
          JOIN pasajero p ON p.id_pasajero = ra.id_pasajero
          LEFT JOIN boleto bo ON bo.id_reserva_asiento = ra.id_reserva_asiento
         WHERE ra.id_viaje = @id AND ra.activo = 1
         ORDER BY a.fila, a.columna`, { id: idViaje });
}

function modificaciones(idViaje) {
    return query(`
        SELECT m.tipo, m.valor_anterior, m.valor_nuevo, m.motivo, CONVERT(VARCHAR(16), m.fecha, 120) AS fecha,
               CONCAT(u.nombres, ' ', u.apellidos) AS usuario
          FROM viaje_modificacion m LEFT JOIN usuario u ON u.id_usuario = m.id_usuario
         WHERE m.id_viaje = @id ORDER BY m.fecha DESC`, { id: idViaje });
}

/**
 * Alertas (RF20): viajes retrasados (últimas 24 h), salidas en los próximos 60 minutos
 * y viajes de las próximas 24 h sin la tripulación completa (titular + relevos).
 */
async function alertas(idEmpresa = null) {
    const p = await Parametro.obtener();
    const params = { maxh: p.max_horas_conduccion };
    const emp = filtroEmpresa(idEmpresa, params);
    const base = baseCon('DATEDIFF(MINUTE, GETDATE(), v.salida_dt) AS minutos_para_salida');
    const retrasados = await query(`
        SELECT * FROM (${base}
         WHERE v.estado NOT IN ('Cancelado','Finalizado')
           AND v.salida_dt BETWEEN DATEADD(HOUR, -24, GETDATE()) AND GETDATE()${emp}) x
        WHERE x.retraso_min > 5
        ORDER BY x.retraso_min DESC`, params);
    const proximos = await query(`
        ${base}
         WHERE v.estado IN ('Programado','Embarcando','Proximo a salir')
           AND v.salida_dt BETWEEN GETDATE() AND DATEADD(MINUTE, 60, GETDATE())${emp}
         ORDER BY v.salida_dt`, params);
    const sinTripulacion = await query(`
        SELECT * FROM (${base}
         WHERE v.estado IN ('Programado','Embarcando','Proximo a salir','Retrasado')
           AND v.salida_dt BETWEEN DATEADD(HOUR, -2, GETDATE()) AND DATEADD(HOUR, 24, GETDATE())${emp}) x
        WHERE x.num_conductores < CEILING(x.duracion_minutos / (@maxh * 60.0))
        ORDER BY x.minutos_para_salida`, params);
    sinTripulacion.forEach(v => { v.conductores_requeridos = Parametro.conductoresRequeridos(v.duracion_minutos, p); });
    return { retrasados, proximos, sinTripulacion };
}

/* ======================= Reglas de negocio ======================= */

/** Calcula fecha/hora de llegada a partir de la salida y la duración (minutos). */
function calcularLlegada(fecha, hora, minutos) {
    const [y, m, d] = fecha.split('-').map(Number);
    const [hh, mm] = hora.split(':').map(Number);
    const salida = new Date(y, m - 1, d, hh, mm);
    const llegada = new Date(salida.getTime() + minutos * 60000);
    const pad = n => String(n).padStart(2, '0');
    const fl = `${llegada.getFullYear()}-${pad(llegada.getMonth() + 1)}-${pad(llegada.getDate())}`;
    const hl = `${pad(llegada.getHours())}:${pad(llegada.getMinutes())}`;
    return {
        // Formato ISO con 'T' (independiente del idioma/DATEFORMAT de SQL Server)
        salida: `${fecha}T${pad(hh)}:${pad(mm)}:00`,
        fecha_llegada: fl,
        hora_llegada: hl,
        llegada: `${fl}T${hl}:00`
    };
}

/* ---------- Estado de buses y conductores para un horario dado ---------- */

/**
 * Evalúa cada bus (o uno solo) para un viaje que sale @salida y llega @llegada:
 *  - viaje_cruce: otro viaje del bus que se cruza (con el margen configurado)
 *  - ubicación: ciudad donde estará el bus (destino de su viaje anterior o donde está estacionado)
 *  - viaje siguiente: su origen debe coincidir con el destino del nuevo viaje
 */
async function estadoBuses({ salida, llegada, excluir = 0, idEmpresa = null, idBus = null }, p) {
    const params = { salida, llegada, excluir, margen: p.margen_bus_minutos };
    let filtro = '';
    if (idEmpresa) { filtro += ' AND b.id_empresa = @emp'; params.emp = idEmpresa; }
    if (idBus) { filtro += ' AND b.id_bus = @bus'; params.bus = idBus; }
    return query(`
        DECLARE @s DATETIME = CAST(@salida AS DATETIME), @l DATETIME = CAST(@llegada AS DATETIME);
        SELECT b.id_bus, b.placa, b.modelo, b.tipo_servicio, b.capacidad, b.id_empresa, b.estado, e.razon_social AS empresa,
               COALESCE(prev.ciudad_destino, ta.id_ciudad) AS id_ciudad_ubicacion,
               COALESCE(cp.nombre, ct.nombre) AS ubicacion,
               prev.id_viaje AS viaje_previo, CONVERT(VARCHAR(16), prev.llegada_efectiva, 120) AS llegada_previa,
               cruce.id_viaje AS viaje_cruce,
               CONVERT(VARCHAR(16), cruce.salida_dt, 120) AS cruce_salida, CONVERT(VARCHAR(16), cruce.llegada_efectiva, 120) AS cruce_llegada,
               sig.id_viaje AS viaje_siguiente, sig.ciudad_origen AS siguiente_origen, sig.traslado_vacio AS siguiente_traslado,
               cs.nombre AS siguiente_origen_nombre, CONVERT(VARCHAR(16), sig.salida_dt, 120) AS siguiente_salida
          FROM bus b
          JOIN empresa e ON e.id_empresa = b.id_empresa
          LEFT JOIN terminal ta ON ta.id_terminal = b.id_terminal_actual
          LEFT JOIN ciudad ct   ON ct.id_ciudad = ta.id_ciudad
          OUTER APPLY (SELECT TOP 1 v.id_viaje, v.llegada_efectiva, r.ciudad_destino
                         FROM viaje v JOIN ruta r ON r.id_ruta = v.id_ruta
                        WHERE v.id_bus = b.id_bus AND v.estado <> 'Cancelado' AND v.id_viaje <> @excluir AND v.salida_dt < @s
                        ORDER BY v.salida_dt DESC) prev
          LEFT JOIN ciudad cp ON cp.id_ciudad = prev.ciudad_destino
          OUTER APPLY (SELECT TOP 1 v.id_viaje, v.salida_dt, v.llegada_efectiva
                         FROM viaje v
                        WHERE v.id_bus = b.id_bus AND v.estado <> 'Cancelado' AND v.id_viaje <> @excluir
                          AND v.salida_dt < DATEADD(MINUTE, @margen, @l)
                          AND DATEADD(MINUTE, @margen, v.llegada_efectiva) > @s
                        ORDER BY v.salida_dt) cruce
          OUTER APPLY (SELECT TOP 1 v.id_viaje, v.salida_dt, v.traslado_vacio, r.ciudad_origen
                         FROM viaje v JOIN ruta r ON r.id_ruta = v.id_ruta
                        WHERE v.id_bus = b.id_bus AND v.estado <> 'Cancelado' AND v.id_viaje <> @excluir AND v.salida_dt > @s
                        ORDER BY v.salida_dt) sig
          LEFT JOIN ciudad cs ON cs.id_ciudad = sig.ciudad_origen
         WHERE 1 = 1${filtro}
         ORDER BY e.razon_social, b.placa`, params);
}

/** Explica por qué un bus no puede hacer el viaje (null si puede). */
function motivoBus(b, ruta, trasladoVacio) {
    if (!b.estado) return 'El bus está inactivo.';
    if (!b.capacidad) return 'El bus no tiene asientos registrados.';
    if (b.viaje_cruce) {
        return `El bus ya está asignado al viaje #${b.viaje_cruce} (${b.cruce_salida} → ${b.cruce_llegada}). Los horarios son incompatibles.`;
    }
    if (!trasladoVacio && b.id_ciudad_ubicacion && b.id_ciudad_ubicacion !== ruta.ciudad_origen) {
        return b.viaje_previo
            ? `El bus estará en ${b.ubicacion} (llega del viaje #${b.viaje_previo} el ${b.llegada_previa}) y este viaje sale de ${ruta.origen}. ` +
              `Programa antes un viaje ${b.ubicacion} → ${ruta.origen} o autoriza un traslado en vacío.`
            : `El bus está en ${b.ubicacion} y este viaje sale de ${ruta.origen}. Autoriza un traslado en vacío o elige otro bus.`;
    }
    if (b.viaje_siguiente && !b.siguiente_traslado && b.siguiente_origen !== ruta.ciudad_destino) {
        return `El siguiente viaje del bus (#${b.viaje_siguiente}, ${b.siguiente_salida}) sale de ${b.siguiente_origen_nombre}, ` +
               `pero este viaje termina en ${ruta.destino}. El bus no llegaría a tiempo a su siguiente salida.`;
    }
    return null;
}

/**
 * Evalúa a cada conductor (o a una lista) para el viaje: busca el viaje más cercano que
 * se cruce con el viaje nuevo o que no deje el descanso mínimo antes o después.
 */
async function estadoConductores({ salida, llegada, excluir = 0, idEmpresa = null, ids = null }, p) {
    const params = { salida, llegada, excluir, descanso: Math.round(p.horas_descanso_conductor * 60) };
    let filtro = '';
    if (idEmpresa) { filtro += ' AND c.id_empresa = @emp'; params.emp = idEmpresa; }
    if (ids) {
        if (!ids.length) return [];
        ids.forEach((id, i) => { params[`c${i}`] = id; });
        filtro += ` AND c.id_conductor IN (${ids.map((_, i) => `@c${i}`).join(', ')})`;
    }
    return query(`
        DECLARE @s DATETIME = CAST(@salida AS DATETIME), @l DATETIME = CAST(@llegada AS DATETIME);
        SELECT c.id_conductor, c.nombres, c.apellidos, c.id_empresa, c.estado, e.razon_social AS empresa,
               cf.id_viaje AS viaje_conflicto,
               CONVERT(VARCHAR(16), cf.salida_dt, 120) AS conflicto_salida,
               CONVERT(VARCHAR(16), cf.llegada_efectiva, 120) AS conflicto_llegada,
               CASE WHEN cf.salida_dt < @l AND cf.llegada_efectiva > @s THEN 1 ELSE 0 END AS simultaneo,
               CASE WHEN cf.salida_dt >= @l THEN 1 ELSE 0 END AS conflicto_posterior,
               CONVERT(VARCHAR(16), DATEADD(MINUTE, @descanso, cf.llegada_efectiva), 120) AS descansado_desde,
               CONVERT(VARCHAR(16), ult.llegada_efectiva, 120) AS ultima_llegada
          FROM conductor c
          JOIN empresa e ON e.id_empresa = c.id_empresa
          OUTER APPLY (SELECT TOP 1 v.id_viaje, v.salida_dt, v.llegada_efectiva
                         FROM viaje v JOIN viaje_conductor vc ON vc.id_viaje = v.id_viaje
                        WHERE vc.id_conductor = c.id_conductor AND v.estado <> 'Cancelado' AND v.id_viaje <> @excluir
                          AND v.salida_dt < DATEADD(MINUTE, @descanso, @l)
                          AND DATEADD(MINUTE, @descanso, v.llegada_efectiva) > @s
                        ORDER BY v.salida_dt) cf
          OUTER APPLY (SELECT TOP 1 v.llegada_efectiva
                         FROM viaje v JOIN viaje_conductor vc ON vc.id_viaje = v.id_viaje
                        WHERE vc.id_conductor = c.id_conductor AND v.estado <> 'Cancelado' AND v.id_viaje <> @excluir
                          AND v.llegada_efectiva <= @s
                        ORDER BY v.salida_dt DESC) ult
         WHERE 1 = 1${filtro}
         ORDER BY e.razon_social, c.apellidos`, params);
}

/**
 * Explica por qué un conductor no puede hacer el viaje (null si puede).
 * conNombre = false omite el nombre (para las listas del formulario).
 */
function motivoConductor(c, p, conNombre = true) {
    const sujeto = conNombre ? `El conductor ${c.nombres} ${c.apellidos} ` : '';
    const frase = texto => sujeto + (conNombre ? texto : texto.charAt(0).toUpperCase() + texto.slice(1));
    if (!c.estado) return frase('está inactivo.');
    if (!c.viaje_conflicto) return null;
    if (c.simultaneo) {
        return frase(`ya está asignado al viaje #${c.viaje_conflicto} (${c.conflicto_salida} → ${c.conflicto_llegada}). ` +
                     'No puede tener viajes simultáneos.');
    }
    if (c.conflicto_posterior) {
        return frase(`no descansaría ${p.horas_descanso_conductor} h antes de su viaje #${c.viaje_conflicto} (sale ${c.conflicto_salida}).`);
    }
    return frase(`llega del viaje #${c.viaje_conflicto} el ${c.conflicto_llegada} y debe descansar ` +
                 `${p.horas_descanso_conductor} h: está disponible desde ${c.descansado_desde}.`);
}

/** Datos de la ruta necesarios para programar. */
async function datosRuta(idRuta) {
    const ruta = await queryOne(`
        SELECT r.id_ruta, r.duracion_minutos, r.estado, r.ciudad_origen, r.ciudad_destino, r.terminal_destino,
               co.nombre AS origen, cd.nombre AS destino
          FROM ruta r JOIN ciudad co ON co.id_ciudad = r.ciudad_origen JOIN ciudad cd ON cd.id_ciudad = r.ciudad_destino
         WHERE r.id_ruta = @id`, { id: idRuta });
    if (!ruta || !ruta.estado) throw new HttpError(400, 'La ruta no existe o está inactiva.');
    return ruta;
}

/**
 * Buses y conductores disponibles para una ruta, fecha y hora (ayuda al programar).
 * Devuelve cada recurso con `disponible` y, si no lo está, el `motivo`.
 */
async function disponibilidad({ id_ruta, fecha_salida, hora_salida, excluir = 0, traslado_vacio = false, idEmpresa = null }) {
    const ruta = await datosRuta(id_ruta);
    const p = await Parametro.obtener();
    const t = calcularLlegada(fecha_salida, hora_salida.slice(0, 5), ruta.duracion_minutos);
    const ctx = { salida: t.salida, llegada: t.llegada, excluir, idEmpresa };
    const buses = (await estadoBuses(ctx, p)).filter(b => b.estado).map(b => {
        const motivo = motivoBus(b, ruta, traslado_vacio);
        return { id_bus: b.id_bus, placa: b.placa, empresa: b.empresa, id_empresa: b.id_empresa, tipo_servicio: b.tipo_servicio,
                 capacidad: b.capacidad, ubicacion: b.ubicacion, disponible: !motivo, motivo };
    });
    const conductoresLista = (await estadoConductores(ctx, p)).filter(c => c.estado).map(c => {
        const motivo = motivoConductor(c, p, false);
        return { id_conductor: c.id_conductor, nombre: `${c.apellidos}, ${c.nombres}`, empresa: c.empresa, id_empresa: c.id_empresa,
                 ultima_llegada: c.ultima_llegada, disponible: !motivo, motivo };
    });
    return {
        ruta: `${ruta.origen} → ${ruta.destino}`, salida: t.salida, llegada: t.llegada,
        conductores_requeridos: Parametro.conductoresRequeridos(ruta.duracion_minutos, p),
        parametros: p, buses, conductores: conductoresLista
    };
}

/**
 * Valida ruta, bus, conductores, ubicación y descansos; devuelve las horas calculadas (RF11–RF13).
 * datos: { id_ruta, id_bus, conductores: [ids, el primero es el titular], fecha_salida, hora_salida, traslado_vacio }
 */
async function prepararProgramacion(datos, excluirViaje = 0, idEmpresa = null) {
    const ruta = await datosRuta(datos.id_ruta);
    const bus = await queryOne('SELECT id_bus, id_empresa, estado, capacidad FROM bus WHERE id_bus = @id', { id: datos.id_bus });
    if (!bus || (idEmpresa && bus.id_empresa !== idEmpresa)) throw new HttpError(400, 'El bus no existe.');
    if (!bus.estado) throw new HttpError(400, 'El bus está inactivo.');
    if (!bus.capacidad) throw new HttpError(400, 'El bus no tiene asientos registrados.');

    const ids = datos.conductores || [];
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Un conductor no puede figurar dos veces en el mismo viaje.');

    const p = await Parametro.obtener();
    const requeridos = Parametro.conductoresRequeridos(ruta.duracion_minutos, p);
    if (ids.length && ids.length < requeridos) {
        const horas = Math.round(ruta.duracion_minutos / 6) / 10;
        throw new HttpError(400,
            `La ruta ${ruta.origen} → ${ruta.destino} dura ${horas} h y cada conductor puede manejar máximo ` +
            `${p.max_horas_conduccion} h: asigna ${requeridos} conductores (titular + ${requeridos - 1} relevo${requeridos > 2 ? 's' : ''}).`);
    }

    const t = calcularLlegada(datos.fecha_salida, datos.hora_salida.slice(0, 5), ruta.duracion_minutos);
    const ctx = { salida: t.salida, llegada: t.llegada, excluir: excluirViaje };

    // Bus: cruce de horarios y cadena de ubicación (RF12)
    const [estadoBus] = await estadoBuses({ ...ctx, idBus: bus.id_bus }, p);
    const motivo = motivoBus(estadoBus, ruta, !!datos.traslado_vacio);
    if (motivo) throw new HttpError(409, motivo);

    // Conductores: misma empresa, sin viajes simultáneos y con descanso suficiente (RF13)
    const estados = await estadoConductores({ ...ctx, ids }, p);
    for (const id of ids) {
        const c = estados.find(x => x.id_conductor === id);
        if (!c) throw new HttpError(400, 'Uno de los conductores no existe.');
        if (c.id_empresa !== bus.id_empresa) throw new HttpError(400, `El conductor ${c.nombres} ${c.apellidos} no pertenece a la empresa del bus.`);
        const m = motivoConductor(c, p);
        if (m) throw new HttpError(409, m);
    }
    return { ...t, requeridos, ruta };
}

/** Inserta un viaje ya validado junto con su tripulación. */
async function crear(datos, t, precio) {
    return withTransaction(async (q, q1) => {
        const row = await q1(`
            INSERT INTO viaje (id_ruta, id_bus, fecha_salida, hora_salida, fecha_llegada, hora_llegada, precio, traslado_vacio)
            OUTPUT INSERTED.id_viaje
            VALUES (@id_ruta, @id_bus, @fecha_salida, @hora_salida, @fecha_llegada, @hora_llegada, @precio, @traslado)`,
            { id_ruta: datos.id_ruta, id_bus: datos.id_bus, fecha_salida: datos.fecha_salida, hora_salida: datos.hora_salida,
              fecha_llegada: t.fecha_llegada, hora_llegada: t.hora_llegada, precio, traslado: !!datos.traslado_vacio });
        await asignarConductores(q, row.id_viaje, datos.conductores || []);
        return row.id_viaje;
    });
}

/** Reemplaza la tripulación de un viaje (el primero de la lista es el titular). */
async function asignarConductores(q, idViaje, ids) {
    await q('DELETE FROM viaje_conductor WHERE id_viaje = @v', { v: idViaje });
    for (let i = 0; i < ids.length; i++) {
        await q('INSERT INTO viaje_conductor (id_viaje, id_conductor, rol) VALUES (@v, @c, @rol)',
            { v: idViaje, c: ids[i], rol: i === 0 ? 'TITULAR' : 'RELEVO' });
    }
}

/** Datos de un horario activo, para programar viajes en lote. */
function obtenerHorario(idHorario) {
    return queryOne(`
        SELECT id_horario, id_ruta, id_empresa, CONVERT(VARCHAR(5), hora_salida, 108) AS hora_salida, CAST(precio_base AS FLOAT) AS precio_base
          FROM horario WHERE id_horario = @id AND estado = 1`, { id: idHorario });
}

/** Reprograma un viaje y registra el motivo (RF15, RF16). */
async function reprogramar(v, datos, t, idUsuario, motivo) {
    if (datos.id_bus !== v.id_bus) {
        // El nuevo bus debe tener todos los asientos ya vendidos
        const faltantes = await queryOne(`
            SELECT COUNT(*) AS n FROM reserva_asiento ra JOIN asiento a ON a.id_asiento = ra.id_asiento
             WHERE ra.id_viaje = @id AND ra.activo = 1
               AND NOT EXISTS (SELECT 1 FROM asiento a2 WHERE a2.id_bus = @bus AND a2.numero = a.numero)`,
            { id: v.id_viaje, bus: datos.id_bus });
        if (faltantes.n > 0) throw new HttpError(409, 'El nuevo bus no tiene la misma distribución de asientos vendidos.');
    }
    const bus = await queryOne('SELECT placa FROM bus WHERE id_bus = @id', { id: datos.id_bus });
    const antes = `${v.fecha_salida} ${v.hora_salida} | bus ${v.placa} | ${v.num_conductores} conductor(es)`;
    const despues = `${datos.fecha_salida} ${datos.hora_salida} | bus ${bus ? bus.placa : datos.id_bus} | ${datos.conductores.length} conductor(es)`;
    const id = v.id_viaje;

    await withTransaction(async q => {
        if (datos.id_bus !== v.id_bus) {
            // Reasignar los asientos vendidos a los equivalentes del nuevo bus
            await q(`
                UPDATE ra SET id_asiento = a2.id_asiento
                  FROM reserva_asiento ra
                  JOIN asiento a  ON a.id_asiento = ra.id_asiento
                  JOIN asiento a2 ON a2.id_bus = @bus AND a2.numero = a.numero
                 WHERE ra.id_viaje = @id`, { id, bus: datos.id_bus });
        }
        await q(`
            UPDATE viaje SET id_bus = @id_bus, traslado_vacio = @traslado,
                   fecha_salida = @fecha_salida, hora_salida = @hora_salida,
                   fecha_llegada = @fecha_llegada, hora_llegada = @hora_llegada,
                   estado = CASE WHEN estado = 'Retrasado' THEN 'Programado' ELSE estado END
             WHERE id_viaje = @id`,
            { id_bus: datos.id_bus, traslado: !!datos.traslado_vacio, fecha_salida: datos.fecha_salida, hora_salida: datos.hora_salida,
              fecha_llegada: t.fecha_llegada, hora_llegada: t.hora_llegada, id });
        await asignarConductores(q, id, datos.conductores);
        await q(`
            INSERT INTO viaje_modificacion (id_viaje, id_usuario, tipo, valor_anterior, valor_nuevo, motivo)
            VALUES (@id, @u, 'REPROGRAMACION', @antes, @despues, @motivo)`,
            { id, u: idUsuario, antes, despues, motivo });
    });
}

/**
 * Cambia el estado y registra horas reales (RF17, RF18).
 * Cancelar anula los boletos, deja un reembolso pendiente por reserva pagada y avisa a los pasajeros.
 * Al finalizar se guarda la hora real de llegada (para el descanso del conductor)
 * y la nueva ubicación del bus (terminal de destino).
 */
async function cambiarEstado(v, estado, horaReal, idUsuario, motivo) {
    const id = v.id_viaje;
    let afectados = 0;
    await withTransaction(async q => {
        await q(`
            UPDATE viaje SET estado = @estado,
                   hora_real_embarque = CASE WHEN @estado = 'Embarcando' THEN COALESCE(CAST(@hora AS DATETIME2(0)), SYSDATETIME())
                                             ELSE hora_real_embarque END,
                   hora_real_salida   = CASE WHEN @estado = 'Salido' THEN COALESCE(CAST(@hora AS DATETIME2(0)), SYSDATETIME())
                                             ELSE hora_real_salida END,
                   hora_real_llegada  = CASE WHEN @estado = 'Finalizado' THEN COALESCE(CAST(@hora AS DATETIME2(0)), SYSDATETIME())
                                             ELSE hora_real_llegada END
             WHERE id_viaje = @id`, { estado, hora: horaReal, id });

        if (estado === 'Cancelado') {
            // Reservas canceladas, asientos liberados, boletos anulados, reembolsos pendientes y avisos
            afectados = await Reembolso.cancelarPorViaje(q, v, motivo);
        }
        if (estado === 'Finalizado') {
            await q(`UPDATE bo SET estado = 'Utilizado' FROM boleto bo JOIN reserva r ON r.id_reserva = bo.id_reserva
                      WHERE r.id_viaje = @id AND bo.estado = 'Vigente'`, { id });
            await q(SQL_UBICAR_BUS + ' WHERE v.id_viaje = @id', { id });
        }

        await q(`
            INSERT INTO viaje_modificacion (id_viaje, id_usuario, tipo, valor_anterior, valor_nuevo, motivo)
            VALUES (@id, @u, 'ESTADO', @antes, @estado, @motivo)`,
            { id, u: idUsuario, antes: v.estado, estado, motivo: motivo || 'Actualización operativa' });
    });
    return { afectados };
}

/* ======================= Tareas automáticas ======================= */

/** Actualiza la última ubicación del bus con el terminal de destino del viaje finalizado. */
const SQL_UBICAR_BUS = `
    UPDATE b SET id_terminal_actual = COALESCE(r.terminal_destino,
               (SELECT MIN(t.id_terminal) FROM terminal t WHERE t.id_ciudad = r.ciudad_destino), b.id_terminal_actual)
      FROM bus b
      JOIN viaje v ON v.id_bus = b.id_bus
      JOIN ruta r  ON r.id_ruta = v.id_ruta`;

/**
 * Libera los asientos de reservas pendientes cuyo tiempo de bloqueo venció.
 *
 * Rendimiento: antes se ejecutaba un UPDATE en cada búsqueda y en cada mapa de asientos, y con
 * cientos de usuarios esas escrituras bloqueaban la base (pruebas con JMeter). Ahora:
 *  - solo escribe si de verdad hay reservas vencidas (IF EXISTS sobre un índice filtrado);
 *  - las consultas de lectura la ejecutan como máximo una vez cada 15 s (`forzar: false`);
 *  - si ya se está ejecutando, las demás peticiones no lanzan otra en paralelo.
 * Al reservar se fuerza, para liberar al instante un asiento cuyo bloqueo acaba de vencer.
 */
const INTERVALO_LIBERACION_MS = 15000;
let ultimaLiberacion = 0;
let liberacionEnCurso = null;

function liberarReservasExpiradas({ forzar = false } = {}) {
    if (liberacionEnCurso) return liberacionEnCurso;
    if (!forzar && Date.now() - ultimaLiberacion < INTERVALO_LIBERACION_MS) return Promise.resolve();
    ultimaLiberacion = Date.now();
    liberacionEnCurso = query(`
        IF EXISTS (SELECT 1 FROM reserva WHERE estado = 'Pendiente' AND expira_en < SYSDATETIME())
        BEGIN
            UPDATE ra SET activo = 0
              FROM reserva_asiento ra
              JOIN reserva r ON r.id_reserva = ra.id_reserva
             WHERE r.estado = 'Pendiente' AND r.expira_en < SYSDATETIME() AND ra.activo = 1;

            UPDATE reserva SET estado = 'Expirada'
             WHERE estado = 'Pendiente' AND expira_en < SYSDATETIME();
        END`).finally(() => { liberacionEnCurso = null; });
    return liberacionEnCurso;
}

/**
 * Actualiza estados automáticamente:
 *  - viajes que no salieron 5 min después de su hora -> Retrasado
 *  - viajes salidos cuya hora de llegada pasó -> Finalizado (boletos -> Utilizado)
 */
async function actualizarEstadosAutomaticos() {
    await query(`
        UPDATE viaje SET estado = 'Retrasado'
         WHERE estado IN ('Programado','Embarcando','Proximo a salir')
           AND hora_real_salida IS NULL
           AND DATEADD(MINUTE, 5, salida_dt) < GETDATE()
           AND salida_dt > DATEADD(DAY, -2, GETDATE());

        UPDATE b SET estado = 'Utilizado'
          FROM boleto b
          JOIN reserva r ON r.id_reserva = b.id_reserva
          JOIN viaje v ON v.id_viaje = r.id_viaje
         WHERE v.estado = 'Salido' AND v.llegada_dt < GETDATE() AND b.estado = 'Vigente';

        DECLARE @fin TABLE (id_viaje INT);
        UPDATE viaje
           SET estado = 'Finalizado',
               -- llegada estimada: la programada más el retraso con que salió
               hora_real_llegada = DATEADD(MINUTE, DATEDIFF(MINUTE, salida_dt, hora_real_salida), llegada_dt)
        OUTPUT INSERTED.id_viaje INTO @fin
         WHERE estado = 'Salido' AND DATEADD(MINUTE, DATEDIFF(MINUTE, salida_dt, hora_real_salida), llegada_dt) < GETDATE();

        -- si un bus finalizó varios viajes a la vez, queda en el destino del más reciente
        UPDATE b SET id_terminal_actual = COALESCE(r.terminal_destino,
                   (SELECT MIN(t.id_terminal) FROM terminal t WHERE t.id_ciudad = r.ciudad_destino), b.id_terminal_actual)
          FROM bus b
          CROSS APPLY (SELECT TOP 1 v.id_ruta FROM viaje v
                        WHERE v.id_bus = b.id_bus AND v.id_viaje IN (SELECT id_viaje FROM @fin)
                        ORDER BY v.salida_dt DESC) lv
          JOIN ruta r ON r.id_ruta = lv.id_ruta;`);
}

module.exports = {
    ESTADOS, ESTADOS_VENDIBLES, esVendible,
    obtener, buscar, asientos, rutasPopulares, programacionDiaria, pasajeros, modificaciones, alertas,
    conductores, disponibilidad, estadoBuses, estadoConductores,
    calcularLlegada, prepararProgramacion, crear, obtenerHorario, reprogramar, cambiarEstado,
    liberarReservasExpiradas, actualizarEstadosAutomaticos
};
