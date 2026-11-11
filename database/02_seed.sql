/* =====================================================================
   BusGlow - Script 02: Datos de prueba
   Genera ciudades, terminales, empresas, buses (con asientos),
   conductores, rutas, horarios, usuarios y viajes desde hace 7 días
   hasta dentro de 30 días (servicios de ida y vuelta) (relativo a la fecha actual del servidor),
   además de ventas de ejemplo para que los reportes tengan datos.

   Usuarios de prueba:
     admin@busglow.pe              / Admin123!    (ADMIN de la plataforma)
     operaciones@cruzdelsur.demo   / Empresa123   (EMPRESA: Cruz del Sur)
     operaciones@movilbus.demo     / Empresa123   (EMPRESA: Movil Bus)
     ventas@busglow.pe             / Vendedor123  (VENDEDOR de todas las empresas)
     ventas@cruzdelsur.demo        / Vendedor123  (VENDEDOR solo de Cruz del Sur)
     juan.perez@email.com          / Cliente123   (CLIENTE)
   ===================================================================== */
USE BusGlowDB;
GO
SET NOCOUNT ON;

/* ---------- CIUDADES ---------- */
INSERT INTO ciudad (nombre, departamento) VALUES
('Lima','Lima'), ('Arequipa','Arequipa'), ('Cusco','Cusco'), ('Trujillo','La Libertad'),
('Ica','Ica'), ('Chiclayo','Lambayeque'), ('Huaraz','Áncash'), ('Puno','Puno');

/* ---------- TERMINALES ---------- */
INSERT INTO terminal (id_ciudad, nombre, direccion)
SELECT id_ciudad, t.nombre, t.direccion FROM ciudad c
JOIN (VALUES
 ('Lima','Terminal Plaza Norte','Av. Túpac Amaru 1300, Independencia'),
 ('Lima','Terminal Javier Prado','Av. Javier Prado Este 1155, La Victoria'),
 ('Arequipa','Terminal Terrestre de Arequipa','Av. Andrés Avelino Cáceres s/n'),
 ('Cusco','Terminal Terrestre Cusco','Av. Vallejo Santoni s/n, Santiago'),
 ('Trujillo','Terminal Trujillo','Av. América Sur 2857'),
 ('Ica','Terminal Ica','Calle Lambayeque 180'),
 ('Chiclayo','Terminal Chiclayo','Av. Bolognesi 751'),
 ('Huaraz','Terminal Huaraz','Jr. Simón Bolívar 452'),
 ('Puno','Terminal Terrestre Puno','Jr. Primero de Mayo 703')
) t(ciudad, nombre, direccion) ON t.ciudad = c.nombre;

/* ---------- EMPRESAS (datos ficticios de ejemplo) ---------- */
INSERT INTO empresa (razon_social, ruc, telefono, correo, direccion) VALUES
('Cruz del Sur',     '20100000001', '01 311 5050', 'contacto@cruzdelsur.demo',  'Av. Javier Prado Este 1109, Lima'),
('Oltursa',          '20100000002', '01 708 5000', 'contacto@oltursa.demo',     'Av. Aramburú 1160, Lima'),
('Movil Bus',        '20100000003', '01 716 8000', 'contacto@movilbus.demo',    'Av. Paseo de la República 749, Lima'),
('BusGlow Express',  '20100000004', '01 555 0000', 'operaciones@busglow.pe',    'Av. Arequipa 1234, Lima');

/* ---------- RUTAS ---------- */
DECLARE @rutas TABLE (o VARCHAR(50), d VARCHAR(50), km DECIMAL(10,2), minutos INT);
INSERT INTO @rutas VALUES
('Lima','Arequipa',1010,960), ('Arequipa','Lima',1010,960),
('Lima','Cusco',1100,1260),   ('Cusco','Lima',1100,1260),
('Lima','Trujillo',560,540),  ('Trujillo','Lima',560,540),
('Lima','Ica',300,270),       ('Ica','Lima',300,270),
('Lima','Chiclayo',770,720),  ('Chiclayo','Lima',770,720),
('Lima','Huaraz',400,480),    ('Huaraz','Lima',400,480),
('Cusco','Puno',390,420),     ('Puno','Cusco',390,420),
('Arequipa','Cusco',500,600), ('Cusco','Arequipa',500,600),
('Arequipa','Puno',300,360),  ('Puno','Arequipa',300,360);

