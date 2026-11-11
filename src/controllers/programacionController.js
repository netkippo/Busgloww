/**
 * CONTROLADOR: Programación y operación de viajes (RF11 – RF20)
 * Cada empresa solo ve y opera sus viajes; el administrador de la plataforma ve todos.
 */
const Viaje = require('../models/ViajeModel');
const Parametro = require('../models/ParametroModel');
const { HttpError, required, isDate, isTime, today } = require('../utils/http');
const { alcanceEmpresa, tienePermiso } = require('../middleware/auth');

const bool = v => v === true || v === 1 || v === '1' || v === 'true';

/**
 * Lee la tripulación del cuerpo: `conductores: [ids]` o los campos del formulario
 * id_conductor (titular), id_relevo, id_relevo2. Devuelve null si no se envió nada.
 */
function leerConductores(b) {
    let lista;
    if (Array.isArray(b.conductores)) lista = b.conductores;
    else if (['id_conductor', 'id_relevo', 'id_relevo2'].some(k => k in b)) lista = [b.id_conductor, b.id_relevo, b.id_relevo2];
    else return null;
    return lista.map(x => parseInt(x, 10)).filter(x => x > 0);
}

/** Programación diaria (RF14). */
async function listar(req, res) {
    const fecha = req.query.fecha || today();
    if (!isDate(fecha)) throw new HttpError(400, 'Fecha inválida.');
    const viajes = await Viaje.programacionDiaria({
        fecha,
        idRuta: req.query.id_ruta ? parseInt(req.query.id_ruta, 10) : null,
        estado: req.query.estado || null,
        idEmpresa: alcanceEmpresa(req.user)
    });
    res.json({ fecha, viajes });
}

/** Detalle + manifiesto de pasajeros + historial de cambios. */
async function detalle(req, res) {
    const id = parseInt(req.params.id, 10) || 0;
    const viaje = await Viaje.obtener(id, alcanceEmpresa(req.user));
    viaje.conductores = await Viaje.conductores(id);
    viaje.conductores_requeridos = Parametro.conductoresRequeridos(viaje.duracion_minutos, await Parametro.obtener());
    viaje.pasajeros = await Viaje.pasajeros(id);
    viaje.modificaciones = await Viaje.modificaciones(id);
    res.json(viaje);
}

function validarFechaHora(fecha, hora) {
    if (!isDate(fecha)) throw new HttpError(400, 'Fecha de salida inválida.');
    if (!isTime(hora)) throw new HttpError(400, 'Hora de salida inválida (HH:MM).');
}

/** Buses y conductores disponibles para una ruta, fecha y hora (ayuda del formulario). */
async function disponibilidad(req, res) {
    const q = req.query;
    required(q, ['id_ruta', 'fecha_salida', 'hora_salida']);
    validarFechaHora(q.fecha_salida, q.hora_salida);
    res.json(await Viaje.disponibilidad({
        id_ruta: parseInt(q.id_ruta, 10),
        fecha_salida: q.fecha_salida,
        hora_salida: String(q.hora_salida).slice(0, 5),
        excluir: parseInt(q.excluir, 10) || 0,
        traslado_vacio: bool(q.traslado_vacio),
        idEmpresa: alcanceEmpresa(req.user)
    }));
}

/** Programar un viaje (RF11; valida cruces, ubicación del bus, relevos y descansos). */
async function crear(req, res) {
    const b = req.body || {};
    required(b, ['id_ruta', 'id_bus', 'fecha_salida', 'hora_salida', 'precio']);
    const datos = {
        id_ruta: parseInt(b.id_ruta, 10), id_bus: parseInt(b.id_bus, 10),
        conductores: leerConductores(b) || [],
        traslado_vacio: bool(b.traslado_vacio),
        fecha_salida: b.fecha_salida, hora_salida: String(b.hora_salida).slice(0, 5)
    };
    const precio = parseFloat(b.precio);
    if (!(precio > 0)) throw new HttpError(400, 'El precio debe ser mayor a 0.');
    if (new Date(`${datos.fecha_salida}T${datos.hora_salida}:00`) < new Date()) {
        throw new HttpError(400, 'No se puede programar un viaje en el pasado.');
    }
    validarFechaHora(datos.fecha_salida, datos.hora_salida);

    const t = await Viaje.prepararProgramacion(datos, 0, alcanceEmpresa(req.user));
    const idViaje = await Viaje.crear(datos, t, precio);
    const aviso = datos.conductores.length ? '' : ` Recuerda asignar ${t.requeridos} conductor(es) antes del embarque.`;
    res.status(201).json({ mensaje: `Viaje programado correctamente.${aviso}`, id_viaje: idViaje });
}

