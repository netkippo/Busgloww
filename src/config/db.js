/**
 * Conexión a SQL Server usando el paquete "mssql".
 * Soporta dos modos (ver .env.example):
 *   - tedious      : usuario/contraseña de SQL Server (JavaScript puro)
 *   - msnodesqlv8  : autenticación de Windows vía ODBC
 */
require('dotenv').config();

const DRIVER = (process.env.DB_DRIVER || 'tedious').toLowerCase();
const sql = DRIVER === 'msnodesqlv8' ? require('mssql/msnodesqlv8') : require('mssql');

/**
 * Conexiones simultáneas a la base y tiempos de espera (ambos drivers).
 *  DB_POOL_MAX        : conexiones abiertas a la vez (por defecto 30). Con pocas conexiones, las
 *                       peticiones hacen cola y fallan con "TimeoutError: operation timed out".
 *  DB_POOL_ESPERA_MS  : cuánto espera una petición por una conexión libre (por defecto 15 s)
 *  DB_TIMEOUT_MS      : tiempo máximo de una consulta (por defecto 30 s)
 */
const POOL = {
    max: parseInt(process.env.DB_POOL_MAX, 10) || 30,
    min: 2,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: parseInt(process.env.DB_POOL_ESPERA_MS, 10) || 15000
};
const REQUEST_TIMEOUT = parseInt(process.env.DB_TIMEOUT_MS, 10) || 30000;

/**
 * Azure SQL Database exige conexión cifrada. Se activa sola si el servidor termina en
 * .database.windows.net; también se puede forzar con DB_ENCRYPT=true / false.
 */
function usarCifrado(server) {
    if (process.env.DB_ENCRYPT) return process.env.DB_ENCRYPT.toLowerCase() === 'true';
    return /\.database\.windows\.net$/i.test(server || '');
}

/**
 * Hora del Perú en la base de datos.
 * SQL Server local devuelve la hora del equipo (Lima), pero Azure SQL Database trabaja siempre
 * en UTC (+5 h). Para que retrasos, vencimientos y fechas sean correctos en ambos casos, las
 * consultas usan la hora de la zona DB_ZONA_HORARIA en lugar de GETDATE() / SYSDATETIME().
 * La hora se calcula UNA vez por consulta (variable @__ahora), no una vez por fila.
 */
const ZONA = (process.env.DB_ZONA_HORARIA || 'SA Pacific Standard Time').replace(/'/g, '');
const AHORA_SQL = `CAST(SYSDATETIMEOFFSET() AT TIME ZONE '${ZONA}' AS DATETIME2)`;
const RE_AHORA = /\b(?:GETDATE|SYSDATETIME)\(\)/gi;

function conHoraLocal(texto) {
    if (!RE_AHORA.test(texto)) return texto;
    RE_AHORA.lastIndex = 0;
    return `DECLARE @__ahora DATETIME2 = ${AHORA_SQL};\n` + texto.replace(RE_AHORA, '@__ahora');
}

function buildConfig(database = process.env.DB_NAME || 'BusGlowDB') {
    if (DRIVER === 'msnodesqlv8') {
        const odbc = process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
        const server = process.env.DB_SERVER || 'localhost\\SQLEXPRESS';
        return {
            connectionString:
                `Driver={${odbc}};Server=${server};Database=${database};` +
                'Trusted_Connection=yes;TrustServerCertificate=yes;',
            pool: { ...POOL },
            requestTimeout: REQUEST_TIMEOUT,
            options: { useUTC: false }
        };
    }

    const config = {
        server: process.env.DB_SERVER || 'localhost',
        database,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        pool: { ...POOL },
        requestTimeout: REQUEST_TIMEOUT,
        options: {
            // local (SQL Server Express): sin cifrado; Azure SQL: cifrado obligatorio
            encrypt: usarCifrado(process.env.DB_SERVER),
            trustServerCertificate: !usarCifrado(process.env.DB_SERVER),
            useUTC: false                   // las fechas se guardan en hora local (Perú)
        }
    };
    if (process.env.DB_PORT) config.port = parseInt(process.env.DB_PORT, 10);
    if (process.env.DB_INSTANCE) config.options.instanceName = process.env.DB_INSTANCE;
    return config;
}

let poolPromise = null;

function getPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(buildConfig())
            .connect()
            .catch(err => {
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
}

/** Agrega parámetros a un request. Los valores undefined se envían como NULL. */
function bind(request, params = {}) {
    for (const [name, value] of Object.entries(params)) {
        if (value === undefined || value === null) request.input(name, sql.NVarChar, null);
        else request.input(name, value);
    }
    return request;
}

/** Ejecuta una consulta y devuelve el recordset. */
async function query(text, params) {
    const pool = await getPool();
    const result = await bind(pool.request(), params).query(conHoraLocal(text));
    return result.recordset || [];
}

/** Devuelve la primera fila o null. */
async function queryOne(text, params) {
    const rows = await query(text, params);
    return rows[0] || null;
}

/**
 * Ejecuta una función dentro de una transacción.
 *   await withTransaction(async (q, q1) => { await q('...', {...}); });
 */
async function withTransaction(fn) {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    const q = async (text, params) => (await bind(new sql.Request(tx), params).query(conHoraLocal(text))).recordset || [];
    const q1 = async (text, params) => (await q(text, params))[0] || null;
    try {
        const result = await fn(q, q1);
        await tx.commit();
        return result;
    } catch (err) {
        try { await tx.rollback(); } catch (_) { /* ya revertida */ }
        throw err;
    }
}

module.exports = { sql, getPool, query, queryOne, withTransaction, buildConfig, DRIVER, conHoraLocal, AHORA_SQL, usarCifrado };
