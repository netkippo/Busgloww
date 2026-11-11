/**
 * MODELO: Pasajero (RF4)
 * Toda persona que viaja queda registrada, tenga o no cuenta de usuario.
 */
const { query, queryOne } = require('../config/db');

/**
 * Registra o actualiza un pasajero por su DNI y devuelve su id.
 * `q1` permite ejecutarlo dentro de una transacción.
 */
async function registrar(p, q1 = queryOne) {
    const row = await q1(`
        MERGE pasajero AS t
        USING (SELECT @dni AS dni) AS s ON t.dni = s.dni
        WHEN MATCHED THEN UPDATE SET nombres = @nombres, apellidos = @apellidos,
                                     telefono = COALESCE(@telefono, t.telefono)
        WHEN NOT MATCHED THEN INSERT (nombres, apellidos, dni, telefono)
             VALUES (@nombres, @apellidos, @dni, @telefono)
        OUTPUT INSERTED.id_pasajero;`,
        { dni: p.dni, nombres: String(p.nombres).trim(), apellidos: String(p.apellidos).trim(), telefono: p.telefono || null });
    return row.id_pasajero;
}

/** Vincula (o crea) el pasajero de un usuario recién registrado. */
function vincularUsuario({ id, dni, nombres, apellidos, telefono }) {
    return query(`
        MERGE pasajero AS p
        USING (SELECT @dni AS dni) AS s ON p.dni = s.dni
        WHEN MATCHED THEN UPDATE SET id_usuario = @id
        WHEN NOT MATCHED THEN INSERT (nombres, apellidos, dni, telefono, id_usuario)
             VALUES (@nombres, @apellidos, @dni, @telefono, @id);`,
        { dni, id, nombres, apellidos, telefono: telefono || null });
}

/** Mantiene los datos del pasajero sincronizados con el perfil del usuario. */
function actualizarDesdeUsuario(idUsuario, { nombres, apellidos, telefono }) {
    return query(`UPDATE pasajero SET nombres = @nombres, apellidos = @apellidos, telefono = @telefono WHERE id_usuario = @id`,
        { id: idUsuario, nombres, apellidos, telefono });
}

module.exports = { registrar, vincularUsuario, actualizarDesdeUsuario };
