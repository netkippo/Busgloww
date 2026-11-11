/**
 * CONTROLADOR: Reportes (RF25) y dashboard
 */
const Reporte = require('../models/ReporteModel');
const { HttpError, isDate, today } = require('../utils/http');
const { alcanceEmpresa } = require('../middleware/auth');

async function reportes(req, res) {
    const d = new Date(); d.setDate(d.getDate() - 30);
    const hace30 = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const desde = req.query.desde || hace30;
    const hasta = req.query.hasta || today();
    if (!isDate(desde) || !isDate(hasta) || desde > hasta) throw new HttpError(400, 'Rango de fechas inválido.');
    res.json(await Reporte.generar({
        desde, hasta,
        idRuta: req.query.id_ruta ? parseInt(req.query.id_ruta, 10) : null,
        idEmpresa: alcanceEmpresa(req.user)
    }));
}

async function dashboard(req, res) {
    res.json(await Reporte.dashboard(alcanceEmpresa(req.user)));
}

module.exports = { reportes, dashboard };
