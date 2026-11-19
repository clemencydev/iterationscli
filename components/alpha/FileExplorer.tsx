"use client"

// The Files view: every file imported into the workspace, in folders. Folders
// can be colored, nested and made a ticket's folder; each ticket has a folder
// of its own. The filter looks through every folder at once.
import { useEffect, useState, type DragEvent, type ReactNode } from "react"
import type { Workspace } from "@/lib/alpha"
import { describeAnnotation } from "@/lib/annotations"
import {
  addFolder,
  deleteFile,
  deleteFolder,
  ensureTicketFolder,
  FILE_KINDS,
  fileKind,
  fileTasks,
  filterFiles,
  FOLDER_COLORS,
  folderFiles,
  folderName,
  folderPath,
  folderTree,
  formatBytes,
  ticketFiles,
  ticketFolder,
  tieFile,
  updateFile,
  updateFolder,
  type FileEntry,
  type FileKind,
  type Folder,
} from "@/lib/files"
import { download, getBlob, storageEstimate } from "@/lib/file-store"
import Menu from "./Menu"
import { FileThumb } from "./Shapes"
import styles from "./files.module.css"

type Change = (
  fn: (current: Workspace) => Workspace,
  message?: string
) => boolean
/** What the explorer is showing: everything, a folder, or a ticket's folder. */
export type Place =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "task"; id: string }

const FILE_DRAG = "application/x-iterations-file"
const KIND_LABELS: Record<FileKind, string> = {
  image: "Images",
  video: "Video",
  audio: "Audio",
  text: "Text",
  pdf: "PDF",
  other: "Other",
}

