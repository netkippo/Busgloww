/* =====================================================================
   BusGlow - Sistema de gestión y venta de pasajes interprovinciales
   Script 01: Creación de la base de datos y tablas (SQL Server)
   ---------------------------------------------------------------------
   Basado en el diccionario de datos del documento del proyecto.
   Se agregan tablas/campos necesarios para cubrir los requerimientos
   funcionales: TERMINAL (RF8), HORARIO (RF10), CONDUCTOR (RF7),
   PASAJERO (RF4), VIAJE_MODIFICACION (RF15-16), horas reales (RF18).

   Versión 3:
   - Multiempresa: cada empresa gestiona su flota y su programación
     (usuario.id_empresa, rol EMPRESA).
   - Última ubicación del bus (bus.id_terminal_actual) y validación de la
     cadena de viajes: el bus debe salir desde donde terminó su viaje anterior.
   - Descanso y relevo de conductores (VIAJE_CONDUCTOR, PARAMETRO):
     descanso mínimo entre viajes y máximo de horas de conducción.
   - Cancelaciones: REEMBOLSO (devolución del pago), NOTIFICACION (avisos
     al comprador y pasajeros) y reubicación en otro viaje (reserva.id_reserva_origen).
   ===================================================================== */

IF DB_ID('BusGlowDB') IS NULL
    CREATE DATABASE BusGlowDB;
GO

USE BusGlowDB;
GO

/* ---------- Rendimiento: las lecturas no esperan a las escrituras ----------
   READ_COMMITTED_SNAPSHOT hace que una consulta lea la última versión confirmada de los datos
   en lugar de esperar a que termine una reserva o un pago en curso. Sin esto, en las pruebas
   de carga (JMeter) las búsquedas quedaban bloqueadas y fallaban por tiempo de espera. */
IF (SELECT is_read_committed_snapshot_on FROM sys.databases WHERE database_id = DB_ID()) = 0
    ALTER DATABASE CURRENT SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
GO

/* ---------- Limpieza (orden inverso por FKs) ---------- */
DROP TABLE IF EXISTS notificacion;
DROP TABLE IF EXISTS reembolso;
DROP TABLE IF EXISTS boleto;
DROP TABLE IF EXISTS pago;
DROP TABLE IF EXISTS reserva_asiento;
DROP TABLE IF EXISTS reserva;
DROP TABLE IF EXISTS viaje_modificacion;
DROP TABLE IF EXISTS viaje_conductor;
DROP TABLE IF EXISTS viaje;
DROP TABLE IF EXISTS horario;
DROP TABLE IF EXISTS ruta;
DROP TABLE IF EXISTS asiento;
DROP TABLE IF EXISTS conductor;
DROP TABLE IF EXISTS bus;
DROP TABLE IF EXISTS terminal;
DROP TABLE IF EXISTS ciudad;
DROP TABLE IF EXISTS pasajero;
DROP TABLE IF EXISTS suscriptor;
DROP TABLE IF EXISTS usuario;
DROP TABLE IF EXISTS empresa;
DROP TABLE IF EXISTS parametro;
GO

/* ---------- EMPRESA ---------- */
CREATE TABLE empresa (
    id_empresa     INT IDENTITY(1,1) PRIMARY KEY,
    razon_social   VARCHAR(150) NOT NULL,
    ruc            VARCHAR(11)  NOT NULL UNIQUE,
    telefono       VARCHAR(20)  NULL,
    correo         VARCHAR(100) NULL,
    direccion      VARCHAR(200) NULL,
    logo           VARCHAR(255) NULL,
    estado         BIT NOT NULL DEFAULT 1
);

