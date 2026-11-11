/**
 * Punto de entrada de la API: /api/...
 */
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { queryOne } = require('../config/db');

router.get('/health', async (req, res) => {
    try {
        // GETDATE() se convierte a la hora del Perú (ver config/db.js): sirve para verificar la zona horaria
        const r = await queryOne('SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS hora_bd');
        const d = new Date(), p2 = n => String(n).padStart(2, '0');
        const horaServidor = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
        res.json({ estado: 'ok', baseDeDatos: 'conectada', horaBaseDeDatos: r.hora_bd, horaServidor, zona: process.env.TZ || null });
    } catch (err) {
        res.status(503).json({ estado: 'error', baseDeDatos: 'sin conexión', detalle: err.message });
    }
});

router.use('/auth', require('./auth.routes'));
router.use('/', require('./viaje.routes'));
router.use('/', require('./reserva.routes'));
router.use('/admin', requireAuth, require('./admin.routes'));

router.use((req, res) => res.status(404).json({ error: 'Ruta de API no encontrada.' }));

module.exports = router;
