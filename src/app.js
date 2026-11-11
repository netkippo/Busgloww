/**
 * BusGlow - Configuración de la aplicación Express (patrón MVC)
 *
 *   models/       Modelo: acceso a datos (SQL Server) y reglas de negocio
 *   views/        Vista: páginas HTML que se muestran en el navegador
 *   controllers/  Controlador: recibe la petición, valida y coordina modelo y respuesta
 *   routes/       Asocia cada URL de la API con su controlador
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const { HttpError } = require('./utils/http');

const app = express();

/* ---------- Middlewares generales ---------- */
app.disable('x-powered-by');
// En Azure App Service (y otros servicios en la nube) las peticiones llegan a través de un proxy:
// así req.ip es la IP real del usuario (la usa el límite de intentos de inicio de sesión).
if (process.env.WEBSITE_SITE_NAME || process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
    // Cabeceras básicas de seguridad
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

/* ---------- API (controladores) ---------- */
app.use('/api', require('./routes'));

/* ---------- Vistas y recursos estáticos ---------- */
const VIEWS = path.join(__dirname, 'views');
app.use(express.static(path.join(__dirname, 'public')));          // js/api.js
app.use(express.static(VIEWS, { extensions: ['html'] }));          // páginas .html
app.get('/', (req, res) => res.sendFile(path.join(VIEWS, 'index.html')));

/* ---------- Manejo de errores ---------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message, detalles: err.details });
    }
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido.' });
    }
    console.error('[ERROR]', req.method, req.originalUrl, err);
    const esConexion = /ConnectionError|ESOCKET|ELOGIN|ETIMEOUT/i.test(`${err.name} ${err.code}`);
    res.status(esConexion ? 503 : 500).json({
        error: esConexion
            ? 'No se pudo conectar con la base de datos. Revisa la configuración del archivo .env.'
            : 'Ocurrió un error inesperado en el servidor.'
    });
});

module.exports = app;