/* ---------- BUS ---------- */
CREATE TABLE bus (
    id_bus         INT IDENTITY(1,1) PRIMARY KEY,
    id_empresa     INT NOT NULL REFERENCES empresa(id_empresa),
    placa          VARCHAR(10) NOT NULL UNIQUE,
    modelo         VARCHAR(50) NULL,
    capacidad      INT NOT NULL DEFAULT 0,
    tipo_servicio  VARCHAR(50) NOT NULL,         -- Económico, Semicama, Cama, VIP, Ejecutivo
    pisos          INT NOT NULL DEFAULT 1,
    id_terminal_actual INT NULL,                 -- última ubicación conocida (FK agregada después de TERMINAL)
    estado         BIT NOT NULL DEFAULT 1
);

/* ---------- ASIENTO (distribución del bus, RF6) ---------- */
CREATE TABLE asiento (
    id_asiento     INT IDENTITY(1,1) PRIMARY KEY,
    id_bus         INT NOT NULL REFERENCES bus(id_bus) ON DELETE CASCADE,
    numero         VARCHAR(10) NOT NULL,
    piso           INT NOT NULL DEFAULT 1,
    fila           INT NOT NULL,
    columna        INT NOT NULL,                  -- 1,2 = lado izquierdo | 4,5 = lado derecho (3 = pasillo)
    estado         VARCHAR(30) NOT NULL DEFAULT 'Disponible'
        CHECK (estado IN ('Disponible','Mantenimiento')),
    CONSTRAINT uq_asiento_bus_numero UNIQUE (id_bus, numero)
);

/* ---------- CONDUCTOR (RF7) ---------- */
CREATE TABLE conductor (
    id_conductor   INT IDENTITY(1,1) PRIMARY KEY,
    id_empresa     INT NOT NULL REFERENCES empresa(id_empresa),
    nombres        VARCHAR(100) NOT NULL,
    apellidos      VARCHAR(100) NOT NULL,
    dni            VARCHAR(8)   NOT NULL UNIQUE,
    licencia       VARCHAR(20)  NOT NULL,
    telefono       VARCHAR(20)  NULL,
    estado         BIT NOT NULL DEFAULT 1
);

/* ---------- CIUDAD ---------- */
CREATE TABLE ciudad (
    id_ciudad      INT IDENTITY(1,1) PRIMARY KEY,
    nombre         VARCHAR(100) NOT NULL UNIQUE,
    departamento   VARCHAR(100) NOT NULL
);

/* ---------- TERMINAL (RF8) ---------- */
CREATE TABLE terminal (
    id_terminal    INT IDENTITY(1,1) PRIMARY KEY,
    id_ciudad      INT NOT NULL REFERENCES ciudad(id_ciudad),
    nombre         VARCHAR(150) NOT NULL,
    direccion      VARCHAR(200) NULL,
    estado         BIT NOT NULL DEFAULT 1
);

ALTER TABLE bus ADD CONSTRAINT fk_bus_terminal_actual
    FOREIGN KEY (id_terminal_actual) REFERENCES terminal(id_terminal);

/* ---------- RUTA (RF9) ---------- */
CREATE TABLE ruta (
    id_ruta            INT IDENTITY(1,1) PRIMARY KEY,
    ciudad_origen      INT NOT NULL REFERENCES ciudad(id_ciudad),
    ciudad_destino     INT NOT NULL REFERENCES ciudad(id_ciudad),
    terminal_origen    INT NULL REFERENCES terminal(id_terminal),
    terminal_destino   INT NULL REFERENCES terminal(id_terminal),
    distancia_km       DECIMAL(10,2) NULL,
    duracion_estimada  VARCHAR(50) NULL,          -- texto, p.ej. "12h 30min"
    duracion_minutos   INT NOT NULL,              -- usado para calcular la llegada
    estado             BIT NOT NULL DEFAULT 1,
    CONSTRAINT ck_ruta_ciudades CHECK (ciudad_origen <> ciudad_destino)
);

/* ---------- HORARIO (RF10): horarios base de salida/llegada por ruta ---------- */
CREATE TABLE horario (
    id_horario     INT IDENTITY(1,1) PRIMARY KEY,
    id_ruta        INT NOT NULL REFERENCES ruta(id_ruta),
    id_empresa     INT NOT NULL REFERENCES empresa(id_empresa),
    hora_salida    TIME(0) NOT NULL,
    hora_llegada   TIME(0) NOT NULL,
    precio_base    DECIMAL(10,2) NOT NULL,
    estado         BIT NOT NULL DEFAULT 1
);

