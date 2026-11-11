/**
 * MODELO: Ciudad y suscriptores del boletín (consultas públicas).
 */
const { query, queryOne } = require('../config/db');

function listarConTerminales() {
    return query(`
        SELECT c.id_ciudad, c.nombre, c.departamento,
               (SELECT COUNT(*) FROM terminal t WHERE t.id_ciudad = c.id_ciudad AND t.estado = 1) AS terminales
          FROM ciudad c ORDER BY c.nombre`);
}

/** Registra un correo en el boletín (si no existía). */
async function suscribir(correo) {
    const existe = await queryOne('SELECT 1 AS x FROM suscriptor WHERE correo = @correo', { correo });
    if (!existe) await query('INSERT INTO suscriptor (correo) VALUES (@correo)', { correo });
}

module.exports = { listarConTerminales, suscribir };
