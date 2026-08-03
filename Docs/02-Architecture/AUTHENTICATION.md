# Vibe IDE Code Authentication

Authentication is owned by Electron main. The renderer never receives Supabase access or refresh tokens. The encrypted session is stored at `app.getPath('userData')/auth-session.bin` with Electron `safeStorage`.

On startup, the client migrates the previous encrypted record shape only when it represents a valid student account. It rebuilds the record with the current `account` shape, drops organization-specific fields, re-applies the seven-day lease cap, and persists the result. Previous legacy administrative roles are rejected rather than migrated.

## Runtime configuration

Set these environment variables before Electron starts:

- `VIBE_SUPABASE_URL`: Supabase project URL.
- `VIBE_SUPABASE_ANON_KEY`: public anon key. Never configure a service-role key in the desktop app.
- `VIBE_SUPABASE_MEMBERSHIP_RPC`: optional PostgREST RPC name; defaults to `get_desktop_access`. This legacy name is retained solely for technical compatibility with deployed configuration; it is not a product-domain concept. Application code treats it as the access RPC.
- `VIBE_AUTH_HELP_URL`: optional support URL.

The Supabase URL and anon key are required. Missing values return the explicit `AUTH_CONFIG_MISSING` state and disable login. Development reads process environment variables. Packaging runs `scripts/generate-auth-config.js` and embeds the public runtime configuration in the Electron bundle; the generated file is ignored by Git. A service-role key must never be provided to this script.

## Supabase contract

The desktop client uses standard Supabase Auth endpoints for password login and refresh. It then calls:

```http
POST /rest/v1/rpc/get_desktop_access
Authorization: Bearer <user access token>
apikey: <anon key>
Content-Type: application/json

{}
```

The RPC must derive the user from `auth.uid()` and must not trust a user ID supplied by the client. It returns one object, or a one-item array, with:

```json
{
  "role": "admin | student | instructor",
  "status": "pending | active | restricted | suspended | archived",
  "plan_id": "optional plan identifier",
  "plan_name": "optional plan name",
  "completed_lessons": 0,
  "total_lessons": 0,
  "progress_percentage": 0,
  "offline_lease_expires_at": "optional ISO-8601 timestamp"
}
```

`role` and `status` are required and describe the authenticated profile in the single platform. The client also accepts camelCase aliases for plan/progress fields and `account_role`/`account_status`. It does not consume organization or school fields. A server-provided lease may shorten offline access but cannot extend it beyond seven days from the last successful online access validation.

An HTTP-success response with a missing or unsupported role/status is authoritative invalid access. HTTP `401` and `403` responses during revalidation are also authoritative revocations. Both cases clear the local encrypted record and fail closed. Transport failures, `5xx`, and other non-authoritative remote failures retain a previously valid record, so its existing offline lease remains authoritative.

After a valid RPC response, main updates the in-memory record before writing encrypted storage. A filesystem failure therefore cannot retain a more permissive in-memory policy than the server returned. Logout also clears memory first and returns denied state even when durable removal fails; storage details are never exposed to the renderer.

The renderer receives only the normalized `account` (`role`, `status`, plan and progress fields), user ID/email, effective policy, and lease expiry. It never receives the Supabase refresh token.

## Effective policy

- `active`: `student` + `active` or `admin` + `active` while the lease is valid.
- `restricted`: a student with `pending` or `restricted` status, or an expired lease; the shell is visible but productive UI and mutating/execution IPC are blocked.
- `denied`: no valid session, invalid account data, `instructor`, any non-active `admin`, or a student with `suspended`/`archived` status.
- An expired seven-day offline lease produces `restricted`, not `denied`.

Restricted mode permits logout, revalidation, help, accessibility, and read-only IPC needed to render the existing shell. Authorization is enforced again in main, not only with a renderer overlay.

## Realtime enforcement

Electron main subscribes to `profiles` changes through Supabase Realtime, filtered by the authenticated user's `id`. Tokens remain in main and are never exposed through preload or renderer state.

Realtime payloads are only invalidation signals. On each signal, the client calls `get_desktop_access` again and applies that authoritative response. A transition away from productive access immediately terminates terminal and AI processes before notifying the renderer. The five-minute validation timer remains as a fallback when the Realtime connection is interrupted.

Student broadcast alerts subscribe only while the normalized account has role `student` and status `active`. Active administrators also subscribe to global pending student inserts in `profiles`; contact details are fetched separately with the administrator JWT so database RLS remains authoritative.
