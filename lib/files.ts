// The workspace's file explorer: folders (which can be colored and can belong
// to a ticket) and imported files. Only the description of a file lives in
// the workspace; its bytes are kept on the device (lib/file-store.ts). Pure,
// so it runs under `node --test`.
import type { Workspace } from "./alpha.ts"
import type { Annotation } from "./annotations.ts"

export type Folder = {
  id: string
  name: string
  /** Folder it sits in; missing means the top level. */
  parent?: string
  color?: string
  /** Video whose imported clips live here. */
  videoId?: string
  /** The ticket this folder belongs to. A ticket has at most one. */
  taskId?: string
}
export type FileKind = "image" | "video" | "audio" | "text" | "pdf" | "other"
export type FileEntry = {
  id: string
  name: string
  mime: string
  size: number
  /** Key of the bytes in this device's file store; a copy shares its original's. */
  blob: string
  folder?: string
  created: string
  /** Pixel size of an image or video, when known. */
  width?: number
  height?: number
  duration?: number
  /** Tickets this file is tied to, besides the one its folder belongs to. */
  taskIds?: string[]
  /** The file this is an annotated copy of. */
  copyOf?: string
  annotation?: Annotation
}

export const FOLDER_COLORS = [
  "#9aa0a6",
  "#f87171",
  "#fbbf24",
  "#4ade80",
  "#60a5fa",
  "#c084fc",
  "#f472b6",
]
export const FILE_KINDS: FileKind[] = [
  "image",
  "video",
  "audio",
  "text",
  "pdf",
  "other",
]
const isHex = (value: unknown): value is string =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
const newId = () => crypto.randomUUID()
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const TEXT_TYPES =
  /^(txt|md|markdown|csv|tsv|json|xml|ya?ml|log|srt|vtt|edl|ini|toml|html?|css|jsx?|tsx?|py|rb|go|rs|java|c|h|cpp|cs|sh|ps1|sql)$/i

/** What kind of file this is, from its type and, failing that, its name. */
export function fileKind(mime: string, name = ""): FileKind {
  const extension = name.split(".").pop() ?? ""
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/pdf") return "pdf"
  if (mime.startsWith("text/") || mime === "application/json") return "text"
  if (/^(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(extension)) return "image"
  if (/^(mp4|webm|mov|m4v|mkv|ogv)$/i.test(extension)) return "video"
  if (/^(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(extension)) return "audio"
  if (/^pdf$/i.test(extension)) return "pdf"
  if (TEXT_TYPES.test(extension)) return "text"
  return "other"
}

/** 1536 → "1.5 KB". */
export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = Math.max(0, bytes),
    unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit && value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

// ---- Folders ---------------------------------------------------------------

/** A folder's name; a ticket's folder is called what the ticket is called. */
export function folderName(w: Pick<Workspace, "tasks">, folder: Folder) {
  return (
    (folder.taskId && w.tasks.find((t) => t.id === folder.taskId)?.title) ||
    folder.name
  )
}

/** "Design / Icons": a folder with the folders it is inside. */
export function folderPath(
  w: Pick<Workspace, "tasks" | "folders">,
  id: string | undefined
): string {
  const names: string[] = []
  const seen = new Set<string>()
  let folder = (w.folders ?? []).find((f) => f.id === id)
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id)
    names.unshift(folderName(w, folder))
    folder = (w.folders ?? []).find((f) => f.id === folder!.parent)
  }
  return names.join(" / ")
}

/** A folder and every folder inside it. */
export function folderTree(w: Pick<Workspace, "folders">, id: string) {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const folder of w.folders ?? [])
      if (folder.parent && ids.has(folder.parent) && !ids.has(folder.id)) {
        ids.add(folder.id)
        grew = true
      }
  }
  return ids
}

const siblingNamed = (
  w: Workspace,
  name: string,
  parent: string | undefined,
  except?: string
) =>
  (w.folders ?? []).some(
    (f) =>
      f.id !== except && f.parent === parent && same(folderName(w, f), name)
  )

