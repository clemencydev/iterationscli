# iterationscli

A personal terminal, task board and whiteboard. Next.js 16, React 19, Tailwind 4.

- `/` — marketing page and the entry terminal (Ctrl+Y)
- `/alpha` — the workspace: terminal, task board, canvas, statistics, incoming, history, customize
- `/dashboard` — the signed-in account board

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm test           # node --test "tests/*.test.mjs"
npm run build
```

## Storage

The workspace always saves to the browser (`localStorage`), so it works with no
account and no backend. When Supabase is configured **and** you are signed in,
the same workspace is also mirrored to your account through
`/api/kamako/workspace`, and picked up on other devices. The status bar says
which mode is active.

## Supabase

Nothing is required to run locally. To turn on accounts and sync:

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor.
2. In Supabase: Project Settings → API → **Exposed schemas** → add `iterations`.
3. Copy `.env.example` to `.env.local` and fill it in (never commit it):

| Variable | Required | What it is |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Project URL, `https://<ref>.supabase.co`. `NEXT_PUBLIC_SUPABASE_URL` is also accepted. |
| `SUPABASE_SERVICE_ROLE_KEY` | recommended | Service role (secret) key. Server only. The schema enables row level security with no policies, so the server routes need this key. `SUPABASE_SECRET_KEY` is also accepted. |
| `SUPABASE_PUBLISHABLE_KEY` | alternative | Publishable / anon key, used when no service role key is set. Then you must also apply the commented-out "Alternative" grants at the bottom of `supabase/schema.sql`. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are also accepted. |
| `JWT_SECRET` | yes | Long random string that signs the sign-in cookie, e.g. `openssl rand -base64 48`. |

Restart the dev server after changing them. Sign up from the entry terminal
(`register`), open `/alpha`, and the status bar switches to "synced to your
account".

All Supabase access happens in server routes (`app/api/auth/*`,
`app/api/kamako/*`) through `lib/supabase/client.ts`; `lib/supabase/env.ts`
decides whether Supabase is configured.

## Terminal completion

Both terminals complete commands, subcommands and arguments from the command
registry in `contexts/TerminalContext/commands.ts` (engine: `lib/completion.ts`).
Tab completes, Tab again cycles, → accepts the dimmed inline suggestion.