INSERT INTO ruta (ciudad_origen, ciudad_destino, terminal_origen, terminal_destino, distancia_km, duracion_estimada, duracion_minutos)
SELECT co.id_ciudad, cd.id_ciudad,
       (SELECT MIN(id_terminal) FROM terminal WHERE id_ciudad = co.id_ciudad),
       (SELECT MIN(id_terminal) FROM terminal WHERE id_ciudad = cd.id_ciudad),
       r.km,
       CONCAT(r.minutos / 60, 'h', CASE WHEN r.minutos % 60 > 0 THEN CONCAT(' ', r.minutos % 60, 'min') ELSE '' END),
       r.minutos
FROM @rutas r
JOIN ciudad co ON co.nombre = r.o
JOIN ciudad cd ON cd.nombre = r.d;

/* =====================================================================
   SERVICIOS DE IDA Y VUELTA
   Cada servicio tiene un horario de ida (A -> B) y uno de vuelta (B -> A).
   Para que los datos respeten las reglas del sistema:
     - Los buses rotan: el bus que hace la ida regresa con la vuelta, y se
       crean tantos buses como días dure el ciclo (cadena de ubicación).
     - Cada viaje lleva 1 conductor por cada 10 h de conducción (relevos).
     - Cada tripulación descansa al menos 8 h entre un viaje y el siguiente.
   ===================================================================== */
DECLARE @serv TABLE (n INT IDENTITY(1,1), empresa VARCHAR(150), o VARCHAR(50), d VARCHAR(50),
                     hora_ida VARCHAR(5), hora_vuelta VARCHAR(5), precio DECIMAL(10,2), servicio VARCHAR(50));
INSERT INTO @serv (empresa, o, d, hora_ida, hora_vuelta, precio, servicio) VALUES
('Cruz del Sur',    'Lima','Cusco',    '08:00','14:00', 85,'Cama'),
('Oltursa',         'Lima','Cusco',    '09:30','16:00', 75,'Semicama'),
('Movil Bus',       'Lima','Cusco',    '21:00','19:00', 90,'Cama'),
('BusGlow Express', 'Lima','Arequipa', '20:00','19:30', 95,'VIP'),
('Cruz del Sur',    'Lima','Arequipa', '08:30','18:30', 75,'Ejecutivo'),
('Oltursa',         'Lima','Arequipa', '15:00','16:00', 60,'Semicama'),
('Movil Bus',       'Lima','Trujillo', '22:00','21:30', 55,'Cama'),
('Oltursa',         'Lima','Trujillo', '10:00','10:00', 45,'Semicama'),
('BusGlow Express', 'Lima','Ica',      '07:00','15:00', 30,'Económico'),
('Cruz del Sur',    'Lima','Ica',      '13:00','19:30', 40,'Ejecutivo'),
('Movil Bus',       'Lima','Chiclayo', '19:00','20:00', 70,'Cama'),
('Movil Bus',       'Lima','Huaraz',   '22:30','22:00', 50,'Semicama'),
('BusGlow Express', 'Cusco','Puno',    '07:30','08:00', 45,'Ejecutivo'),
('Cruz del Sur',    'Cusco','Puno',    '22:00','13:00', 55,'Cama'),
('Cruz del Sur',    'Arequipa','Cusco','20:30','20:30', 65,'Cama'),
('BusGlow Express', 'Arequipa','Puno', '09:00','16:30', 35,'Económico');

DECLARE @nombres TABLE (n INT IDENTITY(0,1), nom VARCHAR(50));
INSERT INTO @nombres (nom) VALUES ('Luis'),('Jorge'),('Pedro'),('Raúl'),('César'),('Víctor'),('Miguel'),('Óscar'),
    ('Julio'),('Walter'),('Hugo'),('Mario'),('Carlos'),('Andrés'),('Fernando'),('Ricardo'),('Alberto'),('Edwin');
DECLARE @apellidos TABLE (n INT IDENTITY(0,1), ape VARCHAR(50));
INSERT INTO @apellidos (ape) VALUES ('Quispe Mamani'),('Huamán Rojas'),('Flores Castillo'),('Condori Díaz'),('Ramos Torres'),
    ('Chávez Vargas'),('Sánchez Ríos'),('Mendoza Cruz'),('Gutiérrez Paredes'),('Espinoza Soto'),('Cárdenas León'),
    ('Salazar Vega'),('Medina Ruiz'),('Zapata Luna'),('Aguilar Ponce'),('Romero Silva'),('Apaza Choque'),('Ccama Yupanqui');

