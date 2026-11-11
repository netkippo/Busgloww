/**
 * RUTAS: reservas, pagos y boletos (RF22, RF23, RF24)
 */
const router = require('express').Router();
const { asyncHandler: h } = require('../utils/http');
const { requireAuth, requirePermiso } = require('../middleware/auth');
const reservas = require('../controllers/reservaController');

router.post('/reservas', requireAuth, h(reservas.crear));
router.get('/reservas/mis', requireAuth, h(reservas.misReservas));
router.get('/reservas/:id', requireAuth, h(reservas.detalle));
router.post('/reservas/:id/pagar', requireAuth, h(reservas.pagar));
router.post('/reservas/:id/cancelar', requireAuth, h(reservas.cancelar));
router.post('/reservas/:id/reembolso', requireAuth, h(reservas.solicitarReembolso));
router.get('/reservas/:id/boletos', requireAuth, h(reservas.boletos));
router.get('/boletos/:codigo', requireAuth, requirePermiso('boletos:verificar'), h(reservas.verificarBoleto));

module.exports = router;
