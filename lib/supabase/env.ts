// One place that decides whether Supabase is configured. Nothing here throws at
// import time, so the app builds and runs (on local storage) without credentials.

export function supabaseEnv(): {
  url: string
  /** Publishable (anon) key. */
  key: string
  /** Key for server routes: the service role key when set, else the publishable key. */
  serverKey: string
} | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !(key || service)) return null
  return { url, key: key || service!, serverKey: service || key! }
}

export const isSupabaseConfigured = () => supabaseEnv() !== null

/** Supabase credentials, or a clear error naming what is missing. */
export function requireSupabaseEnv() {
  const env = supabaseEnv()
  if (!env)
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PUBLISHABLE_KEY (see README)."
    )
  return env
}

/** Account sessions are signed with this; without it nobody can be signed in. */
export const isAuthConfigured = () => !!process.env.JWT_SECRET
