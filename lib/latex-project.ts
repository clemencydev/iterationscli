"use client"

// Making and reading LaTeX documents: the part that touches this device's
// file store. What a document is (a folder of files) is in lib/files.ts.
import type { Workspace } from "./alpha"
import {
  addProject,
  addProjectFile,
  fileKind,
  isTexSource,
  projectFiles,
  textMime,
} from "./files"
import { getBytes, putBlob } from "./file-store"
import type { Template } from "./latex"

type Change = (
  fn: (current: Workspace) => Workspace,
  message?: string
) => boolean

/** Stores text as a file's contents and returns what the workspace records about it. */
async function store(name: string, text: string) {
  const blob = new Blob([text], { type: textMime(name) })
  return { mime: textMime(name), size: blob.size, blob: await putBlob(blob) }
}

/** Makes a document from a template. Returns its folder and main file, or null if it could not be made. */
export async function createLatexProject(
  change: Change,
  name: string,
  template: Template
): Promise<{ folder: string; file: string } | null> {
  const files = await Promise.all(
    template.files.map(async (file) => ({
      path: file.name,
      ...(await store(file.name, file.text)),
    }))
  )
  let made: { folder: string; file: string } | null = null
  change((current) => {
    const project = addProject(current, name, files)
    made = { folder: project.folder, file: project.ids[template.main] }
    return project.workspace
  }, `Created "${name.trim()}" from the ${template.name} template.`)
  return made
}

/** Adds an empty (or given) text file to a document. Returns its id, or null. */
export async function createProjectFile(
  change: Change,
  root: string | undefined,
  path: string,
  text = ""
): Promise<string | null> {
  const name = path.split("/").pop() ?? path
  const stored = await store(name, text)
  let id: string | null = null
  change((current) => {
    const added = addProjectFile(current, root, path, stored)
    id = added.id
    return added.workspace
  })
  return id
}

/** Files too large to be part of a document: video and audio are left out. */
const MAX_BYTES = 30_000_000

/**
 * A document's files as the compiler wants them: text files as text (from
 * `texts` when the editor holds a newer copy), everything else as bytes.
 * `missing` lists files whose contents are not on this device.
 */
export async function readProject(
  w: Workspace,
  root: string | undefined,
  texts: Record<string, string>
) {
  const files: Record<string, string | Uint8Array> = {}
  const missing: string[] = []
  for (const { file, path } of projectFiles(w, root)) {
    const kind = fileKind(file.mime, file.name)
    if (kind === "video" || kind === "audio" || file.size > MAX_BYTES) continue
    if (file.id in texts) {
      files[path] = texts[file.id]
      continue
    }
    const bytes = await getBytes(file.blob)
    if (!bytes) missing.push(path)
    else
      files[path] = isTexSource(file.name)
        ? new TextDecoder().decode(bytes)
        : bytes
  }
  return { files, missing }
}