export default function FileExplorer({
  w,
  change,
  place,
  onPlace,
  onImport,
  onAnnotate,
  onOpenTask,
  onCanvas,
  notify,
}: {
  w: Workspace
  change: Change
  place: Place
  onPlace: (place: Place) => void
  /** Imports files into a folder, or into a ticket's folder (made if needed). */
  onImport: (
    files: File[],
    where?: { folder?: string; taskId?: string }
  ) => Promise<string[]>
  onAnnotate: (fileId: string) => void
  onOpenTask: (id: string) => void
  /** Puts a file on the canvas. */
  onCanvas: (fileId: string) => void
  notify: (message: string) => void
}) {
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<FileKind | "">("")
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [showTickets, setShowTickets] = useState(true)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(
    null
  )
  const folders = w.folders ?? []
  const files = w.files ?? []
  const count = files.length
  useEffect(() => {
    let current = true
    void storageEstimate().then((estimate) => {
      if (current) setUsage(estimate)
    })
    return () => {
      current = false
    }
  }, [count])

  // A place that no longer exists (deleted folder or ticket) shows everything.
  const folder =
    place.type === "folder"
      ? folders.find((f) => f.id === place.id)
      : place.type === "task"
        ? ticketFolder(w, place.id)
        : undefined
  const task =
    place.type === "task"
      ? w.tasks.find((t) => t.id === place.id)
      : folder?.taskId
        ? w.tasks.find((t) => t.id === folder.taskId)
        : undefined
  const everything = !folder && !task
  const filtering = !!query.trim() || !!kind
  const matches = filterFiles(w, { query, kind })
  // Without a filter: what is straight inside the place. With one: every
  // match in the workspace, so nothing has to be hunted through folders.
  const here = folder ? folderFiles(w, folder.id) : []
  const tied = task
    ? ticketFiles(w, task.id).filter((f) => f.folder !== folder?.id)
    : []
  const shown = filtering ? matches : everything ? files : [...here, ...tied]
  const subfolders = filtering
    ? []
    : folders.filter((f) =>
        everything ? !f.parent && !f.taskId : f.parent === folder?.id
      )
  /** The folder new things go into here, made if this ticket has none yet. */
  const target = (current: Workspace) => {
    if (place.type === "task" && !ticketFolder(current, place.id))
      return ensureTicketFolder(current, place.id)
    return { workspace: current, id: folder?.id }
  }

  async function take(list: FileList | File[] | null, into?: string) {
    const picked = [...(list ?? [])]
    if (!picked.length) return
    setBusy(true)
    const destination = into || folder?.id
    await onImport(
      picked,
      destination
        ? { folder: destination }
        : place.type === "task"
          ? { taskId: place.id }
          : undefined
    )
    setBusy(false)
  }
  const moveFile = (fileId: string, to: string | undefined) =>
    change((current) => updateFile(current, fileId, { folder: to }))
  const dropOn = (to: string | undefined) => ({
    onDragOver: (e: DragEvent) => {
      if (
        !e.dataTransfer.types.includes(FILE_DRAG) &&
        !e.dataTransfer.types.includes("Files")
      )
        return
      e.preventDefault()
      e.stopPropagation()
      setOver(to ?? "")
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setOver(null)
      const id = e.dataTransfer.getData(FILE_DRAG)
      if (id) moveFile(id, to)
      else if (e.dataTransfer.files.length)
        void take(e.dataTransfer.files, to ?? "")
    },
  })
  const newFolder = (name: string) =>
    change((current) => {
      const base = target(current)
      return addFolder(base.workspace, name, { parent: base.id }).workspace
    })

  const swatches = (current: string | undefined, pick: (color?: string) => void) => (
    <span className={styles.colors} role="group" aria-label="Folder color">
      {FOLDER_COLORS.map((color) => (
        <button
          key={color}
          aria-label={`Color ${color}`}
          aria-pressed={current === color}
          title={color}
          style={{ background: color }}
          onClick={() => pick(color)}
        />
      ))}
      <input
        type="color"
        aria-label="Custom folder color"
        title="Custom color"
        value={current ?? FOLDER_COLORS[0]}
        onChange={(e) => pick(e.target.value)}
      />
      {current && (
        <button
          className={styles.reset}
          title="No color"
          onClick={() => pick(undefined)}
        >
          Reset
        </button>
      )}
    </span>
  )

  const treeRow = (f: Folder, depth: number): ReactNode => {
    const children = folders.filter((child) => child.parent === f.id)
    const open = !closed.has(f.id)
    const active = folder?.id === f.id
    return (
      <li key={f.id}>
        <div
          className={styles.treeRow}
          data-active={active ? "" : undefined}
          data-over={over === f.id ? "" : undefined}
          style={{ paddingLeft: 6 + depth * 14 }}
          {...dropOn(f.id)}
        >
          <button
            className={styles.twist}
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
            disabled={!children.length}
            onClick={() =>
              setClosed((prev) => {
                const next = new Set(prev)
                if (open) next.add(f.id)
                else next.delete(f.id)
                return next
              })
            }
          >
            {children.length ? (open ? "▾" : "▸") : "·"}
          </button>
          <button
            className={styles.treeName}
            aria-current={active ? "true" : undefined}
            onClick={() => onPlace({ type: "folder", id: f.id })}
          >
            <i
              className={styles.dot}
              style={f.color ? { background: f.color } : undefined}
            />
            <span>{folderName(w, f)}</span>
            <small>{folderFiles(w, f.id).length || ""}</small>
          </button>
        </div>
        {open && children.length > 0 && (
          <ul>{children.map((child) => treeRow(child, depth + 1))}</ul>
        )}
      </li>
    )
  }

  const fileRow = (file: FileEntry) => {
    const fileKindName = fileKind(file.mime, file.name)
    const path = folderPath(w, file.folder)
    const taskIds = fileTasks(w, file)
    const notes = describeAnnotation(file.annotation)
    return (
      <li
        key={file.id}
        className={styles.file}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(FILE_DRAG, file.id)
          e.dataTransfer.effectAllowed = "move"
        }}
      >
        <button
          className={styles.open}
          onClick={() => onAnnotate(file.id)}
          title="Open in Annotate"
        >
          <FileThumb file={file} className={styles.fileThumb} />
        </button>
        <div className={styles.fileText}>
          {renaming === file.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const name = String(
                  new FormData(e.currentTarget).get("name") ?? ""
                )
                if (change((current) => updateFile(current, file.id, { name })))
                  setRenaming(null)
              }}
            >
              <input
                name="name"
                required
                autoFocus
                defaultValue={file.name}
                aria-label={`Rename ${file.name}`}
                onBlur={() => setRenaming(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setRenaming(null)
                }}
              />
            </form>
          ) : (
            <button
              className={styles.fileName}
              onClick={() => onAnnotate(file.id)}
              title={file.name}
            >
              {file.name}
            </button>
          )}
          <small>
            {fileKindName} · {formatBytes(file.size)}
            {file.copyOf ? " · annotated copy" : ""}
            {notes ? ` · ${notes}` : ""}
            {(filtering || everything || file.folder !== folder?.id) && path
              ? ` · in ${path}`
              : ""}
          </small>
          {taskIds.length > 0 && (
            <span className={styles.tags}>
              {taskIds.map((id) => (
                <button
                  key={id}
                  onClick={() => onOpenTask(id)}
                  title="Open this ticket"
                >
                  {w.tasks.find((t) => t.id === id)?.title}
                </button>
              ))}
            </span>
          )}
        </div>
        <select
          className={styles.move}
          aria-label={`Move ${file.name}`}
          title="Move to a folder"
          value={file.folder ?? ""}
          onChange={(e) => moveFile(file.id, e.target.value || undefined)}
        >
          <option value="">Top level</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {folderPath(w, f.id)}
            </option>
          ))}
        </select>
        <Menu
          label={`${file.name} options`}
          className={styles.more}
          items={[
            { label: "Annotate", onSelect: () => onAnnotate(file.id) },
            { label: "Rename", onSelect: () => setRenaming(file.id) },
            { label: "Place on canvas", onSelect: () => onCanvas(file.id) },
            ...w.tasks
              .filter((t) => !taskIds.includes(t.id))
              .slice(0, 12)
              .map((t) => ({
                label: `Tie to: ${t.title}`,
                onSelect: () =>
                  void change((current) => tieFile(current, file.id, t.id)),
              })),
            ...(file.taskIds ?? []).flatMap((id) => {
              const tiedTo = w.tasks.find((t) => t.id === id)
              return tiedTo
                ? [
                    {
                      label: `Untie from: ${tiedTo.title}`,
                      onSelect: () =>
                        void change((current) =>
                          tieFile(current, file.id, id, false)
                        ),
                    },
                  ]
                : []
            }),
            {
              label: "Download",
              onSelect: () =>
                void getBlob(file.blob).then((blob) =>
                  blob
                    ? download(file.name, blob)
                    : notify("This file's contents are not on this device.")
                ),
            },
            {
              label: "Delete",
              danger: true,
              onSelect: () =>
                void change(
                  (current) => deleteFile(current, file.id),
                  `"${file.name}" deleted. Ctrl+Z brings it back.`
                ),
            },
          ]}
        >
          ⋯
        </Menu>
      </li>
    )
  }

  const title = filtering
    ? "Search results"
    : folder
      ? folderName(w, folder)
      : task
        ? task.title
        : "All files"
  const ticketFolders = folders.filter((f) => f.taskId && !f.parent)
  return (
    <section
      className={styles.explorer}
      data-over={over === "" ? "" : undefined}
      {...dropOn(folder?.id)}
    >
      <aside className={styles.tree} aria-label="Folders">
        <button
          className={styles.all}
          aria-current={everything ? "true" : undefined}
          data-over={over === "" ? "" : undefined}
          onClick={() => onPlace({ type: "all" })}
        >
          <span>All files</span>
          <small>{files.length}</small>
        </button>
        <p className={styles.caption}>FOLDERS</p>
        <ul>
          {folders
            .filter((f) => !f.parent && !f.taskId)
            .map((f) => treeRow(f, 0))}
        </ul>
        {!folders.some((f) => !f.taskId) && (
          <p className={styles.none}>No folders yet.</p>
        )}
        <button
          className={styles.caption}
          aria-expanded={showTickets}
          onClick={() => setShowTickets(!showTickets)}
          title="Every ticket has a folder of its own"
        >
          {showTickets ? "▾" : "▸"} TICKETS
        </button>
        {showTickets && (
          <ul>
            {ticketFolders.map((f) => treeRow(f, 0))}
            {w.tasks
              .filter((t) => !ticketFolder(w, t.id))
              .map((t) => (
                <li key={t.id}>
                  <div
                    className={styles.treeRow}
                    data-active={
                      place.type === "task" && place.id === t.id ? "" : undefined
                    }
                    data-ghost=""
                    style={{ paddingLeft: 6 }}
                  >
                    <span className={styles.twist}>·</span>
                    <button
                      className={styles.treeName}
                      onClick={() => onPlace({ type: "task", id: t.id })}
                      title="This ticket's folder. It is made when something goes in it."
                    >
                      <i className={styles.dot} />
                      <span>{t.title}</span>
                      <small>{ticketFiles(w, t.id).length || ""}</small>
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        )}
        {showTickets && !w.tasks.length && !ticketFolders.length && (
          <p className={styles.none}>No tickets yet.</p>
        )}
        <p className={styles.usage}>
          Files are stored in this browser, on this device.
          {usage &&
            ` ${formatBytes(usage.usage)} of ${formatBytes(usage.quota)} used.`}
        </p>
      </aside>
      <div className={styles.main}>
        <div className={styles.head}>
          <div>
            <p className={styles.eyebrow}>
              {folder?.parent
                ? folderPath(w, folder.parent)
                : task
                  ? "TICKET FOLDER"
                  : folder
                    ? "FOLDER"
                    : "EVERYTHING IN ONE PLACE"}
            </p>
            <h1>
              {folder && !filtering && (
                <i
                  className={styles.dot}
                  style={folder.color ? { background: folder.color } : undefined}
                />
              )}
              {title} <small>{shown.length}</small>
            </h1>
          </div>
          {task && !filtering && (
            <button onClick={() => onOpenTask(task.id)}>Open ticket ↗</button>
          )}
        </div>
        <div className={styles.toolbar}>
          <input
            aria-label="Filter all files"
            placeholder="Filter every folder by name, folder or type…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter by kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as FileKind | "")}
          >
            <option value="">All kinds</option>
            {FILE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {filtering && (
            <button
              onClick={() => {
                setQuery("")
                setKind("")
              }}
            >
              Clear filter
            </button>
          )}
          <label className={styles.import}>
            {busy ? "Importing…" : "Import files…"}
            <input
              type="file"
              multiple
              disabled={busy}
              onChange={(e) => {
                void take(e.target.files)
                e.target.value = ""
              }}
            />
          </label>
        </div>
        {!filtering && (
          <form
            className={styles.toolbar}
            onSubmit={(e) => {
              e.preventDefault()
              const form = e.currentTarget
              const name = String(new FormData(form).get("folder") ?? "")
              if (newFolder(name)) form.reset()
            }}
          >
            <input
              name="folder"
              required
              aria-label="New folder name"
              placeholder={
                folder || task ? "New folder in here…" : "New folder…"
              }
            />
            <button>+ Folder</button>
          </form>
        )}
        {folder && !filtering && (
          <div className={styles.folderBar}>
            {swatches(folder.color, (color) =>
              change((current) => updateFolder(current, folder.id, { color }))
            )}
            {renaming === folder.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = String(
                    new FormData(e.currentTarget).get("name") ?? ""
                  )
                  if (
                    change((current) =>
                      updateFolder(current, folder.id, { name })
                    )
                  )
                    setRenaming(null)
                }}
              >
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={folder.name}
                  aria-label="Folder name"
                  onBlur={() => setRenaming(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(null)
                  }}
                />
              </form>
            ) : (
              !folder.taskId && (
                <button onClick={() => setRenaming(folder.id)}>Rename</button>
              )
            )}
            <select
              aria-label="Ticket this folder belongs to"
              title="Make this the folder of a ticket"
              value={folder.taskId ?? ""}
              onChange={(e) =>
                change((current) =>
                  updateFolder(current, folder.id, {
                    taskId: e.target.value || undefined,
                  })
                )
              }
            >
              <option value="">Not a ticket&apos;s folder</option>
              {w.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  Ticket: {t.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Move this folder"
              title="Move this folder into another"
              value={folder.parent ?? ""}
              onChange={(e) =>
                change((current) =>
                  updateFolder(current, folder.id, {
                    parent: e.target.value || undefined,
                  })
                )
              }
            >
              <option value="">Top level</option>
              {folders
                .filter((f) => !folderTree(w, folder.id).has(f.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    In: {folderPath(w, f.id)}
                  </option>
                ))}
            </select>
            <button
              className={styles.danger}
              title="Its files and folders move up a level"
              onClick={() => {
                if (
                  change(
                    (current) => deleteFolder(current, folder.id),
                    "Folder deleted. What was in it moved up a level."
                  )
                )
                  onPlace(
                    folder.parent
                      ? { type: "folder", id: folder.parent }
                      : { type: "all" }
                  )
              }}
            >
              Delete folder
            </button>
          </div>
        )}
        {subfolders.length > 0 && (
          <ul className={styles.folders}>
            {subfolders.map((f) => (
              <li key={f.id}>
                <button
                  data-over={over === f.id ? "" : undefined}
                  onClick={() => onPlace({ type: "folder", id: f.id })}
                  {...dropOn(f.id)}
                >
                  <i
                    className={styles.dot}
                    style={f.color ? { background: f.color } : undefined}
                  />
                  <span>{folderName(w, f)}</span>
                  <small>
                    {folderFiles(w, f.id).length} file
                    {folderFiles(w, f.id).length === 1 ? "" : "s"}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {shown.length > 0 ? (
          <ul className={styles.files}>{shown.map(fileRow)}</ul>
        ) : (
          <div className={styles.empty}>
            {filtering
              ? "No file matches that filter."
              : files.length
                ? "Nothing in here yet."
                : "No files yet."}
            <span>
              {filtering
                ? "The filter looks through every folder in the workspace."
                : "Import files with the button above, or drop them here. Drag a file onto a folder to move it."}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
