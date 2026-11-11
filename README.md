# BusGlow — Sistema de gestión y venta de pasajes interprovinciales

Aplicación web completa con **arquitectura MVC (Modelo – Vista – Controlador)**: Node.js + Express, API REST con JWT y base de datos **SQL Server**.

```
busglow/
├── package.json · .env.example
├── database/
│   ├── 01_schema.sql          Tablas, índices y procedimiento sp_generar_asientos
│   └── 02_seed.sql            Datos de prueba (ciudades, empresas, buses, viajes, ventas…)
├── scripts/                   init-db.js (crea la BD) · test-connection.js
└── src/
    ├── server.js              Inicia el servidor y las tareas programadas
    ├── app.js                 Configura Express: API, vistas y manejo de errores
    ├── models/                MODELO: datos y reglas de negocio
    │   ├── ViajeModel.js        búsqueda, asientos, programación, cruces, ubicación, relevos, alertas
    │   ├── ReservaModel.js      reserva con bloqueo temporal, pago, cancelación, boletos
    │   ├── PagoModel.js         pasarela de pagos (simulada)
    │   ├── UsuarioModel.js · PasajeroModel.js · CiudadModel.js
    │   ├── CatalogoModel.js     catálogos con permisos por rol y filtro por empresa
    │   ├── ParametroModel.js    descanso, horas de conducción, margen del bus y penalidad
    │   ├── ReembolsoModel.js    cancelaciones, reembolsos y cambio de viaje
    │   ├── NotificacionModel.js avisos al comprador y a los pasajeros (simulados)
    │   └── ReporteModel.js      ventas, ocupación, puntualidad
    ├── views/                 VISTA: páginas HTML (index, resultados, asientos, pago, boleto,
    │                                 login, registro, perfil, nosotros, admin)
    ├── public/js/api.js       Script que usan las vistas para llamar a la API
    ├── controllers/           CONTROLADOR: reciben la petición, validan y llaman al modelo
    │   ├── authController.js · viajeController.js · reservaController.js
    │   ├── programacionController.js · catalogoController.js · reporteController.js
    │   └── posventaController.js (reembolsos y cambio de viaje)
    ├── routes/                URL de la API → controlador (index, auth, viaje, reserva, admin)
    ├── middleware/auth.js     Verificación del token JWT, roles y permisos
    ├── config/db.js           Conexión a SQL Server (mssql)
    └── utils/                 http.js (validaciones, errores) · security.js (scrypt, JWT)
```

### Cómo fluye una petición (MVC)

1. La **vista** (página HTML) llama a la API, por ejemplo `POST /api/reservas`.
2. La **ruta** (`routes/reserva.routes.js`) aplica el middleware de sesión y llama al **controlador**.
3. El **controlador** (`reservaController.crear`) valida los datos y llama al **modelo**.
4. El **modelo** (`ReservaModel.crear`) ejecuta la transacción en SQL Server y aplica las reglas de negocio.
5. El controlador devuelve la respuesta en JSON y la vista actualiza la pantalla.

---

## 1. Requisitos

- Node.js 18 o superior (`node -v`)
- SQL Server Express (2016 o superior) y, opcionalmente, SQL Server Management Studio (SSMS)
- Visual Studio Code

## 2. Configurar SQL Server Express (una sola vez)

El paquete `mssql` se conecta por **TCP/IP**, que en SQL Server Express viene desactivado. Elige **una** de las dos opciones.

### Opción A (recomendada): usuario y contraseña de SQL Server

1. **Habilitar TCP/IP**
   Abre *SQL Server Configuration Manager* (búscalo en Windows como `SQLServerManager16.msc`, `15` o `14` según tu versión) →
   *Configuración de red de SQL Server* → *Protocolos de SQLEXPRESS* → **TCP/IP → Habilitar**.
   Doble clic en TCP/IP → pestaña *Direcciones IP* → sección **IPAll**: deja *Puertos dinámicos TCP* vacío y en *Puerto TCP* escribe **1433**.
2. **Activar autenticación mixta**
   En SSMS: clic derecho sobre el servidor → *Propiedades* → *Seguridad* → **Modo de autenticación de SQL Server y de Windows**.
