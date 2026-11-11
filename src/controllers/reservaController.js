/**
 * CONTROLADOR: Reservas, pagos y boletos (RF22, RF23, RF24)
 */
const Reserva = require('../models/ReservaModel');
const Viaje = require('../models/ViajeModel');
const Pago = require('../models/PagoModel');
const Reembolso = require('../models/ReembolsoModel');
const Parametro = require('../models/ParametroModel');
const Notificacion = require('../models/NotificacionModel');
const { query } = require('../config/db');
const { HttpError, required, isDni } = require('../utils/http');
const { tienePermiso, alcanceEmpresa } = require('../middleware/auth');

const HOLD_MINUTES = parseInt(process.env.HOLD_MINUTES, 10) || 10;
const MAX_ASIENTOS = 6;
const HORAS_MIN_CANCELACION = 24;

/** Carga la reserva completa y verifica que el usuario pueda verla. */
async function cargarReserva(id, user) {
    const reserva = await Reserva.obtener(id);
    if (!reserva) throw new HttpError(404, 'La reserva no existe.');
    if (reserva.id_usuario !== user.id_usuario && !tienePermiso(user.rol, 'ventas:ventanilla')) {
        throw new HttpError(403, 'No puedes ver esta reserva.');
    }
    reserva.viaje = await Viaje.obtener(reserva.id_viaje);
    // El personal de una empresa solo gestiona reservas de los viajes de su empresa
    const emp = alcanceEmpresa(user);
    if (reserva.id_usuario !== user.id_usuario && emp && reserva.viaje.id_empresa !== emp) {
        throw new HttpError(403, 'No puedes ver esta reserva.');
    }
    reserva.asientos = await Reserva.asientos(id);
    reserva.pagos = await Reserva.pagos(id);
    return reserva;
}

