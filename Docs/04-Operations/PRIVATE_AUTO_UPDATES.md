# Actualizaciones Privadas Obligatorias

## Alcance

Este runbook describe el despliegue y la operación del canal Windows `stable`. La aplicación empaquetada consulta un feed privado de Supabase Storage, exige un entitlement efectivo `active` y convierte toda versión superior detectada en una actualización obligatoria. No se habilitan prereleases ni downgrades.

`Docs/04-Operations/OFFLINE_RELEASE_PREPARATION.md` sigue siendo un gate local de evidencia. No publica, no firma, no ejecuta migraciones y no reemplaza este procedimiento.

## Arquitectura Y Frontera De Seguridad

1. `electron-updater` sólo se inicializa en Windows empaquetado. Desarrollo y otras plataformas quedan en `disabled`.
2. La configuración empaquetada aporta `VIBE_SUPABASE_URL`, la anon key, el bucket `desktop-releases` y el canal `stable` al proceso principal. Estas credenciales no entran al renderer.
3. Tras autenticar al usuario, el proceso principal configura un provider `generic` en:

   ```text
   https://<project-ref>.supabase.co/storage/v1/object/authenticated/desktop-releases/stable
   ```

4. Cada consulta y descarga lleva `Authorization: Bearer <JWT del usuario>` y `apikey: <anon key>` como headers. Nunca se colocan JWT, anon keys ni service-role keys en la URL, el estado IPC o los mensajes de error.
5. Supabase Storage evalúa RLS sobre `storage.objects`. La policy permite `select` sólo a `authenticated`, sólo en `desktop-releases` y sólo cuando `public.has_active_desktop_entitlement()` devuelve `true`.
6. La service-role key existe únicamente en el job de publicación. No se empaqueta y no debe usarse para probar lecturas de clientes.

El entitlement de escritorio es efectivo únicamente en estos casos:

- `profiles.status = 'active'` y `profiles.role = 'admin'`;
- `profiles.status = 'active'`, `profiles.role = 'student'`, una suscripción con `status = 'active'`, período sin vencimiento o futuro, y un plan con `is_active = true`.

Un instructor, un perfil no activo o un estudiante sin plan vigente no tiene acceso al bucket. La migración también redefine `get_desktop_access()` para que admin activo devuelva `active`, estudiante con plan vigente devuelva `active` y estudiante sin ese plan devuelva `restricted`. La app sólo entrega el JWT al updater cuando su policy local también es `active`.

## Estados Del Cliente

| Estado | Bloqueo | Operación |
| --- | --- | --- |
| `disabled` | No, salvo que ya se hubiera descubierto una versión obligatoria | Updater no elegible o entitlement no `active`; se cancelan operaciones y se eliminan headers. |
| `idle` | No | Updater listo para consultar. |
| `checking` | Gate de arranque hasta conocer el resultado | Consulta `latest.yml` con JWT y anon key. |
| `current` | No | No hay versión superior; nueva consulta automática en 4 horas. |
| `available` | Sí | Hay una versión superior; no existe opción de omitir o cerrar el gate. |
| `downloading` | Sí | Descarga explícita con progreso; el workspace queda inerte. |
| `downloaded` | Sí | Espera reinicio e instalación explícitos. Antes de reiniciar se protege el trabajo sin guardar. |
| `error` sin `mandatory` | No | Falló la consulta antes de que este equipo conociera una actualización; reintento automático en 15 minutos. |
| `error` con `mandatory` | Sí | Falló descarga o instalación después de descubrir la versión; el botón reintenta. |

La descarga no empieza sin la acción explícita del usuario: `autoDownload` y `autoInstallOnAppQuit` están desactivados. Después de confirmar el reinicio, `quitAndInstall(true, true)` aplica el instalador en modo silencioso y vuelve a abrir la app. La versión mínima descubierta se persiste atómicamente y sólo se elimina cuando una ejecución posterior confirma que la versión instalada ya la alcanzó. Reiniciar offline no elimina una obligación conocida. Si se pierde el entitlement, el updater cede la pantalla a la recuperación de cuenta; al restaurar acceso `active`, vuelve a comprobar y bloquear contra esa versión persistida.