export function addFolder(
  w: Workspace,
  name: string,
  options: Pick<Folder, "parent" | "color" | "taskId" | "videoId"> = {}
): { workspace: Workspace; id: string } {
  const value = name.trim()
  if (!value) throw new Error("A folder needs a name.")
  if (options.parent && !(w.folders ?? []).some((f) => f.id === options.parent))
    throw new Error("Folder not found.")
  if (options.color !== undefined && !isHex(options.color))
    throw new Error("Use a hex color such as #ff8800.")
  if (siblingNamed(w, value, options.parent))
    throw new Error("A folder with that name already exists there.")
  const folder: Folder = { id: newId(), name: value }
  if (options.videoId) folder.videoId = options.videoId
  if (options.parent) folder.parent = options.parent
  if (options.color) folder.color = options.color.toLowerCase()
  if (options.taskId) folder.taskId = options.taskId
  return {
    id: folder.id,
    workspace: { ...w, folders: [...(w.folders ?? []), folder] },
  }
}

/** Find the original video's clip folder, including when editing a saved copy. */
export function videoFolder(w: Workspace, video: FileEntry) {
  const owner = video.copyOf ?? video.id
  return (w.folders ?? []).find((folder) => folder.videoId === owner)
}

export function ensureVideoFolder(w: Workspace, id: string) {
  const file = (w.files ?? []).find((entry) => entry.id === id)
  if (!file || fileKind(file.mime, file.name) !== "video")
    throw new Error("Video not found.")
  const existing = videoFolder(w, file)
  if (existing) return { workspace: w, id: existing.id }
  const base = `${file.name} clips`
  let name = base
  for (let n = 2; siblingNamed(w, name, file.folder); n++) name = `${base} (${n})`
  return addFolder(w, name, { parent: file.folder, videoId: file.copyOf ?? file.id })
}

/** Renames, recolors, moves or reassigns a folder. `undefined` clears a field. */
export function updateFolder(
  w: Workspace,
  id: string,
  patch: Partial<Omit<Folder, "id">>
): Workspace {
  const folder = (w.folders ?? []).find((f) => f.id === id)
  if (!folder) throw new Error("Folder not found.")
  const next: Folder = { ...folder }
  if ("parent" in patch) {
    if (patch.parent && folderTree(w, id).has(patch.parent))
      throw new Error("A folder cannot be moved into itself.")
    if (patch.parent && !(w.folders ?? []).some((f) => f.id === patch.parent))
      throw new Error("Folder not found.")
    if (patch.parent) next.parent = patch.parent
    else delete next.parent
  }
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("A folder needs a name.")
    next.name = patch.name.trim()
  }
  if ("color" in patch) {
    if (patch.color === undefined) delete next.color
    else if (!isHex(patch.color))
      throw new Error("Use a hex color such as #ff8800, or reset.")
    else next.color = patch.color.toLowerCase()
  }
  if ("taskId" in patch) {
    if (patch.taskId && !w.tasks.some((t) => t.id === patch.taskId))
      throw new Error("Task not found.")
    if (patch.taskId) next.taskId = patch.taskId
    else delete next.taskId
  }
  if (
    (patch.name !== undefined || "parent" in patch) &&
    siblingNamed(w, folderName(w, next), next.parent, id)
  )
    throw new Error("A folder with that name already exists there.")
  return {
    ...w,
    folders: (w.folders ?? []).map((f) => {
      if (f.id === id) return next
      // A ticket has one folder: giving it this one takes it from any other.
      if (next.taskId && f.taskId === next.taskId) {
        const rest = { ...f }
        delete rest.taskId
        return rest
      }
      return f
    }),
  }
}

/** Removes a folder; what was in it moves up to the folder it sat in. */
export function deleteFolder(w: Workspace, id: string): Workspace {
  const folder = (w.folders ?? []).find((f) => f.id === id)
  if (!folder) throw new Error("Folder not found.")
  return {
    ...w,
    folders: (w.folders ?? [])
      .filter((f) => f.id !== id)
      .map((f) => {
        if (f.parent !== id) return f
        const next = { ...f }
        if (folder.parent) next.parent = folder.parent
        else delete next.parent
        return next
      }),
    files: (w.files ?? []).map((file) => {
      if (file.folder !== id) return file
      const next = { ...file }
      if (folder.parent) next.folder = folder.parent
      else delete next.folder
      return next
    }),
  }
}

export const ticketFolder = (w: Pick<Workspace, "folders">, taskId: string) =>
  (w.folders ?? []).find((f) => f.taskId === taskId)

