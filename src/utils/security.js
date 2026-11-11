const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'busglow-dev-secret-cambiar';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

/*
 * Contraseñas con scrypt + sal aleatoria (formato: scrypt$sal$hash).
 * Se usa la versión ASÍNCRONA de crypto.scrypt: el cálculo corre en un hilo aparte y el servidor
 * sigue atendiendo a los demás usuarios. La versión síncrona (scryptSync) bloqueaba todo el
 * servidor durante cada inicio de sesión (detectado en las pruebas de carga).
 */
const { promisify } = require('util');
const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scryptAsync(password, salt, 64)).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

async function verifyPassword(password, stored) {
    const [alg, salt, hash] = String(stored || '').split('$');
    if (alg !== 'scrypt' || !salt || !hash) return false;
    const test = await scryptAsync(String(password), salt, 64);
    const original = Buffer.from(hash, 'hex');
    return original.length === test.length && crypto.timingSafeEqual(original, test);
}

/** Reglas mínimas de contraseña. */
function passwordError(password) {
    if (!password || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'La contraseña debe contener letras y números.';
    return null;
}

function signToken(user) {
    return jwt.sign(
        { id: user.id_usuario, rol: user.rol, nombre: `${user.nombres} ${user.apellidos}` },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

/** Código aleatorio legible (sin caracteres ambiguos). */
function randomCode(prefix, length = 8) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
    return `${prefix}-${out}`;
}

module.exports = { hashPassword, verifyPassword, passwordError, signToken, verifyToken, randomCode, JWT_SECRET };
