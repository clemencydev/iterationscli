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

## Fractal background

The marketing page sits on a real Mandelbrot deep zoom
(`components/marketing/Mandelbrot.tsx`, WebGL2). Each reload picks a different
destination from `lib/mandelbrot/presets.ts` and zooms from the whole set down
to a minibrot, as deep as a span of 1e-38. Plain floats give out around 1e-13,
so the centre's orbit is computed with BigInt fixed point
(`lib/mandelbrot/math.ts`) and the shader iterates each pixel as a small
difference from it (perturbation with rebasing).

The destinations are found, not hand-typed:
`node scripts/mandelbrot-presets.mjs` rewrites `presets.ts`
(`--preview <dir>` also writes PNG stills of each zoom).

## Terminal

The workspace terminal (`components/alpha/ShellTerminal.tsx`) is the keyboard
way into the board, tickets, canvas and history. It dresses as the shell of
the visitor's operating system: PowerShell on Windows, zsh on macOS, bash
elsewhere. `shell powershell|bash|zsh|auto` overrides that per device.

- **Commands** act on the workspace, not the machine: `board` (or `ls`),
  `task new|show|open|move|done|rename|comment`, `find`, `cd <view>`, `stats`,
  `log`, `revert`, `inbox`, `merge`. `help` lists them all. They live in
  `execute` in `lib/alpha.ts`; `cd board` keeps the terminal and shows the
  board beside it.
- **Keys**: Tab completes commands, subcommands and arguments (again to
  cycle), → accepts the dimmed suggestion, ↑/↓ recall history (kept across
  reloads), Ctrl+R searches it, Ctrl+L clears, Ctrl+C cancels, Ctrl+U/K cut
  the line, Esc empties it. Ctrl+Y opens the terminal as a window over any
  view and Ctrl+` jumps to the prompt.
- **Where things are**: prompts, startup text, line editing, history search
  and syntax colouring are pure functions in `lib/shell.ts`; completion is
  `lib/completion.ts`, driven by the command registry in
  `contexts/TerminalContext/commands.ts`. A command added to the registry
  completes and colours for free.