/** The ticket's folder, made the first time something is put in it. */
export function ensureTicketFolder(
  w: Workspace,
  taskId: string
): { workspace: Workspace; id: string } {
  const task = w.tasks.find((t) => t.id === taskId)
  if (!task) throw new Error("Task not found.")
  const folder = ticketFolder(w, taskId)
  if (folder) return { workspace: w, id: folder.id }
  const id = newId()
  return {
    id,
    workspace: {
      ...w,
      folders: [...(w.folders ?? []), { id, name: task.title, taskId }],
    },
  }
}

/** Finds a folder by name, path ("Design / Icons"), full ID or unique ID prefix. */
export function findFolder(w: Workspace, ref: string | undefined): Folder {
  const key = (ref ?? "").trim()
  const folders = w.folders ?? []
  const squash = (path: string) => path.replace(/\s*\/\s*/g, "/")
  const named = folders.filter(
    (f) =>
      same(folderName(w, f), key) ||
      same(squash(folderPath(w, f.id)), squash(key))
  )
  if (named.length === 1) return named[0]
  const matches = folders.filter((f) => key && f.id.startsWith(key))
  if (matches.length !== 1)
    throw new Error(
      named.length > 1
        ? "Several folders have that name. Use its path or ID; `folder list` shows them."
        : "Name a folder by its name or ID. `folder list` shows them."
    )
  return matches[0]
}

// ---- Files -----------------------------------------------------------------

