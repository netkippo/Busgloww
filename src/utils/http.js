/** Error HTTP con código de estado. */
class HttpError extends Error {
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

/** Envuelve handlers async para enviar los errores al middleware de errores. */
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Valida que existan los campos requeridos en un objeto. */
function required(obj, fields) {
    const missing = fields.filter(f => obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '');
    if (missing.length) throw new HttpError(400, `Faltan campos obligatorios: ${missing.join(', ')}`);
}

const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
const isDni = v => /^\d{8}$/.test(String(v || ''));
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(new Date(v));
const isTime = v => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(v || ''));

/** Fecha local (Perú) en formato YYYY-MM-DD. */
function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { HttpError, asyncHandler, required, isEmail, isDni, isDate, isTime, today };
