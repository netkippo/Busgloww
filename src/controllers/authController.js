/**
 * CONTROLADOR: Autenticación y perfil (RF1, RF2)
 */
const Usuario = require('../models/UsuarioModel');
const Pasajero = require('../models/PasajeroModel');
const Notificacion = require('../models/NotificacionModel');
const { HttpError, required, isEmail, isDni, isDate } = require('../utils/http');
const { hashPassword, verifyPassword, passwordError, signToken } = require('../utils/security');

/* Límite simple de intentos de login (protección contra fuerza bruta) */
const intentos = new Map();
function controlarIntentos(clave) {
    const ahora = Date.now();
    const registro = (intentos.get(clave) || []).filter(t => ahora - t < 10 * 60 * 1000);
    if (registro.length >= 5) {
        throw new HttpError(429, 'Demasiados intentos fallidos. Espera unos minutos e inténtalo nuevamente.');
    }
    return registro;
}

async function registro(req, res) {
    const b = req.body || {};
    required(b, ['nombres', 'apellidos', 'dni', 'correo', 'password']);

    const correo = String(b.correo).trim().toLowerCase();
    if (!isEmail(correo)) throw new HttpError(400, 'El correo electrónico no es válido.');
    if (!isDni(b.dni)) throw new HttpError(400, 'El DNI debe tener 8 dígitos.');
    const errPass = passwordError(b.password);
    if (errPass) throw new HttpError(400, errPass);

    const existe = await Usuario.buscarPorCorreoODni(correo, b.dni);
    if (existe) {
        throw new HttpError(409, existe.correo === correo
            ? 'Ya existe una cuenta con ese correo.'
            : 'Ya existe una cuenta con ese DNI.');
    }

    const nuevo = await Usuario.crear({
        nombres: String(b.nombres).trim(),
        apellidos: String(b.apellidos).trim(),
        dni: b.dni,
        correo,
        telefono: b.telefono ? String(b.telefono).trim() : null,
        password: await hashPassword(b.password)
    });

    // El usuario también queda registrado como pasajero (RF4)
    await Pasajero.vincularUsuario({ id: nuevo.id_usuario, dni: b.dni, nombres: nuevo.nombres, apellidos: nuevo.apellidos, telefono: b.telefono });

    const usuario = await Usuario.obtener(nuevo.id_usuario);
    res.status(201).json({ mensaje: 'Cuenta creada correctamente.', token: signToken(usuario), usuario });
}

async function login(req, res) {
    const { correo, password } = req.body || {};
    required({ correo, password }, ['correo', 'password']);

    const clave = `${req.ip}|${String(correo).toLowerCase()}`;
    const registroIntentos = controlarIntentos(clave);

    const user = await Usuario.obtenerParaLogin(String(correo).trim().toLowerCase());
    if (!user || !(await verifyPassword(password, user.password))) {
        registroIntentos.push(Date.now());
        intentos.set(clave, registroIntentos);
        throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }
    if (!user.estado) throw new HttpError(403, 'Tu cuenta está desactivada. Comunícate con soporte.');

    intentos.delete(clave);
    res.json({ token: signToken(user), usuario: await Usuario.obtener(user.id_usuario) });
}

async function perfil(req, res) {
    res.json(await Usuario.obtener(req.user.id_usuario));
}

async function actualizarPerfil(req, res) {
    const b = req.body || {};
    required(b, ['nombres', 'apellidos', 'correo']);
    const correo = String(b.correo).trim().toLowerCase();
    if (!isEmail(correo)) throw new HttpError(400, 'El correo electrónico no es válido.');
    if (b.fecha_nacimiento && !isDate(b.fecha_nacimiento)) throw new HttpError(400, 'Fecha de nacimiento inválida.');
    if (await Usuario.correoUsadoPorOtro(correo, req.user.id_usuario)) {
        throw new HttpError(409, 'Ese correo ya está en uso por otra cuenta.');
    }

    const datos = {
        nombres: String(b.nombres).trim(),
        apellidos: String(b.apellidos).trim(),
        correo,
        telefono: b.telefono || null,
        fecha_nacimiento: b.fecha_nacimiento || null
    };
    await Usuario.actualizarPerfil(req.user.id_usuario, datos);
    await Pasajero.actualizarDesdeUsuario(req.user.id_usuario, datos);

    res.json({ mensaje: 'Tus datos fueron actualizados correctamente.', usuario: await Usuario.obtener(req.user.id_usuario) });
}

async function cambiarPassword(req, res) {
    const { actual, nueva } = req.body || {};
    required({ actual, nueva }, ['actual', 'nueva']);

    const user = await Usuario.obtenerPassword(req.user.id_usuario);
    if (!(await verifyPassword(actual, user.password))) throw new HttpError(400, 'La contraseña actual no es correcta.');
    const errPass = passwordError(nueva);
    if (errPass) throw new HttpError(400, errPass);

    await Usuario.actualizarPassword(req.user.id_usuario, await hashPassword(nueva));
    res.json({ mensaje: 'Tu contraseña ha sido actualizada correctamente.' });
}

async function resumen(req, res) {
    res.json(await Usuario.resumen(req.user.id_usuario));
}

/** Avisos del usuario (cancelaciones, reembolsos, cambios de viaje, compras). */
async function notificaciones(req, res) {
    res.json(await Notificacion.deUsuario(req.user.id_usuario));
}

async function marcarNotificaciones(req, res) {
    await Notificacion.marcarLeidas(req.user.id_usuario);
    res.json({ mensaje: 'Avisos marcados como leídos.' });
}

module.exports = { registro, login, perfil, actualizarPerfil, cambiarPassword, resumen, notificaciones, marcarNotificaciones };
