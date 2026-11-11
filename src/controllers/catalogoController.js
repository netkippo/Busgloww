/**
 * CONTROLADOR: Mantenimientos del panel de administración (CRUD genérico)
 * Un usuario de empresa solo trabaja con los registros de su empresa (ver `scope` en CatalogoModel).
 */
const Catalogo = require('../models/CatalogoModel');
const { alcanceEmpresa } = require('../middleware/auth');

const id = req => parseInt(req.params.id, 10) || 0;
const ctx = req => ({ usuario: req.user, idEmpresa: alcanceEmpresa(req.user) });

async function listar(req, res) {
    res.json(await Catalogo.listar(req.params.recurso, ctx(req)));
}

async function obtener(req, res) {
    res.json(await Catalogo.obtener(req.params.recurso, req.params.id, ctx(req)));
}

async function crear(req, res) {
    const nuevo = await Catalogo.crear(req.params.recurso, req.body, ctx(req));
    res.status(201).json({ mensaje: 'Registro creado correctamente.', id: nuevo });
}

async function actualizar(req, res) {
    await Catalogo.actualizar(req.params.recurso, req.params.id, req.body, ctx(req));
    res.json({ mensaje: 'Registro actualizado correctamente.' });
}

async function eliminar(req, res) {
    await Catalogo.eliminar(req.params.recurso, req.params.id, ctx(req));
    res.json({ mensaje: 'Registro eliminado.' });
}

/* Distribución de asientos de un bus (RF6) */
async function asientosDeBus(req, res) {
    await Catalogo.obtener('buses', id(req), ctx(req));   // el bus debe ser de su empresa
    res.json(await Catalogo.asientosDeBus(id(req)));
}

async function regenerarAsientos(req, res) {
    await Catalogo.obtener('buses', id(req), ctx(req));
    const capacidad = await Catalogo.regenerarAsientos(id(req), req.body);
    res.json({ mensaje: `Distribución generada: ${capacidad} asientos.` });
}

async function estadoAsiento(req, res) {
    const estado = (req.body || {}).estado;
    await Catalogo.cambiarEstadoAsiento(id(req), estado, ctx(req));
    res.json({ mensaje: `Asiento marcado como ${estado}.` });
}

module.exports = { listar, obtener, crear, actualizar, eliminar, asientosDeBus, regenerarAsientos, estadoAsiento };
