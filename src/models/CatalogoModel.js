/**
 * MODELO: Catálogos del sistema (CRUD genérico con lista blanca de columnas)
 *   empresas, buses (RF5, RF6), conductores (RF7), ciudades, terminales (RF8),
 *   rutas (RF9), horarios (RF10), pasajeros (RF4), usuarios (RF1, RF3), parámetros
 *
 * Cada recurso define:
 *   table / pk : tabla y clave primaria
 *   fields     : columnas editables { nombre: {required, type} }
 *   list       : SELECT para listar (debe exponer la PK)
 *   prepare    : validaciones/transformaciones antes de guardar (puede ser async)
 *   afterCreate: acción posterior a crear
 *   acceso     : roles permitidos por acción { leer, crear, editar, eliminar } (por defecto, solo ADMIN)
 *   scope      : columna de empresa; un usuario de empresa solo ve y modifica sus propios registros
 */
const { query, queryOne } = require('../config/db');
const { HttpError, isDni, isEmail, isTime } = require('../utils/http');
const { hashPassword, passwordError } = require('../utils/security');

const bool = v => v === true || v === 1 || v === '1' || v === 'true';

/* Perfiles de acceso reutilizables */
const SOLO_ADMIN = { leer: ['ADMIN'], crear: ['ADMIN'], editar: ['ADMIN'], eliminar: ['ADMIN'] };
const FLOTA = { leer: ['ADMIN', 'EMPRESA'], crear: ['ADMIN', 'EMPRESA'], editar: ['ADMIN', 'EMPRESA'], eliminar: ['ADMIN', 'EMPRESA'] };
const CATALOGO_COMUN = { ...SOLO_ADMIN, leer: ['ADMIN', 'EMPRESA'] };   // ciudades, terminales y rutas de la plataforma
const esEmpresa = ctx => !!(ctx && ctx.idEmpresa);

/**
 * Definición de recursos.
 *  fields   : columnas editables { nombre: {required, type} }
 *  list     : SELECT para listar (debe exponer la PK)
 *  prepare  : validaciones/transformaciones antes de guardar (puede ser async)
 *  after    : acción posterior a crear/actualizar
 */