3. **Reiniciar el servicio** *SQL Server (SQLEXPRESS)* (en Configuration Manager → Servicios de SQL Server).
4. **Crear el usuario de la aplicación** (en SSMS, nueva consulta):

   ```sql
   CREATE LOGIN busglow_app WITH PASSWORD = 'BusGlow2026!', CHECK_POLICY = OFF;
   ALTER SERVER ROLE dbcreator ADD MEMBER busglow_app;
   ```
   > `dbcreator` le permite crear la base BusGlowDB con `npm run db:init`. Si prefieres crearla tú desde SSMS (paso 3-B), no hace falta.

### Opción B: autenticación de Windows (sin contraseña)

```bash
npm install msnodesqlv8
```
Y en `.env`:
```
DB_DRIVER=msnodesqlv8
DB_SERVER=localhost\SQLEXPRESS
DB_ODBC_DRIVER=ODBC Driver 17 for SQL Server
```
(Si tienes instalado el *ODBC Driver 18*, cambia el número. Se ve en *Orígenes de datos ODBC* de Windows → pestaña *Controladores*.)

## 3. Instalar y ejecutar

```bash
# en la carpeta principal del proyecto (donde está package.json)
copy .env.example .env        # (en PowerShell/cmd;  en Git Bash: cp .env.example .env)
npm install
npm run db:test               # verifica la conexión
npm run db:init               # crea BusGlowDB, tablas y datos de prueba
npm start                     # o doble clic en iniciar.bat (recomendado para pruebas de carga)
```

Abre **http://localhost:3000** — el mismo servidor entrega las vistas y la API.

**3-B. Crear la base desde SSMS (alternativa a `db:init`)**: abre y ejecuta `database/01_schema.sql` y luego `database/02_seed.sql` (F5). Después, si usas la opción A, da acceso al usuario:
```sql
USE BusGlowDB;
CREATE USER busglow_app FOR LOGIN busglow_app;
ALTER ROLE db_owner ADD MEMBER busglow_app;
```

> ⚠️ `db:init` y `01_schema.sql` **borran y recrean** las tablas. Úsalos solo para reiniciar la base.
> Los viajes de prueba (servicios de ida y vuelta con buses que rotan y tripulaciones que descansan) se generan desde 10 días atrás hasta 30 días adelante **a partir de la fecha en que ejecutes el script**; si pasa un mes, vuelve a ejecutar `npm run db:init` o programa viajes desde el panel.

### Usuarios de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador de la plataforma | admin@busglow.pe | Admin123! |
| Empresa: Cruz del Sur | operaciones@cruzdelsur.demo | Empresa123 |
| Empresa: Movil Bus | operaciones@movilbus.demo | Empresa123 |
| Vendedor (todas las empresas) | ventas@busglow.pe | Vendedor123 |
| Vendedor de Cruz del Sur | ventas@cruzdelsur.demo | Vendedor123 |
| Cliente | juan.perez@email.com | Cliente123 |

> **Versión 3:** si ya tenías la base de datos de una versión anterior, vuelve a ejecutar `npm run db:init`.
> La estructura cambió (rol EMPRESA, ubicación del bus, tripulaciones y parámetros) y el script la recrea con datos nuevos.

### Pasarela de pagos (modo de prueba)

| Método | Dato de prueba | Resultado |
|---|---|---|
| Tarjeta | 4111 1111 1111 1111, vencimiento futuro (ej. 12/30), CVV 123 | Aprobado |
| Tarjeta | 4000 0000 0000 0002 | Rechazado |
| Yape / Plin | celular 9XXXXXXXX + cualquier código de 6 dígitos | Aprobado |
| Efectivo | solo personal (ADMIN, EMPRESA, VENDEDOR) | Aprobado |

La función `procesar()` de `src/models/PagoModel.js` es el único punto a reemplazar para integrar Culqi, Niubiz o Stripe.

---

## 3-C. Publicar en internet (Azure, gratis)

La versión 3.3 está lista para publicarse en **Azure App Service (plan Free F1)** con **Azure SQL Database (oferta gratuita)**.
Sigue la guía paso a paso: [`docs/DESPLIEGUE_AZURE.md`](docs/DESPLIEGUE_AZURE.md). Variables de referencia: `.env.azure.example`.

