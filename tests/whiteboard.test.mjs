import test from "node:test"
import assert from "node:assert/strict"
import { initialWorkspace, execute, checkpoint, revert } from "../lib/alpha.ts"

test("wb add creates editable object types with stable IDs and opens canvas", () => {
  let w = initialWorkspace()
  for (const kind of ["sticky", "kanban", "arrow", "document"]) {
    const result = execute(w, `wb add ${kind} "My ${kind}"`)
    w = result.workspace
    assert.equal(result.view, "canvas")
    assert.equal(w.objects.at(-1).kind, kind)
    assert.equal(w.objects.at(-1).text, `My ${kind}`)
  }
  assert.equal(new Set(w.objects.map((o) => o.id)).size, 4)
  assert.deepEqual(JSON.parse(JSON.stringify(w)).objects, w.objects)
  assert.throws(() => execute(w, "wb add missing"), /Use wb add/)
  assert.equal(w.objects.length, 4)
})

test("whiteboard edits restore independently from saved snapshots", () => {
  let w = execute(initialWorkspace(), 'wb add sticky "Original"').workspace
  w = checkpoint(w, "Before editing")
  w.objects[0].text = "Changed"
  w.objects[0].x = -400
  const restored = revert(w, w.commits[0].id)
  assert.equal(restored.objects[0].text, "Original")
  assert.notEqual(restored.objects[0].x, -400)
  assert.equal(restored.commits[1].snapshot.objects[0].text, "Changed")
})

test("restoring a checkpoint from before objects existed starts with no objects", () => {
  let w = checkpoint(initialWorkspace(), "Old snapshot")
  delete w.commits[0].snapshot.objects
  w = execute(w, "wb add arrow").workspace
  w = revert(w, w.commits[0].id)
  assert.deepEqual(w.objects, [])
})
