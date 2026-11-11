/**
 * BusGlow - Inicio del servidor
 */
require('dotenv').config();

/*
 * Hilos de trabajo de Node (libuv). Por defecto son solo 4 y los comparten:
 *   - cada consulta del driver msnodesqlv8 (ODBC, autenticación de Windows)
 *   - cada cálculo de contraseña con scrypt (inicio de sesión y registro)
 * Con 4 hilos, solo 4 consultas avanzan a la vez aunque el pool tenga 30 conexiones: el resto
 * hace cola y termina en "Query timeout expired" (hallado en las pruebas de 250, 500 y 1000 usuarios).
 * Debe fijarse ANTES de cualquier operación asíncrona; se puede cambiar con UV_THREADPOOL_SIZE en .env.
 */
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '64';

/* Zona horaria del servidor: Perú. En la nube (Azure, Render…) el servidor trabaja en UTC. */
process.env.TZ = process.env.TZ || 'America/Lima';
const app = require('./app');
const { getPool } = require('./config/db');
const Viaje = require('./models/ViajeModel');

const PORT = parseInt(process.env.PORT, 10) || 3000;

/* Tareas periódicas: liberar reservas vencidas y actualizar estados de viajes */
async function tareasProgramadas() {
    try {
        await Viaje.liberarReservasExpiradas({ forzar: true });
        await Viaje.actualizarEstadosAutomaticos();
    } catch (err) {
        console.error('[tareas] ', err.message);
    }
}

app.listen(PORT, async () => {
    console.log(`\n🚌 BusGlow escuchando en http://localhost:${PORT}`);
    console.log(`   Hilos de trabajo: ${process.env.UV_THREADPOOL_SIZE} · conexiones a la base: ${process.env.DB_POOL_MAX || 30}`);
    if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET no está definido en .env (se usa una clave de desarrollo).');
    try {
        await getPool();
        console.log('✅ Conectado a SQL Server');
        await tareasProgramadas();
        setInterval(tareasProgramadas, 60 * 1000);
    } catch (err) {
        console.error('❌ No se pudo conectar a SQL Server:', err.message);
        console.error('   Revisa el archivo .env y la sección "Configurar SQL Server Express" del README.');
    }
});