DECLARE @dias TABLE (d INT);
DECLARE @x INT = -10;
WHILE @x <= 30 BEGIN INSERT INTO @dias VALUES (@x); SET @x += 1; END

DECLARE @hoy DATE = CAST(CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2) AS DATE);
DECLARE @buses   TABLE (k INT, id_bus INT);
DECLARE @crew    TABLE (dir CHAR(1), j INT, pos INT, id_conductor INT);
DECLARE @nuevos  TABLE (id_viaje INT, fecha DATE);

DECLARE @n INT = 1, @total INT = (SELECT COUNT(*) FROM @serv), @cnt INT = 0;
DECLARE @id_emp INT, @ri INT, @rv INT, @dur INT, @hi TIME(0), @hv TIME(0), @precio DECIMAL(10,2), @tipo VARCHAR(50);
DECLARE @mi INT, @mv INT, @off INT, @ciclo INT, @relevos INT, @pool INT, @k INT, @j INT, @p INT, @id INT;
DECLARE @dir CHAR(1);

WHILE @n <= @total
BEGIN
    SELECT @id_emp = e.id_empresa, @hi = CAST(s.hora_ida AS TIME(0)), @hv = CAST(s.hora_vuelta AS TIME(0)),
           @precio = s.precio, @tipo = s.servicio,
           @ri = (SELECT r.id_ruta FROM ruta r JOIN ciudad a ON a.id_ciudad = r.ciudad_origen JOIN ciudad b ON b.id_ciudad = r.ciudad_destino
                   WHERE a.nombre = s.o AND b.nombre = s.d),
           @rv = (SELECT r.id_ruta FROM ruta r JOIN ciudad a ON a.id_ciudad = r.ciudad_origen JOIN ciudad b ON b.id_ciudad = r.ciudad_destino
                   WHERE a.nombre = s.d AND b.nombre = s.o)
      FROM @serv s JOIN empresa e ON e.razon_social = s.empresa
     WHERE s.n = @n;
    SELECT @dur = duracion_minutos FROM ruta WHERE id_ruta = @ri;

    INSERT INTO horario (id_ruta, id_empresa, hora_salida, hora_llegada, precio_base) VALUES
        (@ri, @id_emp, @hi, DATEADD(MINUTE, @dur, @hi), @precio),
        (@rv, @id_emp, @hv, DATEADD(MINUTE, @dur, @hv), @precio);

    -- Días entre la ida y la vuelta, y duración del ciclo del bus (60 min de margen + 30 de holgura por retrasos)
    SET @mi = DATEDIFF(MINUTE, '00:00', @hi);
    SET @mv = DATEDIFF(MINUTE, '00:00', @hv);
    SET @off = CEILING((@mi + @dur + 90 - @mv) / 1440.0);
    IF @off < 0 SET @off = 0;
    SET @ciclo = CEILING((@off * 1440 + @mv + @dur + 90 - @mi) / 1440.0);
    -- Conductores por viaje (máx. 10 h cada uno) y tripulaciones necesarias para descansar 8 h
    SET @relevos = CEILING(@dur / 600.0);
    SET @pool = CEILING((@dur + 480 + 30) / 1440.0);

    -- Buses del servicio
    DELETE FROM @buses;
    SET @k = 0;
    WHILE @k < @ciclo
    BEGIN
        INSERT INTO bus (id_empresa, placa, modelo, tipo_servicio)
        VALUES (@id_emp, CONCAT(CHAR(65 + (@n % 26)), CHAR(65 + (@k * 3 + @n) % 26), CHAR(48 + @k), '-', RIGHT(CONCAT('00', @n * 37 % 1000), 3)),
                CASE WHEN (@n + @k) % 2 = 0 THEN 'Marcopolo Paradiso G7' ELSE 'Scania Irizar i8' END, @tipo);
        SET @id = SCOPE_IDENTITY();
        IF @tipo IN ('Cama','VIP')
            EXEC sp_generar_asientos @id_bus = @id, @filas = 8, @por_fila = 3, @pisos = 1;   -- 24 asientos (2-1)
        ELSE
            EXEC sp_generar_asientos @id_bus = @id, @filas = 10, @por_fila = 4, @pisos = 1;  -- 40 asientos (2-2)
        INSERT INTO @buses VALUES (@k, @id);
        SET @k += 1;
    END

    -- Tripulaciones: @pool por sentido, cada una con @relevos conductores
    DELETE FROM @crew;
    SET @dir = 'I';
    WHILE @dir IS NOT NULL
    BEGIN
        SET @j = 0;
        WHILE @j < @pool
        BEGIN
            SET @p = 0;
            WHILE @p < @relevos
            BEGIN
                INSERT INTO conductor (id_empresa, nombres, apellidos, dni, licencia, telefono)
                SELECT @id_emp, (SELECT nom FROM @nombres WHERE n = @cnt % 18), (SELECT ape FROM @apellidos WHERE n = (@cnt * 7 + @cnt / 18) % 18),
                       CONCAT('4', RIGHT(CONCAT('0000000', 1000 + @cnt * 1373), 7)),
                       CONCAT('A-IIIc-', RIGHT(CONCAT('00000', 100 + @cnt * 311), 5)),
                       CONCAT('9', RIGHT(CONCAT('00000000', 10000000 + @cnt * 45678), 8));
                INSERT INTO @crew VALUES (@dir, @j, @p, SCOPE_IDENTITY());
                SET @cnt += 1;
                SET @p += 1;
            END
            SET @j += 1;
        END
        SET @dir = CASE @dir WHEN 'I' THEN 'V' ELSE NULL END;
    END

    -- Viajes de ida: el día d sale el bus (d mod ciclo)
    DELETE FROM @nuevos;
    INSERT INTO viaje (id_ruta, id_bus, fecha_salida, hora_salida, fecha_llegada, hora_llegada, precio, estado)
    OUTPUT INSERTED.id_viaje, INSERTED.fecha_salida INTO @nuevos
    SELECT @ri, b.id_bus, DATEADD(DAY, x.d, @hoy), @hi,
           CAST(DATEADD(MINUTE, @dur, CAST(DATEADD(DAY, x.d, @hoy) AS DATETIME) + CAST(@hi AS DATETIME)) AS DATE),
           DATEADD(MINUTE, @dur, @hi),
           CASE WHEN DATEPART(WEEKDAY, DATEADD(DAY, x.d, @hoy)) IN (1,7) THEN ROUND(@precio * 1.10, 0) ELSE @precio END,
           'Programado'
      FROM @dias x JOIN @buses b ON b.k = ((x.d % @ciclo) + @ciclo) % @ciclo;

    INSERT INTO viaje_conductor (id_viaje, id_conductor, rol)
    SELECT nv.id_viaje, c.id_conductor, CASE WHEN c.pos = 0 THEN 'TITULAR' ELSE 'RELEVO' END
      FROM @nuevos nv
      JOIN @crew c ON c.dir = 'I' AND c.j = (((DATEDIFF(DAY, @hoy, nv.fecha) % @pool) + @pool) % @pool);

    -- Viajes de vuelta: el mismo bus regresa @off días después de su ida
    DELETE FROM @nuevos;
    INSERT INTO viaje (id_ruta, id_bus, fecha_salida, hora_salida, fecha_llegada, hora_llegada, precio, estado)
    OUTPUT INSERTED.id_viaje, INSERTED.fecha_salida INTO @nuevos
    SELECT @rv, b.id_bus, DATEADD(DAY, x.d + @off, @hoy), @hv,
           CAST(DATEADD(MINUTE, @dur, CAST(DATEADD(DAY, x.d + @off, @hoy) AS DATETIME) + CAST(@hv AS DATETIME)) AS DATE),
           DATEADD(MINUTE, @dur, @hv),
           CASE WHEN DATEPART(WEEKDAY, DATEADD(DAY, x.d + @off, @hoy)) IN (1,7) THEN ROUND(@precio * 1.10, 0) ELSE @precio END,
           'Programado'
      FROM @dias x JOIN @buses b ON b.k = ((x.d % @ciclo) + @ciclo) % @ciclo;

    INSERT INTO viaje_conductor (id_viaje, id_conductor, rol)
    SELECT nv.id_viaje, c.id_conductor, CASE WHEN c.pos = 0 THEN 'TITULAR' ELSE 'RELEVO' END
      FROM @nuevos nv
      JOIN @crew c ON c.dir = 'V' AND c.j = (((DATEDIFF(DAY, @hoy, nv.fecha) % @pool) + @pool) % @pool);

    SET @n += 1;
