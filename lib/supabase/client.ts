import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { requireSupabaseEnv } from './env'

/**
 * Supabase client for the server routes (app/api/*), scoped to the `iterations`
 * schema. Uses SUPABASE_SERVICE_ROLE_KEY when it is set, otherwise the
 * publishable key. Create one per request; never import this into a client
 * component.
 */
export function createClient() {
  const env = requireSupabaseEnv()
  return createSupabaseClient(env.url, env.serverKey, {
    db: { schema: "iterations" },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
