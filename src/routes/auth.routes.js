/**
 * RUTAS: /api/auth  — Autenticación y perfil (RF1, RF2)
 */
const router = require('express').Router();
const { asyncHandler: h } = require('../utils/http');
const { requireAuth } = require('../middleware/auth');
const auth = require('../controllers/authController');

router.post('/registro', h(auth.registro));
router.post('/login', h(auth.login));
router.get('/me', requireAuth, h(auth.perfil));
router.put('/me', requireAuth, h(auth.actualizarPerfil));
router.put('/me/password', requireAuth, h(auth.cambiarPassword));
router.get('/me/resumen', requireAuth, h(auth.resumen));
router.get('/me/notificaciones', requireAuth, h(auth.notificaciones));
router.post('/me/notificaciones/leidas', requireAuth, h(auth.marcarNotificaciones));

module.exports = router;