/* ---------- VIAJE (RF11, RF17, RF18) ---------- */
CREATE TABLE viaje (
    id_viaje           INT IDENTITY(1,1) PRIMARY KEY,
    id_ruta            INT NOT NULL REFERENCES ruta(id_ruta),
    id_bus             INT NOT NULL REFERENCES bus(id_bus),
    fecha_salida       DATE NOT NULL,
    hora_salida        TIME(0) NOT NULL,
    fecha_llegada      DATE NOT NULL,
    hora_llegada       TIME(0) NOT NULL,
    precio             DECIMAL(10,2) NOT NULL,
    estado             VARCHAR(20) NOT NULL DEFAULT 'Programado'
        CHECK (estado IN ('Programado','Embarcando','Proximo a salir','Salido','Retrasado','Cancelado','Finalizado')),
    hora_real_embarque DATETIME2(0) NULL,
    hora_real_salida   DATETIME2(0) NULL,
    hora_real_llegada  DATETIME2(0) NULL,
    traslado_vacio     BIT NOT NULL DEFAULT 0,     -- se autorizó mover el bus vacío hasta el origen
    fecha_creacion     DATETIME2(0) NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2),
    -- Columnas calculadas (fecha + hora) para validar cruces de horario
    salida_dt  AS (CAST(fecha_salida AS DATETIME) + CAST(hora_salida AS DATETIME)),
    llegada_dt AS (CAST(fecha_llegada AS DATETIME) + CAST(hora_llegada AS DATETIME)),
    -- Llegada efectiva: la real si ya se registró; si no, la programada
    llegada_efectiva AS (COALESCE(CAST(hora_real_llegada AS DATETIME),
                                  CAST(fecha_llegada AS DATETIME) + CAST(hora_llegada AS DATETIME)))
);
CREATE INDEX ix_viaje_busqueda ON viaje (id_ruta, fecha_salida, estado);
CREATE INDEX ix_viaje_bus ON viaje (id_bus, fecha_salida);

/* ---------- VIAJE_CONDUCTOR: titular y relevos de cada viaje ---------- */
CREATE TABLE viaje_conductor (
    id_viaje       INT NOT NULL REFERENCES viaje(id_viaje) ON DELETE CASCADE,
    id_conductor   INT NOT NULL REFERENCES conductor(id_conductor),
    rol            VARCHAR(10) NOT NULL CHECK (rol IN ('TITULAR','RELEVO')),
    CONSTRAINT pk_viaje_conductor PRIMARY KEY (id_viaje, id_conductor)
);
CREATE INDEX ix_viaje_conductor_conductor ON viaje_conductor (id_conductor);
/* Un solo titular por viaje */
CREATE UNIQUE INDEX uq_viaje_titular ON viaje_conductor (id_viaje) WHERE rol = 'TITULAR';

/* ---------- USUARIO (RF1, RF2, RF3) ---------- */
CREATE TABLE usuario (
    id_usuario       INT IDENTITY(1,1) PRIMARY KEY,
    nombres          VARCHAR(100) NOT NULL,
    apellidos        VARCHAR(100) NOT NULL,
    dni              VARCHAR(8)   NOT NULL UNIQUE,
    correo           VARCHAR(100) NOT NULL UNIQUE,
    telefono         VARCHAR(20)  NULL,
    fecha_nacimiento DATE NULL,
    password         VARCHAR(255) NOT NULL,           -- hash scrypt (nunca texto plano)
    rol              VARCHAR(20)  NOT NULL DEFAULT 'CLIENTE'
        CHECK (rol IN ('ADMIN','EMPRESA','VENDEDOR','CLIENTE')),
    id_empresa       INT NULL REFERENCES empresa(id_empresa),  -- empresa a la que pertenece (EMPRESA / VENDEDOR)
    estado           BIT NOT NULL DEFAULT 1,
    fecha_registro   DATETIME2(0) NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2),
    CONSTRAINT ck_usuario_empresa CHECK (
        (rol = 'EMPRESA' AND id_empresa IS NOT NULL) OR
        (rol IN ('ADMIN','CLIENTE') AND id_empresa IS NULL) OR
        (rol = 'VENDEDOR'))
);