Cambios de la versión 3.3 para la nube:
- **Conexión cifrada** automática con Azure SQL (`*.database.windows.net`) o forzada con `DB_ENCRYPT`.
- **Hora del Perú** aunque el servidor esté en UTC: Node usa `TZ=America/Lima` y la base convierte `GETDATE()` a la zona `DB_ZONA_HORARIA` (`config/db.js` y scripts SQL).
- `npm run db:init` **no crea** la base en Azure (sería de pago): carga las tablas en la base gratuita creada en el portal.
- `/api/health` muestra la hora de la base y del servidor para verificar la zona horaria.
- Detrás del proxy de Azure se reconoce la IP real del usuario (límite de intentos de inicio de sesión).

## 4. Reglas de operación (versión 3)

**Multiempresa.** Cada empresa de transporte tiene su propio acceso (rol `EMPRESA`) y administra solo lo suyo: buses, conductores, horarios, viajes, vendedores y reportes. El administrador de BusGlow gestiona las empresas, las ciudades, los terminales, las rutas y los parámetros, y ve toda la plataforma. Un vendedor con empresa asignada solo vende y embarca los viajes de esa empresa.

**Ubicación del bus.** Cada bus guarda su último terminal (`bus.id_terminal_actual`), que se actualiza cuando un viaje se marca como *Finalizado*. Al programar, el sistema revisa la cadena de viajes del bus:
- debe salir desde la ciudad donde terminó su viaje anterior (o donde está estacionado);
- su siguiente viaje ya programado debe salir desde la ciudad donde termina el nuevo.

Si el bus está en otra ciudad, se puede marcar **traslado en vacío** (el bus se mueve sin pasajeros).

**Conductores: relevos y descanso.** Cada viaje tiene un conductor titular y los relevos que exija la ruta: uno por cada 10 h de conducción (Lima → Cusco, de 21 h, necesita 3 conductores). Entre la llegada de un viaje y la salida del siguiente, cada conductor descansa al menos 8 h. Se cuenta desde la hora real de llegada si ya se registró. Un viaje no puede pasar a *Embarcando* ni a *Salido* sin la tripulación completa.

Los valores (8 h de descanso, 10 h de conducción y 60 min de margen del bus) están en la tabla `parametro` y se editan en **Panel → Parámetros**. Tómalos como referencia para el prototipo y confírmalos con el Reglamento Nacional de Administración de Transporte (D.S. 017-2009-MTC) vigente.

**Ayuda al programar.** El formulario *Programar viaje* consulta `GET /api/admin/viajes/disponibilidad` cada vez que cambian la ruta, la fecha o la hora. Los buses y conductores disponibles aparecen con ✔; los que no, con ✖ y el motivo. *Programar viajes desde un horario* acepta un horario de vuelta: el mismo bus regresa en la primera salida posible.

**Cancelaciones, reembolsos y cambio de viaje.**

- *La empresa cancela un viaje.* Las reservas quedan canceladas (motivo `VIAJE`), los asientos se liberan y los boletos se anulan. Cada reserva pagada recibe un **reembolso pendiente del 100 %**, y el comprador y los pasajeros reciben un aviso. El pasajero elige entre dos opciones:
  - **devolución**: la pide él desde *Mis viajes* o la procesa la ventanilla con el botón *Reembolsar*;
  - **cambio de viaje sin costo**: la ventanilla usa el botón *Cambiar de viaje* y elige otro viaje de la misma ruta y empresa. Se mantiene el número de asiento si está libre, se emiten boletos nuevos y el reembolso pasa a *Anulado*.
- *El pasajero anula su pasaje* (con al menos 24 h de anticipación). Se le devuelve el pago menos la retención `penalidad_anulacion_pct`, que es de 10 % y se configura en Parámetros.
- *Seguimiento.* Los reembolsos se atienden en **Panel → Reembolsos**. El dashboard muestra los **ingresos netos** (cobrado menos devuelto) y los reembolsos pendientes. La devolución del dinero y el envío de avisos son **simulados**, igual que la pasarela de pagos. Para integrarlos de verdad hay que reemplazar `PagoModel.procesar()` y `NotificacionModel.enviar()`.
- *Para probar.* Los datos de prueba incluyen un viaje Lima → Ica cancelado, a 12 días, con pasajeros afectados. Uno de ellos es Juan: entra como `juan.perez@email.com` y revisa *Mis viajes* y *Avisos*.

