const { verifyToken } = require('../utils/security');
const Usuario = require('../models/UsuarioModel');
const { HttpError, asyncHandler } = require('../utils/http');

/**
 * Permisos por rol (RF3).
 *  ADMIN    : administrador de la plataforma BusGlow (todo el sistema y todas las empresas)
 *  EMPRESA  : empresa de transporte; gestiona SU flota, conductores, horarios, viajes,
 *             vendedores y reportes
 *  VENDEDOR : venta en ventanilla, programación diaria, embarque, pasajeros
 *             (si tiene empresa asignada, solo trabaja con los viajes de esa empresa)
 *  CLIENTE  : sus propias reservas y perfil
 */
const PERMISOS = {
    ADMIN: ['*'],
    EMPRESA: ['viajes:ver', 'viajes:estado', 'viajes:programar', 'viajes:cancelar', 'alertas:ver', 'dashboard:ver',
              'reportes:ver', 'flota:gestionar', 'ventas:ventanilla', 'boletos:verificar'],
    VENDEDOR: ['viajes:ver', 'viajes:estado', 'alertas:ver', 'dashboard:ver', 'pasajeros:gestionar',
               'ventas:ventanilla', 'boletos:verificar'],
    CLIENTE: []
};

function tienePermiso(rol, permiso) {
    const lista = PERMISOS[rol] || [];
    return lista.includes('*') || lista.includes(permiso);
}

/**
 * Empresa a la que está limitado el usuario (multiempresa).
 * null = sin límite (administrador de la plataforma o vendedor general).
 */
function alcanceEmpresa(user) {
    if (!user || user.rol === 'ADMIN') return null;
    return user.id_empresa || null;
}

/** Exige un token JWT válido y un usuario activo. */
const requireAuth = asyncHandler(async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Debes iniciar sesión.');

    let payload;
    try {
        payload = verifyToken(token);
    } catch {
        throw new HttpError(401, 'Tu sesión expiró. Vuelve a iniciar sesión.');
    }

    const user = await Usuario.obtenerSesion(payload.id);
    if (!user || !user.estado) throw new HttpError(401, 'Usuario inactivo o inexistente.');

    req.user = user;
    next();
});

/** Exige uno de los roles indicados. */
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
        return next(new HttpError(403, 'No tienes permisos para realizar esta acción.'));
    }
    next();
};

/** Exige un permiso concreto. */
const requirePermiso = permiso => (req, res, next) => {
    if (!req.user || !tienePermiso(req.user.rol, permiso)) {
        return next(new HttpError(403, 'No tienes permisos para realizar esta acción.'));
    }
    next();
};

module.exports = { requireAuth, requireRole, requirePermiso, tienePermiso, alcanceEmpresa, PERMISOS };
