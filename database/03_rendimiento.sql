/* =====================================================================
   BusGlow - Script 03: Mejoras de rendimiento para una base EXISTENTE
   ---------------------------------------------------------------------
   Aplica lo detectado en las pruebas de carga con JMeter SIN borrar datos.
   (Si ejecutas "npm run db:init" no hace falta: 01_schema.sql ya lo incluye.)

   Cómo usarlo: ábrelo en SSMS conectado a tu servidor y pulsa Ejecutar (F5).
   Detén antes el servidor (npm start), porque se cierran las conexiones abiertas.
   ===================================================================== */
USE BusGlowDB;
GO

/* 1. Las lecturas no esperan a las escrituras (versiones de fila) */
IF (SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name = 'BusGlowDB') = 0
    ALTER DATABASE BusGlowDB SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
GO

/* 2. Índices para reservas, pagos y boletos */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_reserva_viaje' AND object_id = OBJECT_ID('reserva'))
    CREATE INDEX ix_reserva_viaje ON reserva (id_viaje, estado);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_reserva_usuario' AND object_id = OBJECT_ID('reserva'))
    CREATE INDEX ix_reserva_usuario ON reserva (id_usuario);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_reserva_pendiente' AND object_id = OBJECT_ID('reserva'))
    CREATE INDEX ix_reserva_pendiente ON reserva (expira_en) WHERE estado = 'Pendiente';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_reserva_asiento_reserva' AND object_id = OBJECT_ID('reserva_asiento'))
    CREATE INDEX ix_reserva_asiento_reserva ON reserva_asiento (id_reserva) INCLUDE (id_asiento, activo);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_pago_reserva' AND object_id = OBJECT_ID('pago'))
    CREATE INDEX ix_pago_reserva ON pago (id_reserva);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_boleto_reserva' AND object_id = OBJECT_ID('boleto'))
    CREATE INDEX ix_boleto_reserva ON boleto (id_reserva);
GO

/* 3. Nivel de compatibilidad 130 o superior (la reserva usa OPENJSON, SQL Server 2016+) */
IF (SELECT compatibility_level FROM sys.databases WHERE name = 'BusGlowDB') < 130
    ALTER DATABASE BusGlowDB SET COMPATIBILITY_LEVEL = 130;
GO

/* 4. Verificación: lecturas_sin_bloqueo debe ser 1 y compatibilidad 130 o más */
SELECT name AS base_de_datos, is_read_committed_snapshot_on AS lecturas_sin_bloqueo, compatibility_level AS compatibilidad
  FROM sys.databases WHERE name = 'BusGlowDB';
SELECT OBJECT_NAME(object_id) AS tabla, name AS indice
  FROM sys.indexes WHERE name LIKE 'ix_%' ORDER BY tabla, indice;
PRINT 'Mejoras de rendimiento aplicadas.';
GO