## 5. Flujo de compra

1. **index.html** → busca origen, destino, fecha y número de pasajeros.
2. **resultados.html** → compara empresas, horarios, servicios y precios (filtros y orden).
3. **asientos.html** → mapa de asientos en tiempo real; datos de cada pasajero.
4. Al continuar, los asientos se **bloquean 10 minutos** (reserva *Pendiente*) para evitar la sobreventa.
5. **pago.html** → pago con cuenta regresiva; si expira, los asientos se liberan solos.
6. **boleto.html** → boleto electrónico con código y QR, imprimible / PDF.
7. **perfil.html** → datos personales, contraseña, historial, anulación (≥ 24 h antes).

## 6. Cobertura de requerimientos funcionales

| RF | Descripción | Dónde |
|---|---|---|
| 1 | Registrar usuarios | `POST /api/auth/registro` · registro.html · Usuarios (admin) |
| 2 | Iniciar sesión | `POST /api/auth/login` (JWT, contraseñas con scrypt, límite de intentos) |
| 3 | Roles y permisos | ADMIN / EMPRESA / VENDEDOR / CLIENTE · `middleware/auth.js` · cada empresa ve solo sus datos |
| 4 | Pasajeros | tabla `pasajero`, se registran en cada compra · Pasajeros (admin) |
| 5 | Buses | Buses (admin) · `/api/admin/buses` |
| 6 | Capacidad y distribución de asientos | `sp_generar_asientos` (2-2 / 2-1, 1 o 2 pisos) · asientos en mantenimiento |
| 7 | Conductores | Conductores (situación: disponible, en ruta o descansando) · titular y relevos por viaje (`viaje_conductor`) |
| 8 | Terminales | Terminales (admin) |
| 9 | Rutas | Rutas (admin) |
| 10 | Horarios de salida y llegada | Horarios (admin) — la llegada se calcula con la duración |
| 11 | Programar viajes | Programación → *+ Programar viaje* y *Programar viajes* desde un horario |
| 12 | Bus sin cruces de horario | `ViajeModel.estadoBuses()`: cruces con margen configurable y cadena de ubicación del bus |
| 13 | Conductor sin viajes simultáneos | `ViajeModel.estadoConductores()`: sin cruces, con descanso mínimo y relevos según la duración |
| 14 | Programación diaria | Programación (filtro por fecha y estado) |
| 15 | Reprogramar salida | *Reprogramar* (fecha, hora, bus, conductores) |
| 16 | Motivo de la modificación | tabla `viaje_modificacion` · historial en *Ver* |
| 17 | Estados del viaje | Programado, Embarcando, Próximo a salir, Salido, Retrasado, Cancelado, Finalizado |
| 18 | Hora real de embarque, salida y llegada | Botón *Estado* (registra `hora_real_embarque`, `hora_real_salida` y `hora_real_llegada`) |
| 19 | Cálculo del retraso | columna *Retraso* (real vs. programado) |
| 20 | Alertas | Dashboard: retrasos, salidas en los próximos 60 min y viajes de las próximas 24 h sin tripulación completa |
| 21 | Disponibilidad de asientos | `GET /api/viajes/:id/asientos` |
| 22 | Reservar y vender | `POST /api/reservas` + `/pagar` (web y ventanilla) |
| 23 | Impedir doble venta | índice único filtrado `uq_asiento_viaje_activo` + bloqueo temporal |
| 24 | Boleto electrónico | boleto.html · `GET /api/reservas/:id/boletos` · verificación por código |
| 25 | Reportes | Reportes: ventas, pasajeros, ocupación por ruta/bus, puntualidad y retrasos (exportables a CSV) |

**No funcionales:** contraseñas cifradas (scrypt + sal), JWT con expiración, control de acceso por rol en cada endpoint, consultas parametrizadas (sin inyección SQL), datos personales solo visibles para su dueño o personal autorizado, índices para las búsquedas principales.