const recursos = {
    empresas: {
        table: 'empresa', pk: 'id_empresa',
        fields: {
            razon_social: { required: true }, ruc: { required: true }, telefono: {}, correo: {},
            direccion: {}, logo: {}, estado: { type: 'bool' }
        },
        list: `SELECT e.*, (SELECT COUNT(*) FROM bus b WHERE b.id_empresa = e.id_empresa) AS buses FROM empresa e`,
        order: 'razon_social',
        acceso: { ...SOLO_ADMIN, leer: ['ADMIN', 'EMPRESA'], editar: ['ADMIN', 'EMPRESA'] },
        scope: 'id_empresa',
        prepare: (d, actual, ctx) => {
            // La empresa edita sus datos de contacto; el RUC y la activación los gestiona la plataforma
            if (esEmpresa(ctx)) { delete d.ruc; delete d.estado; }
            if (d.ruc !== undefined && !/^\d{11}$/.test(d.ruc)) throw new HttpError(400, 'El RUC debe tener 11 dígitos.');
            if (d.correo && !isEmail(d.correo)) throw new HttpError(400, 'Correo inválido.');
        }
    },
    buses: {
        table: 'bus', pk: 'id_bus',
        fields: {
            id_empresa: { required: true, type: 'int' }, placa: { required: true }, modelo: {},
            tipo_servicio: { required: true }, id_terminal_actual: { type: 'int' }, estado: { type: 'bool' }
        },
        // Ubicación: último terminal conocido; "En ruta" si tiene un viaje en curso
        list: `SELECT b.*, e.razon_social AS empresa,
                      (SELECT COUNT(*) FROM asiento a WHERE a.id_bus = b.id_bus AND a.estado = 'Mantenimiento') AS asientos_mantenimiento,
                      CASE WHEN ta.id_terminal IS NULL THEN NULL ELSE CONCAT(ct.nombre, ' · ', ta.nombre) END AS ubicacion,
                      (SELECT TOP 1 CONCAT(N'En ruta a ', cd.nombre) FROM viaje v
                         JOIN ruta r ON r.id_ruta = v.id_ruta JOIN ciudad cd ON cd.id_ciudad = r.ciudad_destino
                        WHERE v.id_bus = b.id_bus AND v.estado = 'Salido') AS en_ruta
                 FROM bus b
                 JOIN empresa e ON e.id_empresa = b.id_empresa
                 LEFT JOIN terminal ta ON ta.id_terminal = b.id_terminal_actual
                 LEFT JOIN ciudad ct   ON ct.id_ciudad = ta.id_ciudad`,
        order: 'placa',
        acceso: FLOTA, scope: 'id_empresa',
        prepare: d => { if (d.placa) d.placa = d.placa.toUpperCase().trim(); },
        // Al crear un bus se genera su distribución de asientos (RF6)
        afterCreate: async (id, body) => {
            const filas = parseInt(body.filas, 10) || 10;
            const porFila = parseInt(body.por_fila, 10) === 3 ? 3 : 4;
            const pisos = parseInt(body.pisos, 10) === 2 ? 2 : 1;
            await query('EXEC sp_generar_asientos @id_bus = @id, @filas = @f, @por_fila = @p, @pisos = @pi',
                { id, f: filas, p: porFila, pi: pisos });
        }
    },
    conductores: {
        table: 'conductor', pk: 'id_conductor',
        fields: {
            id_empresa: { required: true, type: 'int' }, nombres: { required: true }, apellidos: { required: true },
            dni: { required: true }, licencia: { required: true }, telefono: {}, estado: { type: 'bool' }
        },
        // Situación: en ruta, descansando (hasta cumplir las horas de descanso) o disponible
        list: `SELECT c.*, e.razon_social AS empresa,
                      CONVERT(VARCHAR(16), u.llegada, 120) AS ultima_llegada,
                      CASE WHEN EXISTS (SELECT 1 FROM viaje v JOIN viaje_conductor vc ON vc.id_viaje = v.id_viaje
                                         WHERE vc.id_conductor = c.id_conductor AND v.estado = 'Salido') THEN 'En ruta'
                           WHEN DATEADD(MINUTE, prm.minutos, u.llegada) > GETDATE()
                               THEN CONCAT('Descansa hasta ', CONVERT(VARCHAR(16), DATEADD(MINUTE, prm.minutos, u.llegada), 120))
                           ELSE 'Disponible' END AS situacion,
                      (SELECT TOP 1 CONVERT(VARCHAR(16), v.salida_dt, 120) FROM viaje v
                         JOIN viaje_conductor vc ON vc.id_viaje = v.id_viaje
                        WHERE vc.id_conductor = c.id_conductor AND v.estado NOT IN ('Cancelado','Finalizado','Salido')
                          AND v.salida_dt > GETDATE() ORDER BY v.salida_dt) AS proximo_viaje
                 FROM conductor c
                 JOIN empresa e ON e.id_empresa = c.id_empresa
                 CROSS JOIN (SELECT CAST(ISNULL(MAX(CASE WHEN clave = 'horas_descanso_conductor' THEN valor END), 8) * 60 AS INT) AS minutos
                               FROM parametro) prm
                 OUTER APPLY (SELECT MAX(v.llegada_efectiva) AS llegada FROM viaje v
                                JOIN viaje_conductor vc ON vc.id_viaje = v.id_viaje
                               WHERE vc.id_conductor = c.id_conductor AND v.estado <> 'Cancelado'
                                 AND v.llegada_efectiva <= GETDATE()) u`,
        order: 'apellidos',
        acceso: FLOTA, scope: 'id_empresa',
        prepare: d => { if (d.dni !== undefined && !isDni(d.dni)) throw new HttpError(400, 'El DNI debe tener 8 dígitos.'); }
    },
    ciudades: {
        table: 'ciudad', pk: 'id_ciudad',
        fields: { nombre: { required: true }, departamento: { required: true } },
        list: 'SELECT * FROM ciudad', order: 'nombre',
        acceso: CATALOGO_COMUN
    },
    terminales: {
        table: 'terminal', pk: 'id_terminal',
        fields: { id_ciudad: { required: true, type: 'int' }, nombre: { required: true }, direccion: {}, estado: { type: 'bool' } },
        list: `SELECT t.*, c.nombre AS ciudad FROM terminal t JOIN ciudad c ON c.id_ciudad = t.id_ciudad`,
        order: 'ciudad',
        acceso: CATALOGO_COMUN
    },
    rutas: {
        table: 'ruta', pk: 'id_ruta',
        fields: {
            ciudad_origen: { required: true, type: 'int' }, ciudad_destino: { required: true, type: 'int' },
            terminal_origen: { type: 'int' }, terminal_destino: { type: 'int' },
            distancia_km: { type: 'num' }, duracion_minutos: { required: true, type: 'int' },
            duracion_estimada: {}, estado: { type: 'bool' }
        },
        list: `SELECT r.id_ruta, r.ciudad_origen, r.ciudad_destino, r.terminal_origen, r.terminal_destino,
                      CAST(r.distancia_km AS FLOAT) AS distancia_km, r.duracion_minutos, r.duracion_estimada, r.estado,
                      co.nombre AS origen, cd.nombre AS destino, tor.nombre AS terminal_origen_nombre, tde.nombre AS terminal_destino_nombre
                 FROM ruta r
                 JOIN ciudad co ON co.id_ciudad = r.ciudad_origen
                 JOIN ciudad cd ON cd.id_ciudad = r.ciudad_destino
                 LEFT JOIN terminal tor ON tor.id_terminal = r.terminal_origen
                 LEFT JOIN terminal tde ON tde.id_terminal = r.terminal_destino`,
        order: 'origen, destino',
        acceso: CATALOGO_COMUN,
        prepare: d => {
            if (d.ciudad_origen && d.ciudad_origen === d.ciudad_destino) throw new HttpError(400, 'El origen y destino deben ser distintos.');
            if (d.duracion_minutos !== undefined) {
                if (!(d.duracion_minutos > 0)) throw new HttpError(400, 'La duración debe ser mayor a 0.');
                const h = Math.floor(d.duracion_minutos / 60), m = d.duracion_minutos % 60;
                d.duracion_estimada = `${h}h${m ? ` ${m}min` : ''}`;
            }
        }
    },
    horarios: {
        table: 'horario', pk: 'id_horario',
        fields: {
            id_ruta: { required: true, type: 'int' }, id_empresa: { required: true, type: 'int' },
            hora_salida: { required: true }, hora_llegada: {}, precio_base: { required: true, type: 'num' }, estado: { type: 'bool' }
        },
        list: `SELECT h.id_horario, h.id_ruta, h.id_empresa, CONVERT(VARCHAR(5), h.hora_salida, 108) AS hora_salida,
                      CONVERT(VARCHAR(5), h.hora_llegada, 108) AS hora_llegada, CAST(h.precio_base AS FLOAT) AS precio_base, h.estado,
                      CONCAT(co.nombre, N' → ', cd.nombre) AS ruta, e.razon_social AS empresa
                 FROM horario h
                 JOIN ruta r ON r.id_ruta = h.id_ruta
                 JOIN ciudad co ON co.id_ciudad = r.ciudad_origen
                 JOIN ciudad cd ON cd.id_ciudad = r.ciudad_destino
                 JOIN empresa e ON e.id_empresa = h.id_empresa`,
        order: 'ruta, hora_salida',
        acceso: FLOTA, scope: 'id_empresa',
        // La hora de llegada se calcula con la duración de la ruta
        prepare: async (d, actual) => {
            const hora = d.hora_salida || (actual && actual.hora_salida);
            if (d.hora_salida !== undefined && !isTime(d.hora_salida)) throw new HttpError(400, 'Hora de salida inválida (HH:MM).');
            const idRuta = d.id_ruta || (actual && actual.id_ruta);
            const ruta = await queryOne('SELECT duracion_minutos FROM ruta WHERE id_ruta = @id', { id: idRuta });
            if (!ruta) throw new HttpError(400, 'La ruta no existe.');
            const [hh, mm] = String(hora).split(':').map(Number);
            const total = (hh * 60 + mm + ruta.duracion_minutos) % 1440;
            d.hora_llegada = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        }
    },
    pasajeros: {
        table: 'pasajero', pk: 'id_pasajero',
        acceso: { leer: ['ADMIN', 'VENDEDOR'], crear: ['ADMIN', 'VENDEDOR'], editar: ['ADMIN', 'VENDEDOR'], eliminar: ['ADMIN', 'VENDEDOR'] },
        fields: {
            nombres: { required: true }, apellidos: { required: true }, dni: { required: true },
            telefono: {}, fecha_nacimiento: {}
        },
        list: `SELECT p.id_pasajero, p.nombres, p.apellidos, p.dni, p.telefono,
                      CONVERT(VARCHAR(10), p.fecha_nacimiento, 23) AS fecha_nacimiento, p.id_usuario,
                      (SELECT COUNT(*) FROM reserva_asiento ra JOIN reserva r ON r.id_reserva = ra.id_reserva
                        WHERE ra.id_pasajero = p.id_pasajero AND r.estado = 'Confirmada') AS viajes
                 FROM pasajero p`,
        order: 'apellidos',
        prepare: d => { if (d.dni !== undefined && !isDni(d.dni)) throw new HttpError(400, 'El DNI debe tener 8 dígitos.'); }
    },
    usuarios: {
        table: 'usuario', pk: 'id_usuario',
        fields: {
            nombres: { required: true }, apellidos: { required: true }, dni: { required: true },
            correo: { required: true }, telefono: {}, rol: { required: true }, id_empresa: { type: 'int' },
            estado: { type: 'bool' }, password: {}
        },
        list: `SELECT u.id_usuario, u.nombres, u.apellidos, u.dni, u.correo, u.telefono, u.rol, u.id_empresa, u.estado,
                      e.razon_social AS empresa, CONVERT(VARCHAR(10), u.fecha_registro, 23) AS fecha_registro
                 FROM usuario u LEFT JOIN empresa e ON e.id_empresa = u.id_empresa`,
        order: 'fecha_registro DESC',
        noDelete: true,
        // La empresa administra a sus propios usuarios (operadores y vendedores)
        acceso: { leer: ['ADMIN', 'EMPRESA'], crear: ['ADMIN', 'EMPRESA'], editar: ['ADMIN', 'EMPRESA'], eliminar: [] },
        scope: 'id_empresa',
        prepare: async (d, actual, ctx) => {
            const permitidos = esEmpresa(ctx) ? ['EMPRESA', 'VENDEDOR'] : ['ADMIN', 'EMPRESA', 'VENDEDOR', 'CLIENTE'];
            if (d.rol !== undefined && !permitidos.includes(d.rol)) throw new HttpError(400, 'Rol inválido.');
            const rol = d.rol !== undefined ? d.rol : actual && actual.rol;
            const empresa = 'id_empresa' in d ? d.id_empresa : actual && actual.id_empresa;
            if (rol === 'EMPRESA' && !empresa) throw new HttpError(400, 'Un usuario con rol EMPRESA debe pertenecer a una empresa.');
            if (['ADMIN', 'CLIENTE'].includes(rol)) d.id_empresa = null;
            if (d.correo !== undefined) {
                d.correo = String(d.correo).trim().toLowerCase();
                if (!isEmail(d.correo)) throw new HttpError(400, 'Correo inválido.');
            }
            if (d.dni !== undefined && !isDni(d.dni)) throw new HttpError(400, 'El DNI debe tener 8 dígitos.');
            if (actual && actual.id_usuario === ctx.usuario.id_usuario && ((d.rol && d.rol !== actual.rol) || d.estado === false)) {
                throw new HttpError(400, 'No puedes cambiar tu propio rol ni desactivar tu propia cuenta.');
            }
            if (d.password) {
                const err = passwordError(d.password);
                if (err) throw new HttpError(400, err);
                d.password = await hashPassword(d.password);
            } else if (!actual) {
                throw new HttpError(400, 'Debes asignar una contraseña inicial.');
            } else {
                delete d.password;
            }
        },
        hide: ['password']
    },
    parametros: {
        table: 'parametro', pk: 'clave', pkString: true,
        fields: { valor: { required: true, type: 'num' } },
        list: 'SELECT clave, CAST(valor AS FLOAT) AS valor, descripcion FROM parametro',
        order: 'clave',
        noDelete: true, noCreate: true,
        acceso: { leer: ['ADMIN', 'EMPRESA', 'VENDEDOR'], crear: [], editar: ['ADMIN'], eliminar: [] },
        prepare: (d, actual) => {
            const limites = { horas_descanso_conductor: [0, 24], max_horas_conduccion: [1, 24], margen_bus_minutos: [0, 600], penalidad_anulacion_pct: [0, 100] };
            const [min, max] = limites[actual.clave] || [0, 100000];
            if (!(d.valor >= min && d.valor <= max)) throw new HttpError(400, `El valor debe estar entre ${min} y ${max}.`);
        }
    }
};