## Migración Web Requerida

La infraestructura vive en el repositorio hermano `C:\Users\pikachu\Downloads\Vibe IDE Coder\vibe coder web`. Las migraciones requeridas son:

```text
supabase/migrations/20260809120000_private_desktop_releases.sql
supabase/migrations/20260809130000_restrict_desktop_release_reads.sql
```

La primera crea el bucket privado con límite de 400 MiB, instala la función de entitlement, aplica la policy de lectura y alinea `get_desktop_access()`. La segunda impone el entitlement con una policy restrictiva para que ninguna policy permisiva futura pueda abrir el bucket por combinación `OR`. Ambas deben desplegarse antes de publicar `v1.1.3`.

Desde el repositorio web, con Supabase CLI autenticada y acceso autorizado al proyecto, ejecutar:

```powershell
supabase link --project-ref rhyjgstipvyqlhdlmihf
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
supabase db lint --linked
```

Antes del `db push`, comprobar que el proyecto enlazado sea `rhyjgstipvyqlhdlmihf`, que el historial remoto esté reconciliado y que el dry-run sólo incluya migraciones deliberadamente pendientes. Si aparecen migraciones inesperadas o divergencias de historial, detenerse y reconciliar; no usar reparación de historial a ciegas.

Después del push:

- confirmar que `20260809120000` y `20260809130000` figuran aplicadas en local y remoto;
- confirmar que `desktop-releases` existe con `public = false` y límite `419430400`;
- validar con un JWT real de un usuario entitled que Storage permite leer un objeto de prueba o, después de la primera publicación, `stable/latest.yml`;
- validar con un usuario no entitled que la misma lectura es rechazada;
- no imprimir, persistir ni adjuntar los JWT usados en la verificación.

Las credenciales de Supabase CLI, incluido `SUPABASE_ACCESS_TOKEN` si se utiliza, son credenciales operativas separadas de los secretos de GitHub Actions.

## Secretos De Producción

El environment de GitHub `production` requiere estos secrets:

| Secret | Uso |
| --- | --- |
| `VIBE_SUPABASE_URL` | URL HTTPS sin credenciales del proyecto que aloja Auth, RPC y Storage. |
| `VIBE_SUPABASE_ANON_KEY` | API key pública empaquetada para Auth/Storage; se administra como secret de release para evitar errores de configuración. |
| `SUPABASE_SERVICE_ROLE_KEY` | Escritura server-side de los objetos de release. Nunca llega a la app. |
| `UPDATE_SIGNING_PRIVATE_KEY` | Clave Ed25519 gratuita que firma `latest.yml`. La parte pública correspondiente está incluida en la app. |

`VIBE_AUTH_HELP_URL` también puede configurarse en el environment, pero el workflow vigente no la exige para publicar. `VIBE_UPDATE_BUCKET=desktop-releases` y `VIBE_UPDATE_CHANNEL=stable` están fijados por el workflow y no son secretos.

Esta etapa no usa ni compra un certificado de Windows. El workflow firma criptográficamente la versión, el nombre del instalador, su tamaño, SHA-512 y fecha. La app contiene únicamente la clave pública y rechaza metadata sin firma, modificada o firmada con otra clave. La clave privada queda sólo en GitHub y no se empaqueta.

Windows mostrará `Editor desconocido` durante la instalación manual inicial. Es una limitación visual esperada de esta etapa sin costo, no una falla de la firma interna. Las actualizaciones posteriores se descargan y validan dentro de la aplicación.

## Publicación De `vX.Y.Z`

El workflow `.github/workflows/release.yml` se activa al subir un tag estable con formato `vX.Y.Z`. El tag debe apuntar al commit aprobado y `X.Y.Z` debe coincidir exactamente con `package.json`. Un dispatch manual resuelve exclusivamente `refs/tags/vX.Y.Z`; una rama con ese nombre no sirve. Las Actions externas están fijadas por SHA.

Procedimiento:

