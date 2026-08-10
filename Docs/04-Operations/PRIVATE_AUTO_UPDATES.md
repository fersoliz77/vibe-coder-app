# Actualizaciones Privadas Obligatorias

## Alcance

Este runbook describe el canal Windows `stable`. La aplicación empaquetada consulta un Cloudflare Worker privado, exige un entitlement efectivo `active` en Supabase y convierte toda versión superior detectada en una actualización obligatoria. Los binarios viven como assets de releases del repositorio privado de GitHub. No se habilitan prereleases ni downgrades.

`Docs/04-Operations/OFFLINE_RELEASE_PREPARATION.md` sigue siendo un gate local de evidencia. No publica, no firma, no ejecuta migraciones y no reemplaza este procedimiento.

## Arquitectura Y Seguridad

1. `electron-updater` sólo se inicializa en Windows empaquetado. Desarrollo y otras plataformas quedan en `disabled`.
2. La configuración empaquetada aporta `VIBE_UPDATE_URL`, `stable` y la anon key exclusivamente al proceso principal.
3. El provider `generic` consulta:

   ```text
   https://vibe-desktop-updates.vibe-ide-coder.workers.dev/stable
   ```

4. Cada consulta y descarga lleva `Authorization: Bearer <JWT del usuario>` y `apikey: <anon key>` como headers. Ninguna credencial entra a la URL, renderer, estado IPC o mensajes de error.
5. El Worker llama a `public.has_active_desktop_entitlement()` con ese JWT. Un resultado distinto de `true` falla cerrado antes de consultar GitHub.
6. Para `latest.yml`, el Worker consulta el último release publicado. Para instaladores y blockmaps versionados, resuelve el tag inmutable correspondiente. Soporta `Range` y no reenvía el token de GitHub al host final del asset.
7. Los assets permanecen en el repositorio privado. El Worker contiene como secrets una anon key de Supabase y un token de GitHub con lectura del repositorio; ninguna de esas credenciales se empaqueta.

El entitlement es efectivo únicamente en estos casos:

- `profiles.status = 'active'` y `profiles.role = 'admin'`;
- `profiles.status = 'active'`, `profiles.role = 'student'`, una suscripción `active` no vencida y un plan con `is_active = true`.

Instructor, perfil no activo o estudiante sin plan vigente no acceden. La app sólo entrega el JWT al updater cuando su policy local también es `active`.

## Estados Del Cliente

| Estado | Bloqueo | Operación |
| --- | --- | --- |
| `disabled` | No, salvo obligación ya descubierta | Updater no elegible o entitlement no `active`; cancela operaciones y elimina headers. |
| `idle` | No | Updater listo para consultar. |
| `checking` | Gate de arranque | Consulta `latest.yml` con JWT y anon key. |
| `current` | No | No hay versión superior; nueva consulta automática en 4 horas. |
| `available` | Sí | Hay versión superior y no existe opción de omitir. |
| `downloading` | Sí | Descarga explícita con progreso; workspace inerte. |
| `downloaded` | Sí | Espera reinicio; antes protege el trabajo sin guardar. |
| `error` sin `mandatory` | No | Falló la consulta inicial; reintento automático en 15 minutos. |
| `error` con `mandatory` | Sí | Falló después de descubrir la versión; el botón reintenta. |

`autoDownload` y `autoInstallOnAppQuit` están desactivados. Después de confirmar, `quitAndInstall(true, true)` aplica el instalador silenciosamente y reabre la app. La versión mínima descubierta se persiste atómicamente y reiniciar offline no elimina una obligación conocida.

## Backend Requerido

El repositorio web contiene las migraciones ya desplegadas:

```text
supabase/migrations/20260809120000_private_desktop_releases.sql
supabase/migrations/20260809130000_restrict_desktop_release_reads.sql
```

La primera define `public.has_active_desktop_entitlement()` y alinea `get_desktop_access()`. El bucket privado creado por esas migraciones queda como infraestructura cerrada, pero ya no almacena instaladores porque Supabase Free limita cada archivo a 50 MiB.

Verificación desde el repositorio web:

```powershell
supabase link --project-ref rhyjgstipvyqlhdlmihf
supabase migration list --linked
supabase db push --linked --dry-run
supabase migration list --linked
supabase db lint --linked
```

Confirmar que ambas migraciones figuran aplicadas y probar `has_active_desktop_entitlement()` con una cuenta entitled y otra no entitled. No imprimir ni adjuntar JWT.

## Cloudflare Worker

Configuración versionada:

```text
cloudflare/desktop-updates/wrangler.jsonc
cloudflare/desktop-updates/src/index.mjs
```

Bindings públicos:

- `GITHUB_REPOSITORY=fersoliz77/vibe-coder-app`;
- `SUPABASE_URL=https://rhyjgstipvyqlhdlmihf.supabase.co`;
- `UPDATE_CHANNEL=stable`.

Secrets del Worker:

- `SUPABASE_ANON_KEY`;
- `GITHUB_TOKEN`, preferentemente fine-grained, con sólo lectura de `Contents` para `fersoliz77/vibe-coder-app`.

Despliegue:

```powershell
npx wrangler@4.120.0 deploy --config cloudflare/desktop-updates/wrangler.jsonc
npx wrangler@4.120.0 secret list --config cloudflare/desktop-updates/wrangler.jsonc
```