END

/* Viajes pasados: finalizados con horas reales (retrasos aleatorios 0-25 min) */
UPDATE viaje
   SET estado = 'Finalizado',
       hora_real_embarque = DATEADD(MINUTE, -30, salida_dt),
       hora_real_salida   = DATEADD(MINUTE, ABS(CHECKSUM(NEWID())) % 26, salida_dt)
 WHERE llegada_dt < CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2);
UPDATE viaje
   SET hora_real_llegada = DATEADD(MINUTE, DATEDIFF(MINUTE, salida_dt, hora_real_salida), llegada_dt)
 WHERE estado = 'Finalizado';

/* Viajes en ruta en este momento */
UPDATE viaje
   SET estado = 'Salido',
       hora_real_embarque = DATEADD(MINUTE, -30, salida_dt),
       hora_real_salida   = DATEADD(MINUTE, ABS(CHECKSUM(NEWID())) % 15, salida_dt)
 WHERE salida_dt < CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2) AND llegada_dt >= CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2);

/* Un servicio cancelado de ejemplo (ida y vuelta Lima - Ica del mismo día, así el bus no pierde su ubicación) */
UPDATE v SET estado = 'Cancelado'
  FROM viaje v
  JOIN bus b ON b.id_bus = v.id_bus
  JOIN empresa e ON e.id_empresa = b.id_empresa
  JOIN ruta r ON r.id_ruta = v.id_ruta
  JOIN ciudad co ON co.id_ciudad = r.ciudad_origen
  JOIN ciudad cd ON cd.id_ciudad = r.ciudad_destino
 WHERE e.razon_social = 'BusGlow Express' AND v.fecha_salida = DATEADD(DAY, 12, @hoy)
   AND ((co.nombre = 'Lima' AND cd.nombre = 'Ica') OR (co.nombre = 'Ica' AND cd.nombre = 'Lima'));