/* ---------- MODIFICACIONES / REPROGRAMACIONES DE VIAJE (RF15, RF16) ---------- */
CREATE TABLE viaje_modificacion (
    id_modificacion  INT IDENTITY(1,1) PRIMARY KEY,
    id_viaje         INT NOT NULL REFERENCES viaje(id_viaje),
    id_usuario       INT NULL REFERENCES usuario(id_usuario),
    tipo             VARCHAR(30) NOT NULL,           -- REPROGRAMACION, ESTADO, EDICION
    valor_anterior   VARCHAR(200) NULL,
    valor_nuevo      VARCHAR(200) NULL,
    motivo           VARCHAR(300) NOT NULL,
    fecha            DATETIME2(0) NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2)
);

/* ---------- PASAJERO (RF4) ---------- */
CREATE TABLE pasajero (
    id_pasajero      INT IDENTITY(1,1) PRIMARY KEY,
    nombres          VARCHAR(100) NOT NULL,
    apellidos        VARCHAR(100) NOT NULL,
    dni              VARCHAR(8)   NOT NULL UNIQUE,
    telefono         VARCHAR(20)  NULL,
    fecha_nacimiento DATE NULL,
    id_usuario       INT NULL REFERENCES usuario(id_usuario)   -- si el pasajero tiene cuenta
);

/* ---------- RESERVA ---------- */
CREATE TABLE reserva (
    id_reserva     INT IDENTITY(1,1) PRIMARY KEY,
    id_usuario     INT NOT NULL REFERENCES usuario(id_usuario),
    id_viaje       INT NOT NULL REFERENCES viaje(id_viaje),
    fecha_reserva  DATETIME2(0) NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2),
    expira_en      DATETIME2(0) NULL,             -- bloqueo temporal de asientos
    estado         VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
        CHECK (estado IN ('Pendiente','Confirmada','Cancelada','Expirada','Reubicada')),
    total          DECIMAL(10,2) NOT NULL DEFAULT 0,
    -- Por qué se canceló: CLIENTE (la anuló el comprador o la ventanilla) o VIAJE (la empresa canceló el viaje)
    motivo_cancelacion VARCHAR(20) NULL CHECK (motivo_cancelacion IN ('CLIENTE','VIAJE')),
    fecha_cancelacion  DATETIME2(0) NULL,
    -- Si esta reserva viene de una reubicación, la reserva original
    id_reserva_origen  INT NULL REFERENCES reserva(id_reserva)
);

/* ---------- RESERVA_ASIENTO ---------- */
CREATE TABLE reserva_asiento (
    id_reserva_asiento INT IDENTITY(1,1) PRIMARY KEY,
    id_reserva         INT NOT NULL REFERENCES reserva(id_reserva),
    id_asiento         INT NOT NULL REFERENCES asiento(id_asiento),
    id_viaje           INT NOT NULL REFERENCES viaje(id_viaje),
    id_pasajero        INT NOT NULL REFERENCES pasajero(id_pasajero),
    precio             DECIMAL(10,2) NOT NULL,
    activo             BIT NOT NULL DEFAULT 1       -- 0 cuando la reserva se cancela/expira
);
/* Índices de rendimiento para reservas, pagos y boletos (consultas más frecuentes) */
CREATE INDEX ix_reserva_viaje   ON reserva (id_viaje, estado);
CREATE INDEX ix_reserva_usuario ON reserva (id_usuario);
/* Reservas pendientes por vencer: lo usa la liberación automática de asientos */
CREATE INDEX ix_reserva_pendiente ON reserva (expira_en) WHERE estado = 'Pendiente';

