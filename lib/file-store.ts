"use client"

// Where the bytes of imported files live: IndexedDB in this browser. The
// workspace only holds each file's description (lib/files.ts), so files are
// as large as the device allows and never bloat the synced workspace. They
// stay on this device until a storage service is connected.
import { useEffect, useState } from "react"

const DATABASE = "iterations-files"
const STORE = "blobs"

let opening: Promise<IDBDatabase> | null = null
function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  // A failed open (private mode, blocked storage) may work on a later try.
  opening.catch(() => {
    opening = null
  })
  return opening
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
) {
  return database().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = action(transaction.objectStore(STORE))
        transaction.oncomplete = () => resolve(request.result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
  )
}

const urls = new Map<string, Promise<string | null>>()

/** Stores a file's bytes and returns the key they are kept under. */
export async function putBlob(blob: Blob, key: string = crypto.randomUUID()) {
  try {
    await run("readwrite", (store) => store.put(blob, key))
  } catch (error) {
    throw new Error(
      error instanceof DOMException && error.name === "QuotaExceededError"
        ? "This browser has no room left for that file."
        : "This browser would not store the file. Private windows often block file storage."
    )
  }
  urls.delete(key)
  return key
}

export const getBlob = (key: string) =>
  run<Blob | undefined>("readonly", (store) => store.get(key)).catch(
    () => undefined
  )

/** A stored text file's contents; undefined when its bytes are not on this device. */
export const getText = (key: string) =>
  getBlob(key).then((blob) => blob?.text())

/** A stored file's bytes; undefined when they are not on this device. */
export const getBytes = (key: string) =>
  getBlob(key).then(async (blob) =>
    blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
  )

/** Removes stored bytes nothing refers to any more. Returns how many went. */
export async function pruneBlobs(keep: Set<string>) {
  const keys = await run("readonly", (store) => store.getAllKeys())
  const unused = keys.filter(
    (key): key is string => typeof key === "string" && !keep.has(key)
  )
  for (const key of unused) {
    await run("readwrite", (store) => store.delete(key))
    const url = await urls.get(key)
    if (url) URL.revokeObjectURL(url)
    urls.delete(key)
  }
  return unused.length
}

/** A URL for stored bytes, usable as an image, video or audio source. */
export function blobUrl(key: string) {
  let url = urls.get(key)
  if (!url) {
    url = getBlob(key).then((blob) =>
      blob ? URL.createObjectURL(blob) : null
    )
    urls.set(key, url)
  }
  return url
}

/**
 * The URL of a stored file: undefined while it loads, null when its bytes are
 * not on this device (the file was imported somewhere else).
 */
export function useBlobUrl(key: string | undefined) {
  const [state, setState] = useState<{ key?: string; url?: string | null }>({})
  useEffect(() => {
    if (!key) return
    let current = true
    void blobUrl(key).then((url) => {
      if (current) setState({ key, url })
    })
    return () => {
      current = false
    }
  }, [key])
  return state.key === key ? state.url : undefined
}

/** How much of the browser's storage allowance is in use, when it says. */
export async function storageEstimate() {
  try {
    const { usage, quota } = await navigator.storage.estimate()
    return usage !== undefined && quota ? { usage, quota } : null
  } catch {
    return null
  }
}

/** Asks the browser not to evict the stored files when space runs short. */
export function keepStorage() {
  try {
    void navigator.storage?.persist?.()
  } catch {
    // Best effort.
  }
}

/** The pixel size of an image or video file, when the browser can read it. */
export function mediaSize(file: Blob, kind = file.type.split("/")[0]): Promise<{ width: number; height: number; duration?: number } | null> {
  const url = URL.createObjectURL(file)
  const done = <T,>(value: T) => {
    URL.revokeObjectURL(url)
    return value
  }
  return new Promise((resolve) => {
    if (kind === "image") {
      const image = new Image()
      image.onload = () =>
        resolve(
          done(
            image.naturalWidth
              ? { width: image.naturalWidth, height: image.naturalHeight }
              : null
          )
        )
      image.onerror = () => resolve(done(null))
      image.src = url
    } else if (kind === "video") {
      const video = document.createElement("video")
      video.preload = "metadata"
      video.onloadedmetadata = () =>
        resolve(
          done(
            video.videoWidth
              ? { width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : undefined }
              : null
          )
        )
      video.onerror = () => resolve(done(null))
      video.src = url
    } else resolve(done(null))
  })
}

/** Hands the browser a file to save. */
export function download(name: string, content: Blob | string, type = "text/plain") {
  const url = URL.createObjectURL(
    typeof content === "string" ? new Blob([content], { type }) : content
  )
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