/* Última ubicación de cada bus: destino de su último viaje finalizado (o el origen de su primer viaje) */
UPDATE b SET id_terminal_actual = COALESCE(
    (SELECT TOP 1 r.terminal_destino FROM viaje v JOIN ruta r ON r.id_ruta = v.id_ruta
      WHERE v.id_bus = b.id_bus AND v.estado = 'Finalizado' ORDER BY v.salida_dt DESC),
    (SELECT TOP 1 r.terminal_origen FROM viaje v JOIN ruta r ON r.id_ruta = v.id_ruta
      WHERE v.id_bus = b.id_bus ORDER BY v.salida_dt))
  FROM bus b;

/* ---------- USUARIOS (contraseñas cifradas con scrypt) ---------- */
INSERT INTO usuario (nombres, apellidos, dni, correo, telefono, fecha_nacimiento, password, rol, id_empresa) VALUES
('Administrador','BusGlow','00000001','admin@busglow.pe','+51 900 000 001',NULL,
 'scrypt$fd75d9ea0b5a858ce1864b8cfc2d54ae$48e74d811fcc9bf7d531376692f94ffe2a5811d2e6047d277433ca4284517b0c7c0ddd93fef498d8c6ae65b8d471328d2fa0490ff76b919d10be63828904b591','ADMIN', NULL),
('Ventanilla','Plaza Norte','00000002','ventas@busglow.pe','+51 900 000 002',NULL,
 'scrypt$f9b9e31d1b48fa820f69709ec8469b17$ab7419e91e57124a758522346ddc502ea0af26031de681d20da87b513165dc0d61ae857fffe8ccc29d6eb56d0433b9b2dde3a4f877ca516910c7c4412f157833','VENDEDOR', NULL),
('Juan','Pérez','12345678','juan.perez@email.com','+51 987 654 321','1998-05-15',
 'scrypt$3dfaead61b30410a67c6140544a11044$40c59a4c1f705ae3fe3ea115840ef4fed912c9ae9737a463f94957ed5168031931180da9e93cf27f6847d19671860f5d7d636b60be86e9633cfedb0778938254','CLIENTE', NULL),