/** A name no other file in the folder has: "shot.png", "shot (2).png", … */
export function uniqueName(w: Workspace, name: string, folder?: string) {
  const taken = (candidate: string) =>
    (w.files ?? []).some((f) => f.folder === folder && same(f.name, candidate))
  if (!taken(name)) return name
  const dot = name.lastIndexOf(".")
  const [base, extension] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${extension}`
    if (!taken(candidate)) return candidate
  }
}

export function addFile(
  w: Workspace,
  file: Omit<FileEntry, "id" | "created"> & { id?: string }
): { workspace: Workspace; id: string } {
  if (!file.name.trim()) throw new Error("A file needs a name.")
  if (file.folder && !(w.folders ?? []).some((f) => f.id === file.folder))
    throw new Error("Folder not found.")
  const entry: FileEntry = {
    ...file,
    id: file.id ?? newId(),
    name: uniqueName(w, file.name.trim(), file.folder),
    created: new Date().toISOString(),
  }
  if (!entry.folder) delete entry.folder
  return {
    id: entry.id,
    workspace: { ...w, files: [...(w.files ?? []), entry] },
  }
}

export function updateFile(
  w: Workspace,
  id: string,
  patch: Partial<Omit<FileEntry, "id" | "blob" | "created">>
): Workspace {
  const file = (w.files ?? []).find((f) => f.id === id)
  if (!file) throw new Error("File not found.")
  const next: FileEntry = { ...file, ...patch }
  if (patch.name !== undefined && !patch.name.trim())
    throw new Error("A file needs a name.")
  if ("folder" in patch) {
    if (patch.folder && !(w.folders ?? []).some((f) => f.id === patch.folder))
      throw new Error("Folder not found.")
    if (!patch.folder) delete next.folder
  }
  if ("annotation" in patch && !patch.annotation) delete next.annotation
  if (patch.name !== undefined || "folder" in patch) {
    const others = { ...w, files: (w.files ?? []).filter((f) => f.id !== id) }
    next.name = uniqueName(others, next.name.trim(), next.folder)
  }
  return {
    ...w,
    files: (w.files ?? []).map((f) => (f.id === id ? next : f)),
  }
}

/** Removes a file from the explorer. Its place on the canvas says it is gone. */
export function deleteFile(w: Workspace, id: string): Workspace {
  if (!(w.files ?? []).some((f) => f.id === id))
    throw new Error("File not found.")
  return { ...w, files: (w.files ?? []).filter((f) => f.id !== id) }
}

/** Ties a file to a ticket, or unties it. */
export function tieFile(
  w: Workspace,
  fileId: string,
  taskId: string,
  tied = true
): Workspace {
  const file = (w.files ?? []).find((f) => f.id === fileId)
  if (!file) throw new Error("File not found.")
  if (!w.tasks.some((t) => t.id === taskId)) throw new Error("Task not found.")
  const ids = (file.taskIds ?? []).filter((id) => id !== taskId)
  return updateFile(w, fileId, { taskIds: tied ? [...ids, taskId] : ids })
}

/** The tickets a file belongs to: its folder's ticket and the ones it is tied to. */
export function fileTasks(
  w: Pick<Workspace, "folders" | "tasks">,
  file: FileEntry
): string[] {
  const ids = new Set(file.taskIds ?? [])
  const seen = new Set<string>()
  let folder = (w.folders ?? []).find((f) => f.id === file.folder)
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id)
    if (folder.taskId) ids.add(folder.taskId)
    folder = (w.folders ?? []).find((f) => f.id === folder!.parent)
  }
  return w.tasks.filter((t) => ids.has(t.id)).map((t) => t.id)
}

/** Every file of a ticket: in its folder (or a folder inside it) or tied to it. */
export function ticketFiles(
  w: Pick<Workspace, "folders" | "files" | "tasks">,
  taskId: string
) {
  return (w.files ?? []).filter((file) => fileTasks(w, file).includes(taskId))
}

/** The files straight inside a folder; `undefined` is the top level. */
export const folderFiles = (
  w: Pick<Workspace, "files">,
  folder: string | undefined
) => (w.files ?? []).filter((file) => file.folder === folder)

export type FileFilter = {
  /** Words that must all appear in the name, folder path or type. */
  query?: string
  kind?: FileKind | ""
  /** Only annotated copies, or only originals. */
  copies?: "only" | "hide"
}

/** Every file in the workspace that matches, whichever folder it is in. */
export function filterFiles(
  w: Pick<Workspace, "files" | "folders" | "tasks">,
  { query = "", kind = "", copies }: FileFilter
) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return (w.files ?? []).filter((file) => {
    if (kind && fileKind(file.mime, file.name) !== kind) return false
    if (copies === "only" && !file.copyOf) return false
    if (copies === "hide" && file.copyOf) return false
    if (!words.length) return true
    const haystack =
      `${file.name} ${folderPath(w, file.folder)} ${fileKind(file.mime, file.name)} ${file.mime}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** Finds a file by full ID, unique ID prefix or exact name. */
export function findFile(w: Workspace, ref: string | undefined): FileEntry {
  const key = (ref ?? "").trim()
  const files = w.files ?? []
  const exact = files.find((f) => f.id === key)
  if (exact) return exact
  const byId = files.filter((f) => key && f.id.startsWith(key))
  if (byId.length === 1) return byId[0]
  const named = files.filter((f) => same(f.name, key))
  if (named.length === 1) return named[0]
  throw new Error("Name a file by its ID or name. `files` lists them.")
}

/** "shot.png" → "shot (annotated).png". */
export function annotatedName(name: string) {
  if (/\(annotated\)/i.test(name)) return name
  const dot = name.lastIndexOf(".")
  return dot > 0
    ? `${name.slice(0, dot)} (annotated)${name.slice(dot)}`
    : `${name} (annotated)`
}

/** Where a file is in use: the tickets it is tied to and its canvas items. */
export function filePlaces(w: Pick<Workspace, "objects">, file: FileEntry) {
  return {
    tasks: file.taskIds ?? [],
    objects: w.objects.filter((o) => o.kind === "file" && o.fileId === file.id),
  }
}

/**
 * Saves an annotation as a copy of the file, beside the original in the
 * explorer. With `tie`, the copy also goes everywhere the original is: the
 * same tickets, and next to each of the original's canvas items.
 */
export function saveAnnotatedCopy(
  w: Workspace,
  fileId: string,
  annotation: Annotation,
  { tie = true }: { tie?: boolean } = {}
): { workspace: Workspace; id: string } {
  const original = (w.files ?? []).find((f) => f.id === fileId)
  if (!original) throw new Error("File not found.")
  const places = filePlaces(w, original)
  const added = addFile(w, {
    name: annotatedName(original.name),
    mime: original.mime,
    size: original.size,
    blob: original.blob,
    folder: original.folder,
    width: original.width,
    height: original.height,
    duration: original.duration,
    copyOf: original.id,
    annotation,
    ...(tie && places.tasks.length ? { taskIds: [...places.tasks] } : {}),
  })
  if (!tie || !places.objects.length) return added
  return {
    id: added.id,
    workspace: {
      ...added.workspace,
      objects: [
        ...added.workspace.objects,
        ...places.objects.map((o) => ({
          ...o,
          id: newId(),
          fileId: added.id,
          x: o.x + o.width + 40,
          locked: undefined,
          generatedFor: undefined,
        })),
      ],
    },
  }
}

// ---- LaTeX documents -------------------------------------------------------
// A LaTeX document is a folder: its main .tex file plus whatever that pulls in
// (chapters, images, a bibliography, a class file), the way a project is in
// Overleaf. Paths inside it are relative to that folder.

/** A LaTeX source file that can be compiled or \input. */
export const isTexFile = (name: string) => /\.(tex|ltx)$/i.test(name)
/** Any file TeX reads as text and the editor can open. */
export const isTexSource = (name: string) =>
  /\.(tex|ltx|sty|cls|bib|bst|def|cfg|clo|bbx|cbx|tikz|txt|md)$/i.test(name)
/** The type recorded for a text file made in the editor. */
export const textMime = (name: string) =>
  /\.bib$/i.test(name)
    ? "text/x-bibtex"
    : /\.(tex|ltx|sty|cls)$/i.test(name)
      ? "text/x-tex"
      : "text/plain"

/**
 * The folder a file's document lives in: the outermost folder around it that
 * holds a .tex file, or the file's own folder. `undefined` is the top level.
 */
export function fileProject(
  w: Pick<Workspace, "folders" | "files">,
  fileId: string
): string | undefined {
  const file = (w.files ?? []).find((f) => f.id === fileId)
  let root = file?.folder
  const seen = new Set<string>()
  let folder = (w.folders ?? []).find((f) => f.id === file?.folder)
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id)
    if (folderFiles(w, folder.id).some((f) => isTexFile(f.name)))
      root = folder.id
    folder = (w.folders ?? []).find((f) => f.id === folder!.parent)
  }
  return root
}

