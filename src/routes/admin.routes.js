/**
 * RUTAS: /api/admin — panel de administración y ventanilla
 * Todas requieren sesión (requireAuth se aplica en routes/index.js).
 */
const router = require('express').Router();
const { asyncHandler: h, HttpError } = require('../utils/http');
const { requirePermiso } = require('../middleware/auth');
const programacion = require('../controllers/programacionController');
const reportes = require('../controllers/reporteController');
const catalogos = require('../controllers/catalogoController');
const posventa = require('../controllers/posventaController');
const { recursos, puede } = require('../models/CatalogoModel');

const ACCIONES = { GET: 'leer', POST: 'crear', PUT: 'editar', DELETE: 'eliminar' };

/* ---------- Programación y operación de viajes (RF11–RF20) ---------- */
router.get('/viajes', requirePermiso('viajes:ver'), h(programacion.listar));
router.post('/viajes', requirePermiso('viajes:programar'), h(programacion.crear));
router.post('/viajes/generar', requirePermiso('viajes:programar'), h(programacion.generar));
router.get('/viajes/disponibilidad', requirePermiso('viajes:programar'), h(programacion.disponibilidad));
router.get('/viajes/:id', requirePermiso('viajes:ver'), h(programacion.detalle));
router.get('/viajes/:id/afectados', requirePermiso('viajes:ver'), h(posventa.afectados));
router.put('/viajes/:id/reprogramar', requirePermiso('viajes:programar'), h(programacion.reprogramar));
router.patch('/viajes/:id/estado', requirePermiso('viajes:estado'), h(programacion.cambiarEstado));
router.get('/alertas', requirePermiso('alertas:ver'), h(programacion.alertas));

/* ---------- Posventa: reembolsos y reubicación de pasajeros ---------- */
router.get('/reembolsos', requirePermiso('ventas:ventanilla'), h(posventa.listarReembolsos));
router.post('/reservas/:id/reembolsar', requirePermiso('ventas:ventanilla'), h(posventa.reembolsar));
router.get('/reservas/:id/alternativas', requirePermiso('ventas:ventanilla'), h(posventa.alternativas));
router.post('/reservas/:id/reubicar', requirePermiso('ventas:ventanilla'), h(posventa.reubicar));

/* ---------- Reportes (RF25) ---------- */
router.get('/reportes', requirePermiso('reportes:ver'), h(reportes.reportes));
router.get('/dashboard', requirePermiso('dashboard:ver'), h(reportes.dashboard));

/* ---------- Distribución de asientos (RF6) ---------- */
router.get('/buses/:id/asientos', requirePermiso('flota:gestionar'), h(catalogos.asientosDeBus));
router.post('/buses/:id/asientos', requirePermiso('flota:gestionar'), h(catalogos.regenerarAsientos));
router.patch('/asientos/:id', requirePermiso('flota:gestionar'), h(catalogos.estadoAsiento));

/* ---------- Catálogos: /api/admin/{empresas|buses|conductores|ciudades|terminales|rutas|horarios|pasajeros|usuarios|parametros} ---------- */
function permisoCatalogo(req, res, next) {
    if (!recursos[req.params.recurso]) return next(new HttpError(404, 'Ruta de API no encontrada.'));
    if (!puede(req.params.recurso, req.user.rol, ACCIONES[req.method])) {
        return next(new HttpError(403, 'No tienes permisos para realizar esta acción.'));
    }
    next();
}
router.get('/:recurso', permisoCatalogo, h(catalogos.listar));
router.get('/:recurso/:id', permisoCatalogo, h(catalogos.obtener));
router.post('/:recurso', permisoCatalogo, h(catalogos.crear));
router.put('/:recurso/:id', permisoCatalogo, h(catalogos.actualizar));
router.delete('/:recurso/:id', permisoCatalogo, h(catalogos.eliminar));

module.exports = router;
