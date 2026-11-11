/**
 * MODELO: Usuario (RF1, RF2, RF3)
 */
const { query, queryOne } = require('../config/db');

const SQL_PUBLICO = `
    SELECT u.id_usuario, u.nombres, u.apellidos, u.dni, u.correo, u.telefono,
           CONVERT(VARCHAR(10), u.fecha_nacimiento, 23) AS fecha_nacimiento,
           u.rol, u.id_empresa, e.razon_social AS empresa, u.estado,
           CONVERT(VARCHAR(10), u.fecha_registro, 23) AS fecha_registro
      FROM usuario u
      LEFT JOIN empresa e ON e.id_empresa = u.id_empresa`;

/** Datos del usuario sin la contraseña. */
function obtener(id) {
    return queryOne(`${SQL_PUBLICO} WHERE u.id_usuario = @id`, { id });
}

/** Datos mínimos para validar la sesión (middleware). */
function obtenerSesion(id) {
    // Un usuario de empresa queda inactivo si su empresa fue desactivada
    return queryOne(`
        SELECT u.id_usuario, u.nombres, u.apellidos, u.correo, u.rol, u.id_empresa,
               CAST(CASE WHEN u.estado = 1 AND (e.id_empresa IS NULL OR e.estado = 1) THEN 1 ELSE 0 END AS BIT) AS estado
          FROM usuario u LEFT JOIN empresa e ON e.id_empresa = u.id_empresa
         WHERE u.id_usuario = @id`, { id });
}

/** Incluye el hash de la contraseña: solo para el login. */
function obtenerParaLogin(correo) {
    return queryOne(`
        SELECT u.id_usuario, u.nombres, u.apellidos, u.rol, u.id_empresa, u.password,
               CAST(CASE WHEN u.estado = 1 AND (e.id_empresa IS NULL OR e.estado = 1) THEN 1 ELSE 0 END AS BIT) AS estado
          FROM usuario u LEFT JOIN empresa e ON e.id_empresa = u.id_empresa
         WHERE u.correo = @correo`, { correo });
}

function obtenerPassword(id) {
    return queryOne('SELECT password FROM usuario WHERE id_usuario = @id', { id });
}

function buscarPorCorreoODni(correo, dni) {
    return queryOne('SELECT correo, dni FROM usuario WHERE correo = @correo OR dni = @dni', { correo, dni });
}

async function correoUsadoPorOtro(correo, id) {
    return !!(await queryOne('SELECT 1 AS x FROM usuario WHERE correo = @correo AND id_usuario <> @id', { correo, id }));
}

/** Crea un cliente; `password` ya viene cifrado. */
function crear({ nombres, apellidos, dni, correo, telefono, password }) {
    return queryOne(`
        INSERT INTO usuario (nombres, apellidos, dni, correo, telefono, password, rol)
        OUTPUT INSERTED.id_usuario, INSERTED.nombres, INSERTED.apellidos, INSERTED.rol
        VALUES (@nombres, @apellidos, @dni, @correo, @telefono, @password, 'CLIENTE')`,
        { nombres, apellidos, dni, correo, telefono, password });
}

function actualizarPerfil(id, { nombres, apellidos, correo, telefono, fecha_nacimiento }) {
    return query(`
        UPDATE usuario
           SET nombres = @nombres, apellidos = @apellidos, correo = @correo,
               telefono = @telefono, fecha_nacimiento = @fecha
         WHERE id_usuario = @id`,
        { id, nombres, apellidos, correo, telefono, fecha: fecha_nacimiento });
}

function actualizarPassword(id, hash) {
    return query('UPDATE usuario SET password = @p WHERE id_usuario = @id', { p: hash, id });
}

/** Estadísticas de viajes del usuario para su perfil. */
function resumen(id) {
    return queryOne(`
        SELECT
            (SELECT COUNT(DISTINCT r.id_viaje) FROM reserva r JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE r.id_usuario = @id AND r.estado = 'Confirmada' AND v.salida_dt < GETDATE()) AS viajes_realizados,
            (SELECT COUNT(DISTINCT ru.ciudad_destino) FROM reserva r
               JOIN viaje v ON v.id_viaje = r.id_viaje JOIN ruta ru ON ru.id_ruta = v.id_ruta
              WHERE r.id_usuario = @id AND r.estado = 'Confirmada') AS destinos,
            (SELECT COUNT(*) FROM reserva r JOIN viaje v ON v.id_viaje = r.id_viaje
              WHERE r.id_usuario = @id AND r.estado = 'Confirmada' AND v.salida_dt >= GETDATE()) AS proximos,
            -- lo pagado menos lo que se le devolvió
            (SELECT CAST(ISNULL(SUM(p.monto), 0) AS FLOAT) FROM pago p JOIN reserva r ON r.id_reserva = p.id_reserva
              WHERE r.id_usuario = @id AND p.estado IN ('Pagado','Reembolsado'))
          - (SELECT CAST(ISNULL(SUM(rb.monto), 0) AS FLOAT) FROM reembolso rb JOIN reserva r ON r.id_reserva = rb.id_reserva
              WHERE r.id_usuario = @id AND rb.estado = 'Procesado') AS total_pagado`, { id });
}

module.exports = {
    obtener, obtenerSesion, obtenerParaLogin, obtenerPassword, buscarPorCorreoODni, correoUsadoPorOtro,
    crear, actualizarPerfil, actualizarPassword, resumen
};