('Operaciones','Cruz del Sur','00000003','operaciones@cruzdelsur.demo','+51 900 000 003',NULL,
 'scrypt$9ce9fccad2dfefb039e582e259e34f3f$c92d24fc2245da1169ff994236898f8d355b38bec3e1ef265fab8d797a771a718864ed847b333375f1906f775b2a5cb734fbc769d5663e10bd06e4e4e62f7456','EMPRESA',
 (SELECT id_empresa FROM empresa WHERE razon_social = 'Cruz del Sur')),
('Operaciones','Movil Bus','00000004','operaciones@movilbus.demo','+51 900 000 004',NULL,
 'scrypt$b49bdc38b3e1f83e30a1025477902e8b$f088b24aef3ced8b9f4fa79c5eae4d8334343256c7fb8b697a7207c4cf666cb87a035c753d575c0c888ccab9c60ca08718e1eee21f12c5984f33d024f6a51f05','EMPRESA',
 (SELECT id_empresa FROM empresa WHERE razon_social = 'Movil Bus')),
('Ventanilla','Cruz del Sur','00000005','ventas@cruzdelsur.demo','+51 900 000 005',NULL,
 'scrypt$4657d0fef6d6ef104161a336df312bc6$dbbb71f246abc425da813a9e75d239682fefbf76bdc5e7d31b498cc8981fa59154b61ce4ffb9d144389174c4a312c427c528cd32b882424aeca63d57996e4ff5','VENDEDOR',
 (SELECT id_empresa FROM empresa WHERE razon_social = 'Cruz del Sur'));

/* ---------- PASAJEROS ---------- */
INSERT INTO pasajero (nombres, apellidos, dni, telefono, id_usuario)
SELECT 'Juan','Pérez','12345678','+51 987 654 321', id_usuario FROM usuario WHERE correo = 'juan.perez@email.com';

INSERT INTO pasajero (nombres, apellidos, dni, telefono) VALUES
('María','López García','70112233','+51 911 111 111'), ('Rosa','Quispe Huamán','70223344','+51 922 222 222'),
('Carmen','Torres Vega','70334455','+51 933 333 333'), ('Ana','Rojas Díaz','70445566','+51 944 444 444'),
('José','Ramírez Soto','70556677','+51 955 555 555'), ('Diego','Castro Ruiz','70667788','+51 966 666 666'),
('Lucía','Vargas Paz','70778899','+51 977 777 777'), ('Pablo','Mendoza León','70889900','+51 988 888 888'),
('Elena','Chávez Ríos','70990011','+51 999 999 999'), ('Sofía','Herrera Luna','71001122','+51 912 345 678'),
('Mateo','Flores Cruz','71112233','+51 923 456 789'), ('Valeria','Silva Ponce','71223344','+51 934 567 890');

/* ---------- VENTAS DE EJEMPLO ---------- */
DECLARE @vendedor INT = (SELECT id_usuario FROM usuario WHERE correo = 'ventas@busglow.pe');
DECLARE @juan INT     = (SELECT id_usuario FROM usuario WHERE correo = 'juan.perez@email.com');
DECLARE @pmin INT = (SELECT MIN(id_pasajero) FROM pasajero), @pcount INT = (SELECT COUNT(*) FROM pasajero);

-- Reservas de Juan (2 pasadas + 3 próximas, una de ellas en el viaje Lima-Ica que la empresa canceló)
DECLARE @juanViajes TABLE (id_viaje INT);
INSERT INTO @juanViajes
SELECT TOP 1 v.id_viaje FROM viaje v JOIN ruta r ON r.id_ruta = v.id_ruta JOIN ciudad o ON o.id_ciudad = r.ciudad_origen JOIN ciudad d ON d.id_ciudad = r.ciudad_destino
 WHERE o.nombre = 'Lima' AND d.nombre = 'Arequipa' AND v.fecha_salida = DATEADD(DAY, -6, @hoy)
UNION ALL
SELECT TOP 1 v.id_viaje FROM viaje v JOIN ruta r ON r.id_ruta = v.id_ruta JOIN ciudad o ON o.id_ciudad = r.ciudad_origen JOIN ciudad d ON d.id_ciudad = r.ciudad_destino
 WHERE o.nombre = 'Arequipa' AND d.nombre = 'Lima' AND v.fecha_salida = DATEADD(DAY, -3, @hoy)
