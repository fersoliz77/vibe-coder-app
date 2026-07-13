# Vibe IDE Code Authentication

Authentication is owned by Electron main. The renderer never receives Supabase access or refresh tokens. The encrypted session is stored at `app.getPath('userData')/auth-session.bin` with Electron `safeStorage`.

## Runtime configuration

Set these environment variables before Electron starts:

- `VIBE_SUPABASE_URL`: Supabase project URL.
- `VIBE_SUPABASE_ANON_KEY`: public anon key. Never configure a service-role key in the desktop app.
- `VIBE_SUPABASE_MEMBERSHIP_RPC`: optional PostgREST RPC name; defaults to `get_desktop_access`.
- `VIBE_AUTH_HELP_URL`: optional support URL.

The Supabase URL and anon key are required. Missing values return the explicit `AUTH_CONFIG_MISSING` state and disable login. Development reads process environment variables. Packaging runs `scripts/generate-auth-config.js` and embeds the public runtime configuration in the Electron bundle; the generated file is ignored by Git. A service-role key must never be provided to this script.

## Supabase contract

The desktop client uses standard Supabase Auth endpoints for password login and refresh. It then calls:

```http
POST /rest/v1/rpc/{VIBE_SUPABASE_MEMBERSHIP_RPC}
Authorization: Bearer <user access token>
apikey: <anon key>
Content-Type: application/json

{}
```

The RPC must derive the user from `auth.uid()` and must not trust a user ID supplied by the client. It returns one object, or a one-item array, with:

```json
{
  "status": "pending | active | restricted | suspended | archived",
  "school_id": "uuid or null",
  "school_name": "display name or null",
  "plan_id": "uuid or null",
  "plan_name": "display name or null",
  "completed_lessons": 0,
  "total_lessons": 0,
  "progress_percentage": 0,
  "offline_lease_expires_at": "optional ISO-8601 timestamp"
}
```

`status` is required. The client accepts camelCase aliases for integration tolerance. A server-provided lease may shorten offline access but cannot extend it beyond seven days from the last successful online membership validation.

The first desktop dashboard and Settings consume plan and progress from this contract. They never query educational tables directly and never receive the Supabase refresh token.

## Effective policy

- `active`: full UI and IPC while the lease is valid.
- `restricted`: `pending` or `restricted`; the shell is visible but productive UI and mutating/execution IPC are blocked.
- `denied`: no valid session, invalid membership, `suspended`, or `archived`.
- An expired seven-day offline lease produces `restricted`, not `denied`.

Restricted mode permits logout, revalidation, help, accessibility, and read-only IPC needed to render the existing shell. Authorization is enforced again in main, not only with a renderer overlay.