/** Bloquea asientos temporalmente creando una reserva Pendiente. */
async function crear(req, res) {
    const { id_viaje, asientos } = req.body || {};
    if (!id_viaje || !Array.isArray(asientos) || !asientos.length) {
        throw new HttpError(400, 'Debes indicar el viaje y al menos un asiento.');
    }
    if (asientos.length > MAX_ASIENTOS) throw new HttpError(400, `Máximo ${MAX_ASIENTOS} asientos por compra.`);

    const ids = asientos.map(a => parseInt(a.id_asiento, 10));
    if (ids.some(isNaN) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Asientos inválidos o repetidos.');

    const dnis = new Set();
    for (const a of asientos) {
        const p = a.pasajero || {};
        required(p, ['nombres', 'apellidos', 'dni']);
        if (!isDni(p.dni)) throw new HttpError(400, `El DNI ${p.dni} no es válido (8 dígitos).`);
        if (dnis.has(p.dni)) throw new HttpError(400, 'Un mismo pasajero no puede ocupar dos asientos.');
        dnis.add(p.dni);
    }

    await Viaje.liberarReservasExpiradas({ forzar: true });
    const viaje = await Viaje.obtener(parseInt(id_viaje, 10));
    if (!Viaje.esVendible(viaje)) throw new HttpError(409, `No se puede vender: el viaje está ${viaje.estado}.`);
    const emp = alcanceEmpresa(req.user);
    if (emp && tienePermiso(req.user.rol, 'ventas:ventanilla') && viaje.id_empresa !== emp) {
        throw new HttpError(403, 'Solo puedes vender pasajes de los viajes de tu empresa.');
    }
    if (new Date(`${viaje.fecha_salida}T${viaje.hora_salida}:00`) <= new Date()) throw new HttpError(409, 'El viaje ya salió.');

    const validos = await Reserva.asientosDelBus(viaje.id_bus, ids);
    if (validos.length !== ids.length) throw new HttpError(400, 'Algún asiento no pertenece a este bus.');
    const enMantenimiento = validos.find(a => a.estado !== 'Disponible');
    if (enMantenimiento) throw new HttpError(409, `El asiento ${enMantenimiento.numero} no está disponible.`);

    const idReserva = await Reserva.crear({ idUsuario: req.user.id_usuario, viaje, asientos, minutos: HOLD_MINUTES });

    res.status(201).json({
        mensaje: `Asientos bloqueados por ${HOLD_MINUTES} minutos. Completa el pago para confirmar.`,
        reserva: await cargarReserva(idReserva, req.user)
    });
}

async function misReservas(req, res) {
    await Viaje.liberarReservasExpiradas();
    res.json(await Reserva.deUsuario(req.user.id_usuario));
}

async function detalle(req, res) {
    await Viaje.liberarReservasExpiradas();
    res.json(await cargarReserva(parseInt(req.params.id, 10) || 0, req.user));
}

/** Pago (pasarela simulada) -> reserva Confirmada + boletos. */
async function pagar(req, res) {
    const id = parseInt(req.params.id, 10) || 0;
    await Viaje.liberarReservasExpiradas();
    const reserva = await cargarReserva(id, req.user);

    if (reserva.estado === 'Confirmada') throw new HttpError(409, 'Esta reserva ya fue pagada.');
    if (reserva.estado === 'Expirada') throw new HttpError(410, 'El tiempo para pagar expiró y los asientos fueron liberados. Vuelve a seleccionarlos.');
    if (reserva.estado !== 'Pendiente') throw new HttpError(409, `La reserva está ${reserva.estado}.`);

    const metodo = String((req.body || {}).metodo_pago || '').toUpperCase();
    if (metodo === 'EFECTIVO' && !tienePermiso(req.user.rol, 'ventas:ventanilla')) {
        throw new HttpError(403, 'El pago en efectivo solo está disponible en ventanilla.');
    }
    const resultado = Pago.procesar(metodo, req.body.datos || {});

    if (!resultado.aprobado) {
        await Reserva.registrarPagoRechazado(id, reserva.total, resultado.detalle, resultado.codigo);
        throw new HttpError(402, resultado.mensaje);
    }

    await Reserva.confirmarPago(reserva, resultado.detalle, resultado.codigo);

    // Aviso de compra (simulado: queda en el perfil y en la consola; ver NotificacionModel.enviar)
    const v = reserva.viaje;
    await Notificacion.avisarReserva(query, id, `Compra confirmada: ${v.origen} → ${v.destino}`,
        `Viajas el ${v.fecha_salida} a las ${v.hora_salida} con ${v.empresa}. Asiento(s): ` +
        `${reserva.asientos.filter(a => a.activo).map(a => a.numero).join(', ')}. Tus boletos están en "Mis viajes".`);
    res.json({ mensaje: '¡Pago aprobado! Tus boletos fueron emitidos.', codigo_operacion: resultado.codigo, id_reserva: id });
}

async function cancelar(req, res) {
    const id = parseInt(req.params.id, 10) || 0;
    const reserva = await cargarReserva(id, req.user);

    if (!['Pendiente', 'Confirmada'].includes(reserva.estado)) {
        throw new HttpError(409, `La reserva ya está ${reserva.estado}.`);
    }
    if (reserva.estado === 'Confirmada' && !tienePermiso(req.user.rol, 'ventas:ventanilla')) {
        const salida = new Date(`${reserva.viaje.fecha_salida}T${reserva.viaje.hora_salida}:00`);
        if ((salida - new Date()) / 3600000 < HORAS_MIN_CANCELACION) {
            throw new HttpError(409, `Solo puedes anular pasajes con al menos ${HORAS_MIN_CANCELACION} horas de anticipación.`);
        }
    }
    const pct = (await Parametro.obtener()).penalidad_anulacion_pct || 0;
    const { reembolso } = await Reembolso.cancelarPorCliente(reserva, pct, req.user.id_usuario);
    res.json({
        mensaje: reembolso
            ? `Pasaje anulado. Se devolverán S/ ${reembolso.monto.toFixed(2)}` +
              `${reembolso.penalidad ? ` (retención del ${pct} %: S/ ${reembolso.penalidad.toFixed(2)})` : ''}. Código: ${reembolso.codigo}.`
            : 'La reserva fue cancelada y los asientos fueron liberados.',
        reembolso
    });
}

/** El pasajero pide la devolución de un viaje que la empresa canceló (100 %). */
async function solicitarReembolso(req, res) {
    const id = parseInt(req.params.id, 10) || 0;
    const reserva = await Reembolso.datosReserva(id);
    if (!reserva || reserva.id_usuario !== req.user.id_usuario) throw new HttpError(404, 'La reserva no existe.');
    const r = await Reembolso.procesar(reserva, req.user.id_usuario);
    res.json({ mensaje: `Reembolso procesado: te devolvemos S/ ${Number(r.monto).toFixed(2)}. Código de operación: ${r.codigo}.`, ...r });
}

async function boletos(req, res) {
    const id = parseInt(req.params.id, 10) || 0;
    await cargarReserva(id, req.user); // valida permisos
    res.json(await Reserva.boletos(id));
}

async function verificarBoleto(req, res) {
    const boleto = await Reserva.boletoPorCodigo(req.params.codigo);
    const emp = alcanceEmpresa(req.user);
    if (!boleto || (emp && boleto.id_empresa !== emp)) throw new HttpError(404, 'Boleto no encontrado.');
    res.json(boleto);
}

module.exports = { crear, misReservas, detalle, pagar, cancelar, solicitarReembolso, boletos, verificarBoleto };