UNION ALL
SELECT TOP 1 v.id_viaje FROM viaje v JOIN ruta r ON r.id_ruta = v.id_ruta JOIN ciudad o ON o.id_ciudad = r.ciudad_origen JOIN ciudad d ON d.id_ciudad = r.ciudad_destino
 WHERE o.nombre = 'Lima' AND d.nombre = 'Cusco' AND v.fecha_salida = DATEADD(DAY, 5, @hoy)
UNION ALL
SELECT TOP 1 v.id_viaje FROM viaje v JOIN ruta r ON r.id_ruta = v.id_ruta JOIN ciudad o ON o.id_ciudad = r.ciudad_origen JOIN ciudad d ON d.id_ciudad = r.ciudad_destino
 WHERE o.nombre = 'Cusco' AND d.nombre = 'Arequipa' AND v.fecha_salida = DATEADD(DAY, 10, @hoy)
UNION ALL
SELECT TOP 1 v.id_viaje FROM viaje v JOIN ruta r ON r.id_ruta = v.id_ruta JOIN ciudad o ON o.id_ciudad = r.ciudad_origen JOIN ciudad d ON d.id_ciudad = r.ciudad_destino
 WHERE o.nombre = 'Lima' AND d.nombre = 'Ica' AND v.fecha_salida = DATEADD(DAY, 12, @hoy) AND v.estado = 'Cancelado';

INSERT INTO reserva (id_usuario, id_viaje, fecha_reserva, estado, total)
SELECT @juan, v.id_viaje, CASE WHEN DATEADD(DAY, -3, v.salida_dt) > CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2) THEN DATEADD(DAY, -1, CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2)) ELSE DATEADD(DAY, -3, v.salida_dt) END, 'Confirmada', v.precio
FROM viaje v JOIN @juanViajes j ON j.id_viaje = v.id_viaje;

INSERT INTO reserva_asiento (id_reserva, id_asiento, id_viaje, id_pasajero, precio)
SELECT r.id_reserva,
       (SELECT id_asiento FROM asiento WHERE id_bus = v.id_bus AND numero = '4A'),
       v.id_viaje, @pmin, v.precio
FROM reserva r JOIN viaje v ON v.id_viaje = r.id_viaje
WHERE r.id_usuario = @juan;

-- Ventas de ventanilla: ~35 % de ocupación aleatoria en cada viaje
-- (los del viaje cancelado se procesan al final como pasajeros afectados)
INSERT INTO reserva (id_usuario, id_viaje, fecha_reserva, estado, total)
SELECT @vendedor, v.id_viaje,
       CASE WHEN DATEADD(DAY, -2, v.salida_dt) > CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2) THEN CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2) ELSE DATEADD(DAY, -2, v.salida_dt) END,
       'Confirmada', 0
FROM viaje v;

INSERT INTO reserva_asiento (id_reserva, id_asiento, id_viaje, id_pasajero, precio)
SELECT r.id_reserva, a.id_asiento, v.id_viaje,
       @pmin + 1 + ((a.id_asiento * 7 + v.id_viaje) % (@pcount - 1)),
       v.precio
FROM reserva r
JOIN viaje v   ON v.id_viaje = r.id_viaje
JOIN asiento a ON a.id_bus = v.id_bus
WHERE r.id_usuario = @vendedor
  AND a.numero <> '4A'
  AND ABS(CHECKSUM(NEWID())) % 100 < 35;

DELETE r FROM reserva r WHERE NOT EXISTS (SELECT 1 FROM reserva_asiento ra WHERE ra.id_reserva = r.id_reserva);

UPDATE r SET total = x.total
FROM reserva r
JOIN (SELECT id_reserva, SUM(precio) total FROM reserva_asiento GROUP BY id_reserva) x ON x.id_reserva = r.id_reserva;

INSERT INTO pago (id_reserva, fecha_pago, monto, metodo_pago, estado, codigo)
SELECT id_reserva, fecha_reserva, total,
       CASE WHEN id_usuario = @vendedor THEN 'EFECTIVO' ELSE 'TARJETA' END,
       'Pagado', CONCAT('OP-SEED-', id_reserva)
FROM reserva;