/**
 * The LaTeX documents in the workspace: each folder that holds a .tex file
 * and is not inside another one that does. Loose .tex files at the top level
 * count as one more, with `folder` undefined.
 */
export function texProjects(w: Pick<Workspace, "folders" | "files" | "tasks">) {
  const holds = (id: string | undefined) =>
    folderFiles(w, id).some((f) => isTexFile(f.name))
  const inside = (folder: Folder) => {
    const seen = new Set<string>()
    let parent = (w.folders ?? []).find((f) => f.id === folder.parent)
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id)
      if (holds(parent.id)) return true
      parent = (w.folders ?? []).find((f) => f.id === parent!.parent)
    }
    return false
  }
  const projects: { folder: string | undefined; name: string }[] = (
    w.folders ?? []
  )
    .filter((folder) => holds(folder.id) && !inside(folder))
    .map((folder) => ({ folder: folder.id, name: folderPath(w, folder.id) }))
  if (holds(undefined))
    projects.push({ folder: undefined, name: "Loose files" })
  return projects
}

/**
 * Every file of a document with its path from the document's folder
 * ("main.tex", "chapters/intro.tex"). At the top level, only loose files.
 */
export function projectFiles(
  w: Pick<Workspace, "folders" | "files">,
  root: string | undefined
): { file: FileEntry; path: string }[] {
  if (root === undefined)
    return folderFiles(w, undefined).map((file) => ({ file, path: file.name }))
  const tree = folderTree(w, root)
  const prefix = (id: string | undefined) => {
    const names: string[] = []
    let folder = (w.folders ?? []).find((f) => f.id === id)
    while (folder && folder.id !== root) {
      names.unshift(folder.name)
      folder = (w.folders ?? []).find((f) => f.id === folder!.parent)
    }
    return names.map((name) => `${name}/`).join("")
  }
  return (w.files ?? [])
    .filter((file) => file.folder !== undefined && tree.has(file.folder))
    .map((file) => ({ file, path: prefix(file.folder) + file.name }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

type NewFile = Pick<FileEntry, "mime" | "size" | "blob">

/**
 * Adds a file to a document at a path such as "chapters/intro.tex", making
 * the folders on the way. Refuses a path that is already taken.
 */
export function addProjectFile(
  w: Workspace,
  root: string | undefined,
  path: string,
  file: NewFile
): { workspace: Workspace; id: string } {
  const parts = path
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
  const name = parts.pop()
  if (!name) throw new Error("A file needs a name.")
  if (parts.some((part) => part === "." || part === ".."))
    throw new Error("Use a path inside the document, such as chapters/intro.tex.")
  if (projectFiles(w, root).some((f) => same(f.path, [...parts, name].join("/"))))
    throw new Error(`${[...parts, name].join("/")} already exists.`)
  let next = w
  let folder = root
  for (const part of parts) {
    const existing = (next.folders ?? []).find(
      (f) => f.parent === folder && same(f.name, part)
    )
    if (existing) folder = existing.id
    else {
      const made = addFolder(next, part, { parent: folder })
      next = made.workspace
      folder = made.id
    }
  }
  return addFile(next, { ...file, name, folder })
}

/**
 * Makes a new document: a top-level folder (its name made unique) holding
 * the given files at their paths. Returns each file's id by path.
 */
export function addProject(
  w: Workspace,
  name: string,
  files: (NewFile & { path: string })[]
): { workspace: Workspace; folder: string; ids: Record<string, string> } {
  const base = name.trim()
  if (!base) throw new Error("A document needs a name.")
  const taken = (candidate: string) =>
    (w.folders ?? []).some((f) => !f.parent && same(folderName(w, f), candidate))
  let title = base
  for (let n = 2; taken(title); n++) title = `${base} ${n}`
  const made = addFolder(w, title)
  let next = made.workspace
  const ids: Record<string, string> = {}
  for (const { path, ...file } of files) {
    const added = addProjectFile(next, made.id, path, file)
    next = added.workspace
    ids[path] = added.id
  }
  return { workspace: next, folder: made.id, ids }
}

/** Blob keys still in use by a workspace's files. */
export const usedBlobs = (w: Pick<Workspace, "files">) =>
  new Set((w.files ?? []).flatMap((file) => [file.blob, ...(file.annotation?.sources ?? []).map((s) => s.blob)]))

/** Drops references to a deleted ticket from folders and files. */
export function dropTaskRefs(w: Workspace, taskId: string): Workspace {
  return {
    ...w,
    folders: (w.folders ?? []).map((f) => {
      if (f.taskId !== taskId) return f
      const rest = { ...f }
      delete rest.taskId
      return rest
    }),
    files: (w.files ?? []).map((file) =>
      file.taskIds?.includes(taskId)
        ? { ...file, taskIds: file.taskIds.filter((id) => id !== taskId) }
        : file
    ),
  }
}

const isFolder = (value: unknown): value is Folder => {
  const f = value as Folder | null
  return !!f && typeof f.id === "string" && typeof f.name === "string"
}
const isFile = (value: unknown): value is FileEntry => {
  const f = value as FileEntry | null
  return (
    !!f &&
    typeof f.id === "string" &&
    typeof f.name === "string" &&
    typeof f.blob === "string" &&
    typeof f.mime === "string" &&
    typeof f.size === "number"
  )
}
/** Saved folders and files with anything malformed left out. */
export function normalizeFiles(saved: { folders?: unknown; files?: unknown }) {
  const folders = Array.isArray(saved.folders)
    ? saved.folders.filter(isFolder)
    : []
  const ids = new Set(folders.map((f) => f.id))
  return {
    folders,
    files: Array.isArray(saved.files)
      ? saved.files.filter(isFile).map((file) => {
          if (!file.folder || ids.has(file.folder)) return file
          const rest = { ...file }
          delete rest.folder
          return rest
        })
      : [],
  }
}

/** The explorer as text: folders with what is in them, then loose files. */
export function filesText(w: Workspace, query = "") {
  const short = (id: string) => id.slice(0, 8)
  const line = (file: FileEntry, indent: string) =>
    `${indent}${short(file.id)}  ${file.name}  ${fileKind(file.mime, file.name)} · ${formatBytes(file.size)}${file.copyOf ? " · annotated copy" : ""}`
  if (query.trim()) {
    const found = filterFiles(w, { query })
    return (
      found
        .map((file) => {
          const path = folderPath(w, file.folder)
          return `${line(file, "")}${path ? `  in ${path}` : ""}`
        })
        .join("\n") || `No file matches "${query.trim()}".`
    )
  }
  const lines: string[] = []
  const walk = (parent: string | undefined, depth: number) => {
    const indent = "  ".repeat(depth)
    for (const folder of (w.folders ?? []).filter((f) => f.parent === parent)) {
      lines.push(
        `${indent}${short(folder.id)}  ${folderName(w, folder)}/${folder.taskId ? "  (ticket)" : ""}${folder.color ? `  ${folder.color}` : ""}`
      )
      walk(folder.id, depth + 1)
    }
    for (const file of folderFiles(w, parent)) lines.push(line(file, indent))
  }
  walk(undefined, 0)
  return (
    lines.join("\n") ||
    'No files yet. Import some in Files (cd files), or make a folder: folder new "Name".'
  )
}