/** Convierte y filtra el cuerpo de la petición según la definición del recurso. */
function extraer(def, body, parcial) {
    const datos = {};
    for (const [campo, cfg] of Object.entries(def.fields)) {
        if (!(campo in body)) continue;
        let v = body[campo];
        if (v === '' || v === undefined) v = null;
        if (v !== null) {
            if (cfg.type === 'int') v = parseInt(v, 10);
            else if (cfg.type === 'num') v = parseFloat(v);
            else if (cfg.type === 'bool') v = bool(v);
            else v = String(v).trim();
            if (typeof v === 'number' && isNaN(v)) throw new HttpError(400, `El campo ${campo} debe ser numérico.`);
        }
        datos[campo] = v;
    }
    if (!parcial) {
        const faltan = Object.entries(def.fields)
            .filter(([c, cfg]) => cfg.required && (datos[c] === null || datos[c] === undefined))
            .map(([c]) => c);
        if (faltan.length) throw new HttpError(400, `Faltan campos obligatorios: ${faltan.join(', ')}`);
    } else {
        for (const [c, cfg] of Object.entries(def.fields)) {
            if (cfg.required && c in datos && datos[c] === null) throw new HttpError(400, `El campo ${c} es obligatorio.`);
        }
    }
    return datos;
}

function traducirErrorSql(err) {
    if (err.number === 547) return new HttpError(409, 'No se puede eliminar o modificar: el registro está relacionado con otros datos. Puedes desactivarlo.');
    if (err.number === 2601 || err.number === 2627) return new HttpError(409, 'Ya existe un registro con esos datos (valor duplicado).');
    return err;
}

