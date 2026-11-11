# Publicar BusGlow en Azure (gratis)

Guía para dejar BusGlow en internet con una dirección como `https://busglow-grupo.azurewebsites.net`, usando la suscripción **Azure for Students** y solo servicios gratuitos.

| Pieza | Servicio de Azure | Plan |
|---|---|---|
| Base de datos | Azure SQL Database | Oferta gratuita (100 000 segundos de vCore y 32 GB al mes, con pausa automática) |
| Aplicación (API + páginas) | Azure App Service (Linux, Node.js) | Free F1 |
| Publicación automática | GitHub Actions (creado por Azure) | Gratis |

Tiempo estimado: 45 a 60 minutos.

---

## 0. Antes de empezar

- [ ] Cuenta de **Azure for Students** activa (portal.azure.com).
- [ ] Repositorio del proyecto en **GitHub** con la versión 3.3.
- [ ] En tu PC: Node.js 18 o superior, el proyecto con `npm install` hecho, y SSMS (opcional).
- [ ] Decidir dos nombres únicos en minúsculas, por ejemplo:
  - servidor SQL: `busglow-sql-grupo1`
  - aplicación web: `busglow-grupo1`

## 1. Subir la versión 3.3 a GitHub

En la carpeta del proyecto:

```bash
git checkout develop
git add .
git commit -m "feat(despliegue): versión 3.3 lista para Azure (cifrado y hora del Perú)"
git push origin develop
git checkout main
git merge develop
git push origin main
git tag -a v3.3 -m "Versión publicada en Azure"
git push origin --tags
```

Comprueba que `.env` **no** aparece en GitHub (está en `.gitignore`).

## 2. Crear el grupo de recursos

1. Portal de Azure → **Grupos de recursos** → **Crear**.
2. Nombre: `rg-busglow`. Región: **East US 2** (o la que tu suscripción permita).
3. **Revisar y crear** → **Crear**.

> Si al crear un recurso aparece *"RequestDisallowedByAzure"* o *"región no permitida"*, tu suscripción de estudiante limita las regiones: elige otra de la lista (por ejemplo East US, Central US o Brazil South) y úsala en todos los pasos.

## 3. Crear la base de datos gratuita (Azure SQL Database)

1. **Crear un recurso** → buscar **SQL Database** → **Crear**.
2. En la parte superior aparece **«Want to try Azure SQL Database for free?»** → pulsa **Apply offer** (Aplicar oferta). Debe quedar marcado *Free offer applied*.
3. Pestaña **Básico**:
   - Grupo de recursos: `rg-busglow`
   - Nombre de la base de datos: **`BusGlowDB`** (exactamente así)
   - Servidor: **Crear nuevo**
     - Nombre: `busglow-sql-grupo1`
     - Ubicación: la misma región del paso 2
     - Autenticación: **Usar autenticación de SQL**
     - Usuario: `busglowadmin` · Contraseña: una segura (**guárdala**)
   - *Comportamiento cuando se alcanza el límite gratuito*: **Auto-pause the database until next month** (así nunca se cobra).
4. Pestaña **Redes**:
   - Método de conectividad: **Punto de conexión público**
   - **Permitir que los servicios y recursos de Azure accedan a este servidor: Sí**
   - **Agregar la dirección IP del cliente actual: Sí**
5. **Revisar y crear** → **Crear**. Espera unos minutos.

> La base se pausa sola cuando no se usa. La primera consulta después de una pausa puede tardar hasta un minuto: si la página da error al inicio, recarga.

## 4. Cargar las tablas y los datos de prueba desde tu PC

1. Guarda una copia de tu `.env` local (por ejemplo `.env.local`).
2. Copia `.env.azure.example` como `.env` y completa `DB_SERVER`, `DB_USER` y `DB_PASSWORD` con los del paso 3.
3. Ejecuta:

   ```bash
   npm run db:test     # debe decir "Conexión exitosa" y mostrar la hora del Perú
   npm run db:init     # crea las 21 tablas y carga los datos de prueba
   ```

   `db:init` **no crea** la base en Azure (sería una base de pago): usa la base gratuita del paso 3. Si dice que no existe, revisa que se llame `BusGlowDB`.
4. Vuelve a tu `.env` local (renombra `.env.local` a `.env`) para seguir trabajando en tu PC.

> Alternativa con SSMS: conéctate a `busglow-sql-grupo1.database.windows.net` con autenticación de SQL, selecciona la base `BusGlowDB` y ejecuta `01_schema.sql` y `02_seed.sql` **sin** las líneas `CREATE DATABASE` y `USE`.

## 5. Crear la aplicación web (App Service, plan gratuito)

1. **Crear un recurso** → **Aplicación web** → **Crear**.
2. Pestaña **Básico**:
   - Grupo de recursos: `rg-busglow`
   - Nombre: `busglow-grupo1` → dirección final `https://busglow-grupo1.azurewebsites.net`
   - Publicar: **Código**
   - Pila del entorno en tiempo de ejecución: **Node 22 LTS** (o Node 20 LTS)
   - Sistema operativo: **Linux**
   - Región: la misma del paso 2
   - Plan de App Service: **Crear nuevo** → Plan de precios: **Gratis F1** (en *Explorar planes de precios* → *Desarrollo/prueba*)
3. Pestaña **Implementación**: puedes dejarla deshabilitada (se configura en el paso 7).
4. **Revisar y crear** → **Crear**.

## 6. Configurar las variables de entorno

Aplicación web → **Configuración** → **Variables de entorno** → **Agregar** cada una:

| Nombre | Valor |
|---|---|
| `DB_DRIVER` | `tedious` |
| `DB_SERVER` | `busglow-sql-grupo1.database.windows.net` |
| `DB_PORT` | `1433` |
| `DB_NAME` | `BusGlowDB` |
| `DB_USER` | `busglowadmin` |
| `DB_PASSWORD` | la contraseña del paso 3 |
| `DB_ENCRYPT` | `true` |
| `DB_POOL_MAX` | `10` |
| `TZ` | `America/Lima` |
| `JWT_SECRET` | una cadena larga y aleatoria (mínimo 32 caracteres) |
| `JWT_EXPIRES` | `8h` |

Pulsa **Aplicar** y confirma (la aplicación se reinicia).

Además, en **Configuración → Configuración general**: **Solo HTTPS: Activado**.

## 7. Conectar GitHub para publicar automáticamente

1. Aplicación web → **Centro de implementación**.
2. Origen: **GitHub** → **Autorizar** con la cuenta del responsable del repositorio.
3. Organización, repositorio y rama: **main**.
4. Tipo de autenticación: deja la opción propuesta (**Identidad asignada por el usuario**).
5. **Guardar**. Azure agrega un archivo `.github/workflows/main_busglow-grupo1.yml` al repositorio y lanza la primera publicación.
6. En GitHub → pestaña **Actions** verás el flujo *Build and deploy*: espera a que quede en verde (3 a 6 minutos).

Desde ahora, cada `git push` a `main` publica una versión nueva. Haz `git pull` en tu PC para traer el archivo del flujo que creó Azure.

> El paquete opcional `msnodesqlv8` (autenticación de Windows) puede mostrar advertencias al instalarse en Linux: es normal, en Azure se usa `tedious`.

## 8. Verificar la publicación

1. Abre `https://busglow-grupo1.azurewebsites.net/api/health`. Debe responder algo así:

   ```json
   { "estado": "ok", "baseDeDatos": "conectada",
     "horaBaseDeDatos": "2026-11-10 10:15:00", "horaServidor": "2026-11-10 10:15:00", "zona": "America/Lima" }
   ```

   Las dos horas deben coincidir con la hora del Perú.
2. Abre `https://busglow-grupo1.azurewebsites.net` y prueba el recorrido:
   - [ ] Buscar un viaje, elegir asientos y pagar con `juan.perez@email.com` / `Cliente123`.
   - [ ] Entrar al panel con `operaciones@cruzdelsur.demo` / `Empresa123` y programar un viaje.
   - [ ] Ver el viaje cancelado Lima–Ica y sus reembolsos con `admin@busglow.pe` / `Admin123!`.
3. Ábrelo también desde un celular con datos móviles para confirmar que se accede desde cualquier lugar.

## 9. Seguridad después de publicar

Las contraseñas de prueba están en el README y en el repositorio, por lo que cualquiera podría entrar como administrador:

- [ ] Cambia la contraseña de `admin@busglow.pe` (desde **Mi perfil**, o en el panel → **Usuarios**). Comparte la nueva solo con el equipo y el docente.
- [ ] Haz lo mismo con las cuentas de empresa y vendedor si las van a mostrar.
- [ ] Nunca subas `.env` ni la contraseña de la base al repositorio.

## 10. Evidencias para el informe

Toma capturas de:

1. El grupo de recursos `rg-busglow` con la base de datos y la aplicación web.
2. La base de datos con **Free offer applied**.
3. El plan de App Service en **F1 (Gratis)**.
4. El flujo de GitHub **Actions** en verde.
5. `/api/health` respondiendo `conectada`.
6. El sistema funcionando en la dirección pública (computadora y celular).

## Límites del plan gratuito

- **App Service F1**: 60 minutos de CPU al día y 1 GB de memoria. Suficiente para demostraciones, no para mucho tráfico.
- La aplicación **se duerme** si nadie la usa (no hay *Always On*). La primera visita tarda 20 a 40 segundos y, mientras duerme, no corren las tareas automáticas (liberar reservas vencidas, marcar retrasos); se ponen al día al despertar. **Ábrela 5 minutos antes de exponer.**
- **Azure SQL gratis**: 100 000 segundos de vCore al mes. Con pausa automática, si se agotan la base se pausa hasta el mes siguiente; no hay cobro.
- **No ejecutes pruebas de JMeter contra Azure**: consumen la cuota del mes. Las pruebas de carga se hacen en local.

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `/api/health` dice `sin conexión` | Variables mal escritas o firewall | Revisa `DB_SERVER`, `DB_USER`, `DB_PASSWORD`; en el servidor SQL → **Redes**, «Permitir servicios de Azure» = Sí |
| `npm run db:init` dice *Cannot open server… client IP* | Tu IP no está en el firewall | Servidor SQL → **Redes** → **Agregar la IP del cliente actual** → Guardar |
| Error *The database … is paused* o tarda mucho | La base gratuita estaba en pausa | Espera un minuto y recarga |
| Las horas de `/api/health` salen con 5 h de diferencia | Falta `TZ` | Agrega `TZ = America/Lima` y reinicia la aplicación |
| La página muestra *Application Error* | Error al iniciar | Aplicación web → **Secuencia de registro** (Log stream) para ver el mensaje |
| GitHub Actions falla en *deploy* | Permisos de la identidad | Vuelve a **Centro de implementación** → Desconectar → conectar de nuevo |
| Error *RequestDisallowedByAzure* | Región no permitida para estudiantes | Elige otra región |

## Al terminar el curso

Para no consumir el crédito: **Grupos de recursos** → `rg-busglow` → **Eliminar grupo de recursos** (borra la base y la aplicación).