/* RF23: evita a nivel de base de datos que un asiento se venda/reserve dos veces en el mismo viaje */
CREATE UNIQUE INDEX uq_asiento_viaje_activo
    ON reserva_asiento (id_viaje, id_asiento)
    WHERE activo = 1;
CREATE INDEX ix_reserva_asiento_reserva ON reserva_asiento (id_reserva) INCLUDE (id_asiento, activo);

/* ---------- PAGO ---------- */
CREATE TABLE pago (
    id_pago        INT IDENTITY(1,1) PRIMARY KEY,
    id_reserva     INT NOT NULL REFERENCES reserva(id_reserva),
    fecha_pago     DATETIME2(0) NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2),
    monto          DECIMAL(10,2) NOT NULL,
    metodo_pago    VARCHAR(30) NOT NULL,           -- TARJETA, YAPE, PLIN, EFECTIVO
    estado         VARCHAR(20) NOT NULL CHECK (estado IN ('Pagado','Pendiente','Rechazado','Reembolsado')),
    codigo         VARCHAR(100) NULL
);
CREATE INDEX ix_pago_reserva ON pago (id_reserva);

/* ---------- BOLETO (RF24) ---------- */
CREATE TABLE boleto (
    id_boleto          INT IDENTITY(1,1) PRIMARY KEY,
    id_reserva         INT NOT NULL REFERENCES reserva(id_reserva),
    id_reserva_asiento INT NOT NULL REFERENCES reserva_asiento(id_reserva_asiento),
    codigo_boleto      VARCHAR(50) NOT NULL UNIQUE,
    fecha_emision      DATETIME2(0) NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2),
    estado             VARCHAR(20) NOT NULL DEFAULT 'Vigente'
        CHECK (estado IN ('Vigente','Utilizado','Anulado'))
);
CREATE INDEX ix_boleto_reserva ON boleto (id_reserva);

/* ---------- REEMBOLSO: devolución del pago de una reserva cancelada ---------- */
CREATE TABLE reembolso (
    id_reembolso     INT IDENTITY(1,1) PRIMARY KEY,
    id_reserva       INT NOT NULL REFERENCES reserva(id_reserva),
    id_pago          INT NULL REFERENCES pago(id_pago),
    monto_pagado     DECIMAL(10,2) NOT NULL,
    penalidad        DECIMAL(10,2) NOT NULL DEFAULT 0,
    monto            DECIMAL(10,2) NOT NULL,            -- lo que se devuelve
    motivo           VARCHAR(300) NOT NULL,
    -- Pendiente: el pasajero aún elige entre devolución o reubicación (viaje cancelado)
    -- Procesado: dinero devuelto · Anulado: no corresponde (el pasajero fue reubicado)
    estado           VARCHAR(20) NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Procesado','Anulado')),
    codigo           VARCHAR(50) NULL,                  -- código de operación de la pasarela
    fecha_solicitud  DATETIME2(0) NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2),
    fecha_proceso    DATETIME2(0) NULL,
    id_usuario       INT NULL REFERENCES usuario(id_usuario)   -- quién lo procesó
);
/* Una reserva tiene como máximo un reembolso vigente */
CREATE UNIQUE INDEX uq_reembolso_reserva ON reembolso (id_reserva) WHERE estado <> 'Anulado';

/* ---------- NOTIFICACION: avisos al comprador y a los pasajeros ---------- */
CREATE TABLE notificacion (
    id_notificacion  INT IDENTITY(1,1) PRIMARY KEY,
    id_usuario       INT NULL REFERENCES usuario(id_usuario),   -- se muestra en su perfil
    id_reserva       INT NULL REFERENCES reserva(id_reserva),
    canal            VARCHAR(10) NOT NULL CHECK (canal IN ('APP','EMAIL','SMS')),
    destino          VARCHAR(100) NULL,                         -- correo o teléfono
    asunto           NVARCHAR(150) NOT NULL,             -- NVARCHAR: admite símbolos como →
    mensaje          NVARCHAR(1000) NOT NULL,
    estado           VARCHAR(20) NOT NULL DEFAULT 'Simulado',   -- Simulado hasta integrar un proveedor real
    leida            BIT NOT NULL DEFAULT 0,
    fecha            DATETIME2(0) NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2)
);
CREATE INDEX ix_notificacion_usuario ON notificacion (id_usuario, leida);