/** Fecha (YYYY-MM-DD) desplazada n días. */
function sumarDias(fecha, n) {
    const d = new Date(`${fecha}T00:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Programación masiva desde un horario (RF10/RF11). */
async function generar(req, res) {
    const b = req.body || {};
    required(b, ['id_horario', 'id_bus', 'desde', 'hasta']);
    if (!isDate(b.desde) || !isDate(b.hasta) || b.hasta < b.desde) throw new HttpError(400, 'Rango de fechas inválido.');

    const idEmpresa = alcanceEmpresa(req.user);
    const h = await Viaje.obtenerHorario(parseInt(b.id_horario, 10));
    if (!h || (idEmpresa && h.id_empresa !== idEmpresa)) throw new HttpError(400, 'El horario no existe o está inactivo.');

    // Horario de vuelta opcional: el mismo bus regresa en la primera salida posible después de llegar
    let hv = null;
    if (b.id_horario_vuelta) {
        hv = await Viaje.obtenerHorario(parseInt(b.id_horario_vuelta, 10));
        if (!hv || hv.id_empresa !== h.id_empresa) throw new HttpError(400, 'El horario de vuelta no existe o es de otra empresa.');
    }

    const base = {
        id_bus: parseInt(b.id_bus, 10),
        conductores: leerConductores(b) || [],
        traslado_vacio: bool(b.traslado_vacio)
    };
    const precio = parseFloat(b.precio);
    const creados = [], omitidos = [];

    /** Intenta programar un viaje; si no se puede, lo registra como omitido con su motivo. */
    const intentar = async (horario, fecha, extra = {}) => {
        try {
            if (new Date(`${fecha}T${horario.hora_salida}:00`) < new Date()) throw new HttpError(400, 'La fecha ya pasó.');
            const datos = { ...base, ...extra, id_ruta: horario.id_ruta, fecha_salida: fecha, hora_salida: horario.hora_salida };
            const t = await Viaje.prepararProgramacion(datos, 0, idEmpresa);
            const idViaje = await Viaje.crear(datos, t, precio > 0 ? precio : horario.precio_base);
            creados.push({ fecha, hora: horario.hora_salida, ruta: `${t.ruta.origen} → ${t.ruta.destino}`, id_viaje: idViaje });
            return t;
        } catch (err) {
            if (!(err instanceof HttpError)) throw err;
            omitidos.push({ fecha, hora: horario.hora_salida, motivo: err.message });
            return null;
        }
    };

    let fecha = b.desde, dias = 0;
    while (fecha <= b.hasta && dias < 92) {
        const t = await intentar(h, fecha);
        if (t && hv) {
            // primera fecha cuya salida de vuelta sea posterior a la llegada de la ida
            const margen = (await Parametro.obtener()).margen_bus_minutos;
            const listo = new Date(new Date(t.llegada).getTime() + margen * 60000);
            let fv = t.fecha_llegada;
            if (new Date(`${fv}T${hv.hora_salida}:00`) < listo) fv = sumarDias(fv, 1);
            await intentar(hv, fv, { traslado_vacio: false });
        }
        fecha = sumarDias(fecha, 1);
        dias++;
    }
    res.status(201).json({ mensaje: `${creados.length} viaje(s) programado(s), ${omitidos.length} omitido(s).`, creados, omitidos });
}

/** Reprogramación con motivo (RF15, RF16). */
async function reprogramar(req, res) {
    const id = parseInt(req.params.id, 10) || 0;
    const b = req.body || {};
    required(b, ['motivo']);
    if (String(b.motivo).trim().length < 5) throw new HttpError(400, 'Describe el motivo de la reprogramación.');

    const idEmpresa = alcanceEmpresa(req.user);
    const v = await Viaje.obtener(id, idEmpresa);
    if (['Salido', 'Finalizado', 'Cancelado'].includes(v.estado)) {
        throw new HttpError(409, `No se puede reprogramar un viaje ${v.estado}.`);
    }
    const actuales = (await Viaje.conductores(id)).map(c => c.id_conductor);
    const datos = {
        id_ruta: v.id_ruta,
        id_bus: b.id_bus ? parseInt(b.id_bus, 10) : v.id_bus,
        conductores: leerConductores(b) || actuales,
        traslado_vacio: 'traslado_vacio' in b ? bool(b.traslado_vacio) : !!v.traslado_vacio,
        fecha_salida: b.fecha_salida || v.fecha_salida,
        hora_salida: String(b.hora_salida || v.hora_salida).slice(0, 5)
    };
    validarFechaHora(datos.fecha_salida, datos.hora_salida);
    const t = await Viaje.prepararProgramacion(datos, id, idEmpresa);
    await Viaje.reprogramar(v, datos, t, req.user.id_usuario, String(b.motivo).trim());

    // Aquí se notificaría a los pasajeros afectados (correo / SMS / WhatsApp)
    res.json({ mensaje: 'Viaje reprogramado. El motivo quedó registrado.', viaje: await Viaje.obtener(id, idEmpresa) });
}

/** Cambio de estado y horas reales (RF17, RF18). */
async function cambiarEstado(req, res) {
    const id = parseInt(req.params.id, 10) || 0;
    const { estado, motivo, hora } = req.body || {};
    if (!Viaje.ESTADOS.includes(estado)) throw new HttpError(400, `Estado inválido. Valores: ${Viaje.ESTADOS.join(', ')}`);

    const idEmpresa = alcanceEmpresa(req.user);
    const v = await Viaje.obtener(id, idEmpresa);
    if (['Finalizado', 'Cancelado'].includes(v.estado)) throw new HttpError(409, `El viaje ya está ${v.estado}.`);
    if (estado === v.estado) throw new HttpError(400, `El viaje ya se encuentra en estado ${estado}.`);
    if (['Cancelado', 'Retrasado'].includes(estado) && (!motivo || String(motivo).trim().length < 5)) {
        throw new HttpError(400, 'Indica el motivo del cambio de estado.');
    }
    if (estado === 'Cancelado' && !tienePermiso(req.user.rol, 'viajes:cancelar')) {
        throw new HttpError(403, 'Solo la empresa o el administrador pueden cancelar viajes.');
    }
    if (estado === 'Finalizado' && !v.hora_real_salida) throw new HttpError(400, 'Primero registra la salida del bus.');

    // No se embarca ni sale sin la tripulación completa (titular + relevos)
    if (['Embarcando', 'Proximo a salir', 'Salido'].includes(estado)) {
        const requeridos = Parametro.conductoresRequeridos(v.duracion_minutos, await Parametro.obtener());
        if (v.num_conductores < requeridos) {
            throw new HttpError(409, `Este viaje necesita ${requeridos} conductor(es) y tiene ${v.num_conductores}. ` +
                'Asigna la tripulación (Reprogramar) antes del embarque.');
        }
    }

    // Hora real (opcional, HH:MM). Para la llegada se toma la fecha de llegada; si no se envía, la hora actual.
    let horaReal = null;
    if (hora) {
        if (!isTime(hora)) throw new HttpError(400, 'Hora inválida (HH:MM).');
        const fecha = estado === 'Finalizado' ? v.fecha_llegada : v.fecha_salida;
        horaReal = `${fecha}T${hora.slice(0, 5)}:00`;
        if (estado === 'Finalizado' && v.hora_real_salida && horaReal.replace('T', ' ').slice(0, 16) <= v.hora_real_salida) {
            throw new HttpError(400, 'La hora de llegada debe ser posterior a la salida real.');
        }
    }

    const { afectados } = await Viaje.cambiarEstado(v, estado, horaReal, req.user.id_usuario, motivo ? String(motivo).trim() : null);
    const extra = estado === 'Cancelado' && afectados
        ? ` ${afectados} reserva(s) afectada(s): se avisó a los pasajeros y quedaron con reembolso pendiente o reubicación.` : '';
    res.json({ mensaje: `Estado actualizado a ${estado}.${extra}`, afectados, viaje: await Viaje.obtener(id, idEmpresa) });
}

/** Alertas de retrasos y próximas salidas (RF19, RF20). */
async function alertas(req, res) {
    const { retrasados, proximos, sinTripulacion } = await Viaje.alertas(alcanceEmpresa(req.user));
    const lista = [
        ...sinTripulacion.map(v => ({
            tipo: 'TRIPULACION', nivel: v.minutos_para_salida <= 180 ? 'alto' : 'medio', viaje: v,
            mensaje: `${v.origen} → ${v.destino} (${v.fecha_salida} ${v.hora_salida}) · Bus ${v.placa}: tiene ${v.num_conductores} de ` +
                     `${v.conductores_requeridos} conductor(es) requeridos.`
        })),
        ...retrasados.map(v => ({
            tipo: 'RETRASO', nivel: v.retraso_min > 30 ? 'alto' : 'medio', viaje: v,
            mensaje: v.hora_real_salida
                ? `${v.origen} → ${v.destino} (${v.hora_salida}) salió con ${v.retraso_min} min de retraso.`
                : `${v.origen} → ${v.destino} (${v.hora_salida}) lleva ${v.retraso_min} min de retraso y aún no sale.`
        })),
        ...proximos.map(v => ({
            tipo: 'PROXIMA_SALIDA', nivel: v.minutos_para_salida <= 15 ? 'alto' : 'bajo', viaje: v,
            mensaje: `${v.origen} → ${v.destino} sale en ${v.minutos_para_salida} min (${v.hora_salida}) · Bus ${v.placa} · Estado: ${v.estado}.`
        }))
    ];
    res.json({ generado: new Date().toISOString(), total: lista.length, alertas: lista });
}

module.exports = { listar, detalle, disponibilidad, crear, generar, reprogramar, cambiarEstado, alertas };
