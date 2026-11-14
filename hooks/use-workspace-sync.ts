"use client"

import { useEffect, useRef, useState } from "react"
import {
  isWorkspace,
  normalizeWorkspace,
  type Workspace,
} from "@/lib/alpha"

/**
 * local       Cloud sync is not configured or unreachable — browser storage only.
 * signed-out  Supabase is configured but nobody is signed in — browser storage only.
 * synced / saving / error  Signed in; the workspace is mirrored to the account.
 */
export type SyncStatus =
  | "checking"
  | "local"
  | "signed-out"
  | "synced"
  | "saving"
  | "error"

const ENDPOINT = "/api/kamako/workspace"

/**
 * Mirrors the workspace to the signed-in account through /api/kamako/workspace.
 * Browser storage stays the source of truth whenever the cloud is unavailable,
 * so the workspace always works offline and without an account.
 */
export function useWorkspaceSync(
  workspace: Workspace,
  ready: boolean,
  onRemote: (workspace: Workspace) => void
): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>("checking")
  // Saving starts only after the account copy has been read once, so a failed
  // first read can never overwrite newer work stored in the account.
  const [connected, setConnected] = useState(false)
  const latest = useRef(workspace)
  const saved = useRef<Workspace | null>(null)
  const receive = useRef(onRemote)
  useEffect(() => {
    latest.current = workspace
    receive.current = onRemote
  })

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, {
          credentials: "include",
          signal: controller.signal,
        })
        if (!res.ok) return setStatus("error")
        const body = (await res.json()) as {
          configured?: boolean
          signedIn?: boolean
          workspace?: unknown
        }
        if (!body.configured) return setStatus("local")
        if (!body.signedIn) return setStatus("signed-out")
        const local = latest.current
        if (
          isWorkspace(body.workspace) &&
          (body.workspace.updated ?? "") >= (local.updated ?? "")
        ) {
          // The account copy is at least as new: adopt it.
          const remote = normalizeWorkspace(body.workspace)
          saved.current = remote
          receive.current(remote)
        }
        setConnected(true)
        setStatus("synced")
      } catch {
        if (!controller.signal.aborted) setStatus("local")
      }
    })()
    return () => controller.abort()
  }, [ready])

  useEffect(() => {
    if (!connected || saved.current === workspace) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setStatus("saving")
      try {
        const res = await fetch(ENDPOINT, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace }),
          signal: controller.signal,
        })
        if (res.status === 401) {
          setConnected(false)
          return setStatus("signed-out")
        }
        if (!res.ok) return setStatus("error")
        saved.current = workspace
        setStatus("synced")
      } catch {
        if (!controller.signal.aborted) setStatus("error")
      }
    }, 1200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [workspace, connected])

  return status
}