/** Devuelve la definición de un recurso o lanza 404. */
function definicion(nombre) {
    const def = recursos[nombre];
    if (!def) throw new HttpError(404, 'Recurso no encontrado.');
    return def;
}

/** ¿El rol puede realizar la acción (leer, crear, editar, eliminar) sobre el recurso? */
function puede(nombre, rol, accion) {
    const def = recursos[nombre];
    if (!def) return false;
    return ((def.acceso || SOLO_ADMIN)[accion] || []).includes(rol);
}

const pkValor = (def, id) => def.pkString ? String(id) : (parseInt(id, 10) || 0);

/** SELECT del recurso con el filtro de empresa cuando corresponde. */
function seleccion(def, ctx, params) {
    let sqlText = `SELECT * FROM (${def.list}) x WHERE 1 = 1`;
    if (def.scope && esEmpresa(ctx)) {
        sqlText += ` AND x.${def.scope} = @__emp`;
        params.__emp = ctx.idEmpresa;
    }
    return sqlText;
}

function listar(nombre, ctx) {
    const def = definicion(nombre);
    const params = {};
    return query(`${seleccion(def, ctx, params)} ORDER BY ${def.order || def.pk}`, params);
}

async function obtener(nombre, id, ctx) {
    const def = definicion(nombre);
    const params = { id: pkValor(def, id) };
    const row = await queryOne(`${seleccion(def, ctx, params)} AND x.${def.pk} = @id`, params);
    if (!row) throw new HttpError(404, 'Registro no encontrado.');
    return row;
}

