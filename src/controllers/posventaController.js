/**
 * CONTROLADOR: Posventa en el panel — pasajeros afectados, reembolsos y reubicación
 * El personal de una empresa solo atiende reservas de los viajes de su empresa.
 */
const Reembolso = require('../models/ReembolsoModel');
const Viaje = require('../models/ViajeModel');
const { HttpError } = require('../utils/http');
const { alcanceEmpresa } = require('../middleware/auth');

/** Carga la reserva y valida que pertenezca a la empresa del usuario. */
async function cargar(req) {
    const reserva = await Reembolso.datosReserva(parseInt(req.params.id, 10) || 0);
    const emp = alcanceEmpresa(req.user);
    if (!reserva || (emp && reserva.id_empresa !== emp)) throw new HttpError(404, 'La reserva no existe.');
    return reserva;
}

/** Reservas afectadas por la cancelación de un viaje. */
async function afectados(req, res) {
    const id = parseInt(req.params.id, 10) || 0;
    await Viaje.obtener(id, alcanceEmpresa(req.user));     // valida la empresa
    res.json(await Reembolso.afectadosDeViaje(id));
}

async function listarReembolsos(req, res) {
    const estado = ['Pendiente', 'Procesado', 'Anulado'].includes(req.query.estado) ? req.query.estado : null;
    res.json(await Reembolso.listar({ estado, idEmpresa: alcanceEmpresa(req.user) }));
}

async function reembolsar(req, res) {
    const r = await Reembolso.procesar(await cargar(req), req.user.id_usuario);
    res.json({ mensaje: `Reembolso procesado por S/ ${Number(r.monto).toFixed(2)}. Código: ${r.codigo}. Se avisó al pasajero.`, ...r });
}

async function alternativas(req, res) {
    const reserva = await cargar(req);
    const pasajeros = (await Reembolso.afectadosDeViaje(reserva.id_viaje)).find(x => x.id_reserva === reserva.id_reserva);
    res.json({
        reserva: { ...reserva, num_pasajeros: pasajeros ? pasajeros.num_pasajeros : 1, pasajeros: pasajeros ? pasajeros.pasajeros : '' },
        viajes: await Reembolso.alternativas(reserva, pasajeros ? pasajeros.num_pasajeros : 1)
    });
}

async function reubicar(req, res) {
    const idViaje = parseInt((req.body || {}).id_viaje, 10);
    if (!idViaje) throw new HttpError(400, 'Elige el viaje al que se cambiará al pasajero.');
    const r = await Reembolso.reubicar(await cargar(req), idViaje, req.user.id_usuario);
    res.status(201).json({ mensaje: `Pasajero(s) reubicado(s) en la reserva #${r.id_reserva}, asiento(s) ${r.asientos.join(', ')}. Se emitieron boletos nuevos y se avisó al pasajero.`, ...r });
}

module.exports = { afectados, listarReembolsos, reembolsar, alternativas, reubicar };
