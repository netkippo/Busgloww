/**
 * Crea la base de datos BusGlowDB, sus tablas y los datos de prueba.
 *   npm run db:init
 * ¡ATENCIÓN! Borra y vuelve a crear todas las tablas.
 */
require('dotenv').config();
const path = require('path');
const { sql, buildConfig, usarCifrado } = require('../src/config/db');
const { runSqlFile } = require('./sql-runner');

const DB = process.env.DB_NAME || 'BusGlowDB';
const dir = path.join(__dirname, '..', 'database');

(async () => {
    try {
        console.log('Conectando a SQL Server (master)...');
        const master = await new sql.ConnectionPool(buildConfig('master')).connect();
        if (usarCifrado(process.env.DB_SERVER)) {
            // Azure SQL: NO se crea la base desde aquí (se crearía una base de pago).
            // Debe existir la base creada en el portal con la oferta gratuita.
            const r = await master.request().query(`SELECT COUNT(*) AS n FROM sys.databases WHERE name = '${DB}'`);
            if (!r.recordset[0].n) {
                throw new Error(`La base ${DB} no existe en Azure. Créala en el portal con la oferta gratuita ("Apply free offer") y vuelve a ejecutar.`);
            }
        } else {
            await master.request().batch(`IF DB_ID('${DB}') IS NULL CREATE DATABASE [${DB}];`);
        }
        await master.close();
        console.log(`✔ Base de datos ${DB} lista`);

        const pool = await new sql.ConnectionPool(buildConfig(DB)).connect();
        await runSqlFile(pool, path.join(dir, '01_schema.sql'), { skipUse: true });
        console.log('✔ Tablas y procedimientos creados');
        await runSqlFile(pool, path.join(dir, '02_seed.sql'), { skipUse: true });
        console.log('✔ Datos de prueba cargados');

        const r = await pool.request().query(`
            SELECT (SELECT COUNT(*) FROM viaje) AS viajes, (SELECT COUNT(*) FROM asiento) AS asientos,
                   (SELECT COUNT(*) FROM boleto) AS boletos`);
        console.log(`  Viajes: ${r.recordset[0].viajes} | Asientos: ${r.recordset[0].asientos} | Boletos: ${r.recordset[0].boletos}`);
        await pool.close();
        console.log('\nListo. Ahora ejecuta: npm start');
        process.exit(0);
    } catch (err) {
        console.error('\n❌ Error inicializando la base de datos:\n  ', err.message);
        console.error('\nRevisa el archivo .env y la guía "Configurar SQL Server Express" del README.');
        process.exit(1);
    }
})();
