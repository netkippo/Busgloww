/**
 * RUTAS: consultas públicas (no requieren sesión) — RF21
 */
const router = require('express').Router();
const { asyncHandler: h } = require('../utils/http');
const viajes = require('../controllers/viajeController');

router.get('/ciudades', h(viajes.ciudades));
router.get('/rutas/populares', h(viajes.rutasPopulares));
router.get('/viajes/buscar', h(viajes.buscar));
router.get('/viajes/:id', h(viajes.detalle));
router.get('/viajes/:id/asientos', h(viajes.asientos));
router.post('/suscripciones', h(viajes.suscribir));

module.exports = router;
