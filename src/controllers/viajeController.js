/**
 * CONTROLADOR: Consultas públicas de viajes (no requieren sesión) — RF21
 */
const Viaje = require('../models/ViajeModel');
const Ciudad = require('../models/CiudadModel');
const { HttpError, isDate, isEmail, today } = require('../utils/http');

async function ciudades(req, res) {
    res.json(await Ciudad.listarConTerminales());
}

async function rutasPopulares(req, res) {
    res.json(await Viaje.rutasPopulares());
}

/** Búsqueda y comparación de viajes. */
async function buscar(req, res) {
    const { origen, destino } = req.query;
    const fecha = req.query.fecha || today();
    const pasajeros = Math.max(1, Math.min(6, parseInt(req.query.pasajeros, 10) || 1));

    if (!origen || !destino) throw new HttpError(400, 'Debes indicar origen y destino.');
    if (!isDate(fecha)) throw new HttpError(400, 'La fecha no es válida (formato AAAA-MM-DD).');
    if (String(origen).toLowerCase() === String(destino).toLowerCase()) {
        throw new HttpError(400, 'El origen y el destino no pueden ser iguales.');
    }

    await Viaje.liberarReservasExpiradas();
    const { viajes, sugerencias } = await Viaje.buscar({ origen, destino, fecha, pasajeros });
    res.json({ fecha, pasajeros, total: viajes.length, viajes, sugerencias });
}

async function detalle(req, res) {
    res.json(await Viaje.obtener(parseInt(req.params.id, 10) || 0));
}

/** Mapa de asientos con su estado (RF21). */
async function asientos(req, res) {
    const id = parseInt(req.params.id, 10) || 0;
    await Viaje.liberarReservasExpiradas();
    const viaje = await Viaje.obtener(id);
    const lista = await Viaje.asientos(id);
    res.json({ viaje, vendible: Viaje.esVendible(viaje), asientos: lista });
}

async function suscribir(req, res) {
    const correo = String((req.body || {}).correo || '').trim().toLowerCase();
    if (!isEmail(correo)) throw new HttpError(400, 'Ingresa un correo electrónico válido.');
    await Ciudad.suscribir(correo);
    res.status(201).json({ mensaje: `${correo} ha sido registrado para recibir ofertas.` });
}

module.exports = { ciudades, rutasPopulares, buscar, detalle, asientos, suscribir };