/** Un usuario de empresa siempre guarda los registros a nombre de su empresa. */
function forzarEmpresa(def, body, ctx, siempre) {
    const entrada = { ...(body || {}) };
    if (def.scope && esEmpresa(ctx) && def.fields[def.scope] && (siempre || def.scope in entrada)) {
        entrada[def.scope] = ctx.idEmpresa;
    }
    return entrada;
}

async function crear(nombre, body, ctx) {
    const def = definicion(nombre);
    if (def.noCreate) throw new HttpError(405, 'Este registro no se puede crear.');
    const datos = extraer(def, forzarEmpresa(def, body, ctx, true), false);
    if (def.prepare) await def.prepare(datos, null, ctx);
    const cols = Object.keys(datos);
    const row = await queryOne(
        `INSERT INTO ${def.table} (${cols.join(', ')}) OUTPUT INSERTED.${def.pk} AS id
         VALUES (${cols.map(c => `@${c}`).join(', ')})`, datos).catch(e => { throw traducirErrorSql(e); });
    if (def.afterCreate) await def.afterCreate(row.id, body || {});
    return row.id;
}

async function actualizar(nombre, id, body, ctx) {
    const def = definicion(nombre);
    const actual = await obtener(nombre, id, ctx);          // valida que el registro sea de su empresa
    const datos = extraer(def, forzarEmpresa(def, body, ctx, false), true);
    if (def.prepare) await def.prepare(datos, actual, ctx);
    const cols = Object.keys(datos);
    if (!cols.length) throw new HttpError(400, 'No hay datos para actualizar.');
    await query(
        `UPDATE ${def.table} SET ${cols.map(c => `${c} = @${c}`).join(', ')} WHERE ${def.pk} = @__id`,
        { ...datos, __id: pkValor(def, id) }).catch(e => { throw traducirErrorSql(e); });
}

