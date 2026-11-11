/**
 * MODELO: Notificaciones al comprador y a los pasajeros
 * Por ahora el envío es SIMULADO: el aviso se guarda en la tabla NOTIFICACION (se ve en el perfil
 * del cliente) y se escribe en la consola del servidor. Para enviarlo de verdad basta con
 * reemplazar `enviar()` por un proveedor de correo / SMS / WhatsApp.
 */
const { query } = require('../config/db');

/** Punto de integración con el proveedor real (correo, SMS, WhatsApp). */
function enviar(canal, destino, asunto) {
    console.log(`[notificación simulada] ${canal} → ${destino || 'perfil del usuario'}: ${asunto}`);
}

/** Inserta un aviso. `q` permite usarlo dentro de una transacción. */
async function registrar(q, { id_usuario = null, id_reserva = null, canal, destino = null, asunto, mensaje }) {
    await q(`
        INSERT INTO notificacion (id_usuario, id_reserva, canal, destino, asunto, mensaje)
        VALUES (@u, @r, @canal, @destino, @asunto, @mensaje)`,
        { u: id_usuario, r: id_reserva, canal, destino, asunto: asunto.slice(0, 150), mensaje: mensaje.slice(0, 1000) });
    enviar(canal, destino, asunto);
}

/**
 * Avisa sobre una reserva:
 *  - al comprador, si es un cliente con cuenta: en su perfil (APP) y por correo (EMAIL)
 *  - a cada pasajero con teléfono registrado: por SMS (cubre las ventas de ventanilla)
 */
async function avisarReserva(q, idReserva, asunto, mensaje) {
    const comprador = (await q(`
        SELECT u.id_usuario, u.correo, u.rol FROM reserva r JOIN usuario u ON u.id_usuario = r.id_usuario
         WHERE r.id_reserva = @r`, { r: idReserva }))[0];
    if (comprador && comprador.rol === 'CLIENTE') {
        await registrar(q, { id_usuario: comprador.id_usuario, id_reserva: idReserva, canal: 'APP', asunto, mensaje });
        await registrar(q, { id_usuario: comprador.id_usuario, id_reserva: idReserva, canal: 'EMAIL', destino: comprador.correo, asunto, mensaje });
    }
    const telefonos = await q(`
        SELECT DISTINCT p.telefono FROM reserva_asiento ra JOIN pasajero p ON p.id_pasajero = ra.id_pasajero
         WHERE ra.id_reserva = @r AND p.telefono IS NOT NULL AND p.telefono <> ''`, { r: idReserva });
    for (const t of telefonos) {
        await registrar(q, { id_reserva: idReserva, canal: 'SMS', destino: t.telefono, asunto, mensaje: `BusGlow: ${asunto}. ${mensaje}` });
    }
}

/** Avisos del usuario (se muestran en su perfil). */
function deUsuario(idUsuario) {
    return query(`
        SELECT TOP 30 id_notificacion, id_reserva, asunto, mensaje, leida, CONVERT(VARCHAR(16), fecha, 120) AS fecha
          FROM notificacion
         WHERE id_usuario = @u AND canal = 'APP'
         ORDER BY fecha DESC, id_notificacion DESC`, { u: idUsuario });
}

function marcarLeidas(idUsuario) {
    return query('UPDATE notificacion SET leida = 1 WHERE id_usuario = @u AND leida = 0', { u: idUsuario });
}

module.exports = { registrar, avisarReserva, deUsuario, marcarLeidas, enviar };