INSERT INTO boleto (id_reserva, id_reserva_asiento, codigo_boleto, fecha_emision, estado)
SELECT ra.id_reserva, ra.id_reserva_asiento,
       CONCAT('BGS-', RIGHT(CONCAT('00000000', ra.id_reserva_asiento), 8)),
       r.fecha_reserva,
       CASE WHEN v.estado = 'Finalizado' THEN 'Utilizado' ELSE 'Vigente' END
FROM reserva_asiento ra
JOIN reserva r ON r.id_reserva = ra.id_reserva
JOIN viaje v ON v.id_viaje = ra.id_viaje;

INSERT INTO viaje_modificacion (id_viaje, id_usuario, tipo, valor_anterior, valor_nuevo, motivo)
SELECT id_viaje, (SELECT id_usuario FROM usuario WHERE correo = 'admin@busglow.pe'),
       'ESTADO', 'Programado', 'Cancelado', 'Falla mecánica del bus asignado (dato de ejemplo)'
FROM viaje WHERE estado = 'Cancelado';

/* ---------- Viaje cancelado: pasajeros afectados ----------
   Igual que hace el sistema al cancelar: reservas canceladas por VIAJE, asientos liberados,
   boletos anulados, reembolso Pendiente (el pasajero elige devolución o reubicación) y aviso. */
UPDATE r SET estado = 'Cancelada', motivo_cancelacion = 'VIAJE', fecha_cancelacion = CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATETIME2)
  FROM reserva r JOIN viaje v ON v.id_viaje = r.id_viaje
 WHERE v.estado = 'Cancelado' AND r.estado = 'Confirmada';

UPDATE ra SET activo = 0
  FROM reserva_asiento ra JOIN viaje v ON v.id_viaje = ra.id_viaje
 WHERE v.estado = 'Cancelado';

UPDATE bo SET estado = 'Anulado'
  FROM boleto bo JOIN reserva r ON r.id_reserva = bo.id_reserva JOIN viaje v ON v.id_viaje = r.id_viaje
 WHERE v.estado = 'Cancelado';

INSERT INTO reembolso (id_reserva, id_pago, monto_pagado, penalidad, monto, motivo, estado, fecha_solicitud)
SELECT r.id_reserva, p.id_pago, p.monto, 0, p.monto,
       'Viaje cancelado por la empresa: falla mecánica del bus asignado', 'Pendiente', r.fecha_cancelacion
  FROM reserva r JOIN pago p ON p.id_reserva = r.id_reserva AND p.estado = 'Pagado'
 WHERE r.motivo_cancelacion = 'VIAJE';

INSERT INTO notificacion (id_usuario, id_reserva, canal, destino, asunto, mensaje, fecha)
SELECT r.id_usuario, r.id_reserva, x.canal, CASE x.canal WHEN 'EMAIL' THEN u.correo END,
       CONCAT(N'Tu viaje ', co.nombre, N' → ', cd.nombre, N' fue cancelado'),
       CONCAT(N'La empresa ', e.razon_social, N' canceló el viaje del ', CONVERT(VARCHAR(10), v.fecha_salida, 103), N' a las ',
              CONVERT(VARCHAR(5), v.hora_salida, 108), N' (falla mecánica del bus asignado). Tus boletos fueron anulados. ',
              N'Puedes pedir la devolución del 100 % (S/ ', CAST(r.total AS VARCHAR(20)), N') desde "Mis viajes" o acercarte a ventanilla para cambiarte a otro viaje sin costo.'),
       r.fecha_cancelacion
  FROM reserva r
  JOIN usuario u ON u.id_usuario = r.id_usuario AND u.rol = 'CLIENTE'
  JOIN viaje v   ON v.id_viaje = r.id_viaje
  JOIN ruta ru   ON ru.id_ruta = v.id_ruta
  JOIN ciudad co ON co.id_ciudad = ru.ciudad_origen
  JOIN ciudad cd ON cd.id_ciudad = ru.ciudad_destino
  JOIN bus b     ON b.id_bus = v.id_bus
  JOIN empresa e ON e.id_empresa = b.id_empresa
 CROSS JOIN (VALUES ('APP'), ('EMAIL')) x(canal)
 WHERE r.motivo_cancelacion = 'VIAJE';

PRINT 'Datos de prueba cargados correctamente.';
GO
