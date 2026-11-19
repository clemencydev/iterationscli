import test from "node:test"
import assert from "node:assert/strict"
import { readPlayhead, watchPlayhead, writePlayhead } from "../lib/video-playhead.ts"

test("a seek reaches the other view of the same file and a new view can read the latest frame", () => {
  const sender = Symbol("Annotate")
  const first = { source: 1, blob: "imported clip", seconds: 2.125, ended: false }
  const updates = []
  const stop = watchPlayhead("video", (position, from) => updates.push({ position, from }))
  const stopOther = watchPlayhead("another video", () => assert.fail("unrelated playhead"))
  try {
    writePlayhead("video", first, sender)
    const next = { ...first, seconds: 2.25 }
    writePlayhead("video", next, sender, false)
    assert.deepEqual(updates, [{ position: first, from: sender }])
    assert.deepEqual(readPlayhead("video"), next)
    stop()
    writePlayhead("video", { ...next, ended: true }, sender)
    assert.equal(updates.length, 1)
  } finally {
    stop()
    stopOther()
  }
})

test("positions survive remounts and invalid stored timestamps are ignored", (t) => {
  const memory = new Map()
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original)
    else delete globalThis.localStorage
  })
  const position = { source: 0, blob: "primary", seconds: 6.5, ended: true }
  writePlayhead("saved", position, Symbol())
  const stored = memory.get("iterations:video-playhead:saved")
  memory.set("iterations:video-playhead:restored", stored)
  assert.deepEqual(readPlayhead("restored"), position)
  memory.set("iterations:video-playhead:broken", JSON.stringify({ ...position, seconds: -1 }))
  assert.equal(readPlayhead("broken"), undefined)
})