/* ---------- PARAMETRO: reglas configurables del sistema ---------- */
CREATE TABLE parametro (
    clave          VARCHAR(50) PRIMARY KEY,
    valor          DECIMAL(10,2) NOT NULL,
    descripcion    VARCHAR(300) NOT NULL
);
INSERT INTO parametro (clave, valor, descripcion) VALUES
('horas_descanso_conductor', 8,  'Horas mínimas de descanso del conductor entre la llegada de un viaje y la salida del siguiente'),
('max_horas_conduccion',     10, 'Máximo de horas de conducción por conductor en un viaje (define cuántos relevos se necesitan)'),
('margen_bus_minutos',       60, 'Minutos mínimos entre la llegada de un bus y su siguiente salida (limpieza, revisión)'),
('penalidad_anulacion_pct',  10, 'Porcentaje que se retiene cuando el pasajero anula su pasaje (si la empresa cancela el viaje se devuelve el 100 %)');

/* ---------- SUSCRIPTOR (newsletter de la página de inicio) ---------- */
CREATE TABLE suscriptor (
    id_suscriptor  INT IDENTITY(1,1) PRIMARY KEY,
    correo         VARCHAR(100) NOT NULL UNIQUE,
    fecha          DATETIME2(0) NOT NULL DEFAULT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2)
);
GO

/* =====================================================================
   Procedimiento: genera la distribución de asientos de un bus (RF6)
   @por_fila = 3 -> distribución 2-1 (Cama)   | 4 -> distribución 2-2
   ===================================================================== */
CREATE OR ALTER PROCEDURE sp_generar_asientos
    @id_bus   INT,
    @filas    INT,
    @por_fila INT = 4,
    @pisos    INT = 1
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM reserva_asiento ra JOIN asiento a ON a.id_asiento = ra.id_asiento WHERE a.id_bus = @id_bus)
    BEGIN
        RAISERROR('El bus ya tiene asientos vendidos; no se puede regenerar su distribución.', 16, 1);
        RETURN;
    END

    DELETE FROM asiento WHERE id_bus = @id_bus;

    DECLARE @piso INT = 1, @fila INT, @filaGlobal INT = 0;
    WHILE @piso <= @pisos
    BEGIN
        SET @fila = 1;
        WHILE @fila <= @filas
        BEGIN
            SET @filaGlobal += 1;
            -- Lado izquierdo (A, B)
            INSERT INTO asiento (id_bus, numero, piso, fila, columna)
            VALUES (@id_bus, CONCAT(@filaGlobal, 'A'), @piso, @fila, 1),
                   (@id_bus, CONCAT(@filaGlobal, 'B'), @piso, @fila, 2);
            -- Lado derecho (C) o (C, D)
            IF @por_fila = 3
                INSERT INTO asiento (id_bus, numero, piso, fila, columna)
                VALUES (@id_bus, CONCAT(@filaGlobal, 'C'), @piso, @fila, 5);
            ELSE
                INSERT INTO asiento (id_bus, numero, piso, fila, columna)
                VALUES (@id_bus, CONCAT(@filaGlobal, 'C'), @piso, @fila, 4),
                       (@id_bus, CONCAT(@filaGlobal, 'D'), @piso, @fila, 5);
            SET @fila += 1;
        END
        SET @piso += 1;
    END

    UPDATE bus
       SET capacidad = (SELECT COUNT(*) FROM asiento WHERE id_bus = @id_bus),
           pisos = @pisos
     WHERE id_bus = @id_bus;
END
GO