async function eliminar(nombre, id, ctx) {
    const def = definicion(nombre);
    if (def.noDelete) throw new HttpError(405, 'Este registro no se puede eliminar; desactívalo en su lugar.');
    await obtener(nombre, id, ctx);                          // valida que el registro sea de su empresa
    const r = await query(`DELETE FROM ${def.table} OUTPUT DELETED.${def.pk} WHERE ${def.pk} = @id`, { id: pkValor(def, id) })
        .catch(e => { throw traducirErrorSql(e); });
    if (!r.length) throw new HttpError(404, 'Registro no encontrado.');
}

/* ---------- Distribución de asientos de un bus (RF6) ---------- */
function asientosDeBus(idBus) {
    return query('SELECT id_asiento, numero, piso, fila, columna, estado FROM asiento WHERE id_bus = @id ORDER BY piso, fila, columna', { id: idBus });
}

async function regenerarAsientos(idBus, body) {
    await recursos.buses.afterCreate(idBus, body || {}).catch(e => {
        throw new HttpError(409, e.message || 'No se pudo regenerar la distribución.');
    });
    const bus = await queryOne('SELECT capacidad FROM bus WHERE id_bus = @id', { id: idBus });
    return bus ? bus.capacidad : 0;
}

async function cambiarEstadoAsiento(idAsiento, estado, ctx) {
    if (!['Disponible', 'Mantenimiento'].includes(estado)) throw new HttpError(400, 'Estado inválido.');
    const asiento = await queryOne('SELECT id_bus FROM asiento WHERE id_asiento = @id', { id: idAsiento });
    if (!asiento) throw new HttpError(404, 'Registro no encontrado.');
    await obtener('buses', asiento.id_bus, ctx);             // el bus debe ser de su empresa
    return query('UPDATE asiento SET estado = @estado WHERE id_asiento = @id', { estado, id: idAsiento });
}

module.exports = {
    recursos, definicion, puede, listar, obtener, crear, actualizar, eliminar,
    asientosDeBus, regenerarAsientos, cambiarEstadoAsiento
};
