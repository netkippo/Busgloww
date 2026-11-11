/** Prueba rápida de conexión:  npm run db:test */
require('dotenv').config();
const { sql, buildConfig, DRIVER, AHORA_SQL } = require('../src/config/db');

(async () => {
    const cfg = buildConfig('master');
    console.log(`Driver: ${DRIVER}`);
    console.log(`Servidor: ${cfg.server || cfg.connectionString}${cfg.port ? ':' + cfg.port : ''}${cfg.options && cfg.options.instanceName ? ' (instancia ' + cfg.options.instanceName + ')' : ''}`);
    try {
        const pool = await new sql.ConnectionPool(cfg).connect();
        const r = await pool.request().query('SELECT @@VERSION AS version');
        console.log('✅ Conexión exitosa\n' + r.recordset[0].version);
        const h = await pool.request().query(`SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS servidor, CONVERT(VARCHAR(19), ${AHORA_SQL}, 120) AS peru`);
        console.log(`Hora del servidor SQL: ${h.recordset[0].servidor}  ·  Hora del Perú usada por BusGlow: ${h.recordset[0].peru}`);
        await pool.close();
        process.exit(0);
    } catch (err) {
        console.error('❌ No se pudo conectar:', err.message);
        process.exit(1);
    }
})();