Una consulta anónima a `/stable/latest.yml` debe responder `401` y `Cache-Control: private, no-store`. Una ruta no canónica debe responder `404`. Rotar `GITHUB_TOKEN` inmediatamente si pierde el alcance mínimo o si una persona deja de administrar releases.

## Secretos De GitHub

El environment `production` requiere:

| Secret | Uso |
| --- | --- |
| `VIBE_SUPABASE_URL` | Auth y RPC empaquetados en el proceso principal. |
| `VIBE_SUPABASE_ANON_KEY` | Clave pública para Auth y validación del entitlement. |
| `UPDATE_SIGNING_PRIVATE_KEY` | Firma Ed25519 de `latest.yml`; nunca se empaqueta. |

`VIBE_AUTH_HELP_URL` es opcional. `VIBE_UPDATE_URL` y `VIBE_UPDATE_CHANNEL=stable` están fijados por el workflow y no son secretos. `SUPABASE_SERVICE_ROLE_KEY` no es necesaria para releases y debe eliminarse del environment.

No se compra certificado de Windows en esta etapa. La firma interna cubre versión, nombre, tamaño, SHA-512 y fecha. Windows mostrará `Editor desconocido` sólo durante la instalación manual inicial.

## Publicación De `vX.Y.Z`

`.github/workflows/release.yml` se activa con tags `vX.Y.Z`. El tag debe coincidir exactamente con `package.json` y no se mueve ni reconstruye.

El job:

1. valida tag y secrets;
2. ejecuta `npm ci` y `npm run check`;
3. construye el NSIS y `latest.yml`;
4. firma metadata con Ed25519;
5. valida PE, tamaño, SHA-512 y evidencia;
6. crea un release privado de GitHub como borrador;
7. sube instalador, blockmap y `latest.yml`;
8. publica el borrador y lo marca como último release.

Mientras el release sea borrador, el Worker no puede observarlo. La publicación final es el interruptor de activación. Cada release y sus tres assets son inmutables; no se usa `--clobber` ni se reemplazan assets.

Si falla antes de crear el borrador, no hay publicación parcial. Si falla después, inspeccionar el borrador privado y eliminarlo sólo tras confirmar que nunca fue publicado; después puede reejecutarse el mismo tag sin cambiar bytes. Si el código debe cambiar, crear commit y tag superior.

## Bootstrap Manual De `1.1.5`

`1.0.0` no contiene updater. Por eso `1.1.5` necesita una instalación manual única:

1. Verificar backend, Worker y secrets.
2. Publicar `v1.1.5` y comprobar que el release privado quedó activo con los tres assets.
3. Descargar `Vibe-IDE-Code-Setup-1.1.5.exe` desde el release privado, sin exponer tokens.
4. Distribuirlo por el canal privado aprobado y ejecutarlo sobre `1.0.0`.
5. Aceptar conscientemente `Editor desconocido`, confirmar versión `1.1.5`, reautenticación y estado `current` para una cuenta `active`.
6. Registrar qué equipos completaron el bootstrap; Storage por sí solo no actualiza `1.0.0`.

No publicar `v1.1.6` como validación general hasta disponer de una instalación real y funcional de `1.1.5`.

## Prueba Real `1.1.5` A `1.1.6`

1. Partir de `1.1.5` instalada manualmente.
2. Confirmar `current` con una cuenta de prueba entitled.
3. Preparar y publicar `v1.1.6`.
4. Confirmar instalador, blockmap y `latest.yml` en el release privado.
5. Reiniciar `1.1.5`; debe mostrar `available` para `1.1.6` sin opción de omitir.
6. Descargar hasta `downloaded`.
7. Cancelar una vez la protección de trabajo sin guardar; no debe instalar ni desbloquear.
8. Guardar, reiniciar e instalar; confirmar arranque en `1.1.6` y estado `current`.
9. Confirmar que una cuenta no entitled obtiene `403` del Worker.
10. Conservar evidencia sin credenciales.

## Rollback

El rollback es siempre forward-only. Si `1.1.6` es defectuosa, aplicar la corrección sobre código conocido, publicar como mínimo `1.1.7` y conservar releases anteriores para descargas en curso y auditoría. Nunca bajar versión, mover tags o editar assets activos.

## Recuperación

| Síntoma | Diagnóstico Y Recuperación |
| --- | --- |
| Worker devuelve `401` | JWT ausente o inválido; reautenticar. |
| Worker devuelve `403` | Perfil, rol, plan o suscripción no cumplen entitlement. |
| Worker devuelve `404` | Release/tag o asset no publicado; comprobar nombre canónico. |
| Worker devuelve `502/503` | Revisar Supabase, GitHub, secrets y despliegue del Worker. |
| Workflow deja borrador | Confirmar que nunca se publicó; eliminar sólo ese borrador y reejecutar el mismo tag inmutable. |
| `UPDATE_CHECK_FAILED` no obligatorio | Corregir red/Auth y esperar 15 minutos o reiniciar. |
| `UPDATE_DOWNLOAD_FAILED` obligatorio | Verificar assets, `Range`, Worker y entitlement; usar Reintentar. |
| `UPDATE_INSTALL_FAILED` | Revisar espacio, permisos y antivirus; instalar el mismo artefacto aprobado o uno superior. |
| Firma interna inválida | Detener publicación y comprobar correspondencia de claves Ed25519. |
| Release defectuosa activa | Publicar inmediatamente una versión SemVer superior. |

Durante incidentes no incluir JWT, tokens de GitHub, claves privadas, URLs firmadas ni rutas locales sensibles en tickets o artifacts.