1. Desplegar y verificar la migración web si todavía no está aplicada.
2. Actualizar la versión de la aplicación y lockfile, cerrar changelog/documentación y ejecutar el gate de release.
3. Crear el tag inmutable correspondiente y subirlo:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. Aprobar el environment `production` si GitHub lo requiere.
5. Verificar que el job instala con `npm ci`, ejecuta `npm run check`, empaqueta con `--publish never`, valida identidad/tag, firma `latest.yml` con Ed25519 y genera la evidencia local.
6. Verificar la publicación privada y conservar el artifact `desktop-release-X.Y.Z-evidence`.

El publicador lee el `latest.yml` generado por `electron-builder`, exige SemVer estable y sube exactamente en este orden:

1. `Vibe-IDE-Code-Setup-X.Y.Z.exe`;
2. `Vibe-IDE-Code-Setup-X.Y.Z.exe.blockmap`;
3. `latest.yml`.

El instalador y el blockmap se crean sin upsert: una colisión aborta la publicación. `latest.yml` es el único objeto mutable, usa `no-store`, se sube al final y es el interruptor de activación. Antes de subir, el publicador analiza el YAML completo y verifica versión, nombre, tamaño y SHA-512 contra el instalador local. El nombre local y remoto canónico es `Vibe-IDE-Code-Setup-X.Y.Z.exe`.

Si falla un secret, el gate, el build, la firma o la evidencia, no se ejecuta la publicación. Si una subida deja un objeto versionado parcial antes de `latest.yml`, la versión anterior sigue activa, pero el mismo tag no se reejecuta hasta retirar manualmente sólo esos objetos parciales y comprobar que nunca fueron activados. No mover, recrear ni reconstruir silenciosamente un tag publicado.

## Bootstrap Manual De `1.1.3`

`1.0.0` no contiene updater y nunca descubrirá `latest.yml`. Por eso `1.1.3` necesita una instalación manual única:

1. Aplicar y verificar ambas migraciones privadas de desktop releases.
2. Publicar el tag `v1.1.3` mediante el workflow vigente y comprobar firma, objetos y evidencia.
3. Obtener el instalador aprobado sin exponer la service-role key ni convertir el bucket en público.
4. Distribuir `Vibe-IDE-Code-Setup-1.1.3.exe` por el canal privado aprobado e indicar a cada usuario de `1.0.0` que lo ejecute manualmente sobre la instalación existente.
5. Aceptar conscientemente el aviso inicial `Editor desconocido`, confirmar que la aplicación abre como `1.1.3`, que el usuario puede reautenticarse y que una cuenta con entitlement `active` llega al estado `current`.
6. No considerar migrada la base instalada sólo porque `v1.1.3` esté en Storage; registrar quién completó el bootstrap. Los equipos que permanezcan en `1.0.0` seguirán necesitando instalación manual.

No publicar `v1.1.4` como validación general hasta disponer de al menos una instalación real y funcional de `1.1.3` para probar el salto completo.

## Prueba Real `1.1.3` A `1.1.4`

Esta prueba usa metadata firmada con la clave privada gratuita y el canal privado real; publicar `v1.1.4` en `stable` la vuelve obligatoria para todos los clientes elegibles que la detecten. Coordinar la ventana antes de crear el tag.

1. Partir de Windows con `1.1.3` instalada manualmente, no desde una app de desarrollo ni `win-unpacked`.
2. Iniciar sesión con una cuenta de prueba cuyo perfil y plan cumplan el entitlement `active`. Confirmar primero `current` contra `v1.1.3`.
3. Preparar `1.1.4`, completar todos los gates y publicar `v1.1.4` mediante su tag.
4. Confirmar en Storage la presencia de instalador, blockmap y `latest.yml`, y comprobar que el metadata declara `version: 1.1.4` y el nombre remoto correcto.
5. Reiniciar `1.1.3` para provocar la consulta de arranque. Debe pasar por `checking` y mostrar `available` para `1.1.4` sin opción de omitir; el workspace debe quedar inerte.
6. Descargar y observar `downloading` con progreso, seguido de `downloaded`.
7. Con trabajo sin guardar, cancelar una vez la protección previa al reinicio y confirmar que no instala ni desbloquea el workspace. Guardar o descartar de forma deliberada y volver a elegir reiniciar.
8. Confirmar el cierre, la instalación y el arranque de `1.1.4`; verificar que la sesión puede validarse y que el updater termina en `current`.
9. Repetir la lectura de `latest.yml` con una cuenta no entitled y confirmar rechazo. No registrar headers ni tokens.
10. Guardar como evidencia la ejecución de Actions, versión inicial/final, estados observados, validación de la firma interna y tiempos, sin credenciales.

