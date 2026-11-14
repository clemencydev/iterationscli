import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/client"
import { isAuthConfigured, isSupabaseConfigured } from "@/lib/supabase/env"
import { decode_token } from "@/lib/crypt"
import { isWorkspace } from "@/lib/alpha"

// Cloud copy of the alpha workspace: one JSON document per signed-in account
// (table iterations.workspaces, see supabase/schema.sql).
//
// GET always answers 200 and says why there is nothing to sync, so a workspace
// that is simply local does not log failed requests:
//   { configured: false }                 Supabase or JWT_SECRET is not set
//   { configured: true, signedIn: false } nobody is signed in
// PUT answers 503 / 401 in those cases.

const MAX_BYTES = 4_000_000

async function account(req: NextRequest) {
  if (!isSupabaseConfigured() || !isAuthConfigured())
    return {
      error: NextResponse.json(
        { configured: false, message: "Cloud sync is not configured." },
        { status: 503 }
      ),
    }
  try {
    const { user_id } = await decode_token(req)
    if (user_id === undefined || user_id === null) throw new Error("No user")
    return { user_id }
  } catch {
    return {
      error: NextResponse.json(
        { configured: true, message: "Sign in to sync this workspace." },
        { status: 401 }
      ),
    }
  }
}

export async function GET(req: NextRequest) {
  const who = await account(req)
  if (who.error)
    return NextResponse.json({
      configured: who.error.status !== 503,
      signedIn: false,
    })
  try {
    const { data, error } = await createClient()
      .from("workspaces")
      .select("data, updated_at")
      .eq("user_id", who.user_id)
      .maybeSingle()
    if (error) throw error
    return NextResponse.json({
      configured: true,
      signedIn: true,
      workspace: data?.data ?? null,
      updated_at: data?.updated_at ?? null,
    })
  } catch (error) {
    console.error("GET /api/kamako/workspace failed:", error)
    return NextResponse.json(
      { configured: true, message: "Could not load the saved workspace." },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest) {
  const who = await account(req)
  if (who.error) return who.error
  let workspace: unknown
  try {
    const raw = await req.text()
    if (raw.length > MAX_BYTES)
      return NextResponse.json(
        { message: "Workspace is too large to sync." },
        { status: 413 }
      )
    workspace = (JSON.parse(raw) as { workspace?: unknown }).workspace
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  if (!isWorkspace(workspace))
    return NextResponse.json(
      { message: "That is not a workspace." },
      { status: 400 }
    )
  try {
    const updated_at = new Date().toISOString()
    const { error } = await createClient()
      .from("workspaces")
      .upsert(
        { user_id: who.user_id, data: workspace, updated_at },
        { onConflict: "user_id" }
      )
    if (error) throw error
    return NextResponse.json({ configured: true, updated_at })
  } catch (error) {
    console.error("PUT /api/kamako/workspace failed:", error)
    return NextResponse.json(
      { configured: true, message: "Could not save the workspace." },
      { status: 500 }
    )
  }
}