## 7. Endpoints principales

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/health` | público |
| POST | `/api/auth/registro`, `/api/auth/login` | público |
| GET/PUT | `/api/auth/me`, `/api/auth/me/password`, `/api/auth/me/resumen` | usuario |
| GET | `/api/ciudades`, `/api/rutas/populares` | público |
| GET | `/api/viajes/buscar?origen=&destino=&fecha=&pasajeros=` | público |
| GET | `/api/viajes/:id`, `/api/viajes/:id/asientos` | público |
| POST | `/api/reservas` · `/api/reservas/:id/pagar` · `/api/reservas/:id/cancelar` | usuario |
| GET | `/api/reservas/mis` · `/api/reservas/:id` · `/api/reservas/:id/boletos` | usuario |
| GET | `/api/boletos/:codigo` | personal (de su empresa) |
| CRUD | `/api/admin/{buses,conductores,horarios}` | admin / empresa (solo los suyos) |
| CRUD | `/api/admin/{empresas,usuarios}` | admin · la empresa edita sus datos y sus usuarios |
| CRUD | `/api/admin/{ciudades,terminales,rutas}` | admin (la empresa solo lee) |
| GET/PUT | `/api/admin/parametros` | admin (los demás solo leen) |
| CRUD | `/api/admin/pasajeros` | vendedor / admin |
| GET | `/api/admin/viajes` · `/api/admin/viajes/:id` | personal (de su empresa) |
| POST | `/api/admin/viajes` · `/api/admin/viajes/generar` | admin / empresa |
| GET | `/api/admin/viajes/disponibilidad?id_ruta=&fecha_salida=&hora_salida=` | admin / empresa |
| PUT | `/api/admin/viajes/:id/reprogramar` | admin / empresa |
| PATCH | `/api/admin/viajes/:id/estado` | personal (cancelar: admin / empresa) |
| GET | `/api/admin/alertas` · `/api/admin/dashboard` | personal (de su empresa) |
| GET | `/api/admin/reportes?desde=&hasta=&id_ruta=` | admin / empresa |
| GET | `/api/admin/viajes/:id/afectados` · `/api/admin/reembolsos?estado=` | personal (de su empresa) |
| POST | `/api/admin/reservas/:id/reembolsar` · `/api/admin/reservas/:id/reubicar` | personal (de su empresa) |
| GET | `/api/admin/reservas/:id/alternativas` | personal (de su empresa) |
| POST | `/api/reservas/:id/reembolso` (viaje cancelado por la empresa) | cliente dueño de la reserva |
| GET/POST | `/api/auth/me/notificaciones` · `/api/auth/me/notificaciones/leidas` | usuario |

## 8. Problemas frecuentes

| Mensaje | Solución |
|---|---|
| `Failed to connect to localhost:1433` | TCP/IP no está habilitado o no reiniciaste el servicio (paso 2.1 y 2.3). |
| `Login failed for user 'busglow_app'` | Falta activar la autenticación mixta (2.2) o la contraseña en `.env` no coincide. |
| `Failed to connect to localhost\SQLEXPRESS` usando `DB_INSTANCE` | Inicia el servicio *SQL Server Browser* o usa `DB_PORT=1433`. |
| `CREATE DATABASE permission denied` | Ejecuta `ALTER SERVER ROLE dbcreator ADD MEMBER busglow_app;` o crea la BD desde SSMS (3-B). |
| La página muestra "No se pudo conectar con el servidor" | El servidor no está corriendo: `npm start` en la carpeta del proyecto. |
| Abro el .html con doble clic o Live Server y no funciona | Abre siempre **http://localhost:3000**: Express sirve las vistas y su JavaScript. |
| `TimeoutError: operation timed out` o `Query timeout expired` con muchos usuarios | 1) Inicia el servidor con `iniciar.bat` (64 hilos de trabajo; con msnodesqlv8 cada consulta usa uno). 2) Ejecuta `database/03_rendimiento.sql` en SSMS (lecturas sin bloqueo e índices). 3) Si persiste, sube `DB_POOL_MAX` en `.env` (por defecto 30). |

## 9. Fuera del alcance de esta versión

Monitoreo GPS en tiempo real de los buses (propuesto como siguiente paso), devolución real del dinero por la pasarela, envío real de correos/SMS/WhatsApp (el punto de integración es `NotificacionModel.enviar()`), pasarela de pagos real y facturación electrónica SUNAT.