## Rollback: Siempre Con Versión Superior

El cliente configura `allowDowngrade = false`. Cambiar `latest.yml` a una versión inferior no recupera clientes que ya instalaron una versión defectuosa y puede dejar estados distintos entre equipos.

El rollback operativo es siempre forward-only:

1. Identificar el último código conocido como bueno y aplicar sobre él la reversión o corrección necesaria.
2. Incrementar SemVer por encima de cualquier versión ya activada. Si `1.1.4` es defectuosa, publicar como mínimo `1.1.5`; nunca volver a `1.1.3`.
3. Ejecutar otra vez gates, firma Ed25519, evidencia y prueba manual.
4. Crear y publicar el nuevo tag. Los clientes en `1.1.3` y `1.1.4` convergerán en `1.1.5`.
5. Conservar los objetos versionados anteriores para descargas en curso y auditoría. No sobrescribirlos ni borrarlos durante el incidente.

Si todavía no se activó `latest.yml`, se puede abandonar el intento fallido sin afectar al canal. Una vez activado, priorizar la versión superior; ocultar metadata, retirar permisos o publicar una versión menor no es rollback.

## Recuperación Por Errores

| Síntoma | Diagnóstico Y Recuperación |
| --- | --- |
| `db push` o historial de migraciones diverge | Detener publicación. Verificar project ref, `migration list --linked` y dry-run; reconciliar el historial de forma explícita antes de reintentar. |
| Workflow falla antes de publicar | Corregir secrets/aprobaciones y reejecutar el mismo tag sólo si el commit no cambia. Si debe cambiar código o versión, crear un nuevo commit y tag superior; no mover el tag. |
| Fallo de subida antes de `latest.yml` | La versión anterior sigue activa. Retirar únicamente los objetos parciales no activados; los binarios versionados no permiten upsert. Después puede reintentarse el mismo tag sin cambiar sus bytes. |
| `latest.yml` da `404` | Confirmar que existen bucket `desktop-releases`, prefijo `stable` y una publicación completada. No hacer público el bucket como solución. |
| Storage da `401/403` | Confirmar migración aplicada, JWT vigente, headers `Authorization`/`apikey`, perfil `active` y, para student, suscripción/plan vigentes. Reautenticar o revalidar la sesión después de corregir el entitlement. |
| `UPDATE_CHECK_FAILED` no obligatorio | El workspace continúa disponible. Corregir red, metadata o Auth y esperar el reintento de 15 minutos; reiniciar la app también provoca una nueva consulta de arranque. |
| `UPDATE_DOWNLOAD_FAILED` obligatorio | El workspace sigue bloqueado. Verificar que instalador y blockmap nombrados en `latest.yml` existan y sean legibles con el mismo JWT; corregir red/RLS y usar Reintentar. |
| `UPDATE_INSTALL_FAILED` | Confirmar espacio, permisos y antivirus. Reintentar desde `downloaded/error`; si es necesario, ejecutar manualmente el mismo instalador aprobado o uno superior. Nunca instalar una versión inferior. |
| La protección de trabajo sin guardar cancela el reinicio | No es un fallo de updater. Guardar o descartar deliberadamente y volver a pulsar reiniciar; la actualización descargada sigue siendo obligatoria. |
| Firma interna inválida | No publicar. Confirmar que `UPDATE_SIGNING_PRIVATE_KEY` corresponde a `electron/update-signing-public-key.pem` y repetir el workflow. Nunca reemplazar una clave sin publicar antes una versión de transición. |
| Release defectuosa ya activada | No editar el tag ni bajar versión. Preparar y publicar inmediatamente una versión SemVer superior con la corrección o reversión. |

Durante un incidente no incluir JWT, service-role keys, la clave privada de actualización, URLs con credenciales ni rutas locales sensibles en tickets o artifacts. Los estados IPC y errores de usuario están deliberadamente saneados; la evidencia operativa debe mantener la misma regla.
