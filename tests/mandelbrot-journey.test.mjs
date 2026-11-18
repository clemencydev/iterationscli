import test from "node:test"
import assert from "node:assert/strict"
import { createJourney } from "../components/marketing/mandelbrot-journey.ts"

test("crossing a chart boundary preserves the view in parent coordinates", () => {
  const journey = createJourney(() => 0.42)
  for (let i = 0; i < 18; i++) {
    const start = journey.advance(0)
    const remaining = Math.log2(start.span / (3 * start.target.scale)) / 0.32
    const before = journey.advance(remaining - 0.000001)
    const after = journey.advance(0.000002)
    assert.deepEqual(after.parent, before.target)
    assert.deepEqual(after.target, before.next)
    for (const [u, v] of [
      [0, 0],
      [-2, -0.5],
      [2, 0.5],
    ]) {
      const x =
        after.parent.x + (after.x + 0.55 + u * after.span) * after.parent.scale
      const y = after.parent.y + (after.y + v * after.span) * after.parent.scale
      assert.ok(
        Math.abs((before.x + u * before.span - x) / before.span) < 0.00001
      )
      assert.ok(
        Math.abs((before.y + v * before.span - y) / before.span) < 0.00001
      )
    }
  }
})

test("each batch visits six distinct destinations with no repeats across batches", () => {
  let seed = 47
  const journey = createJourney(() => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  })
  let view = journey.advance(0)
  let last
  for (let batch = 0; batch < 4; batch++) {
    const regions = new Set()
    for (let leg = 0; leg < 6; leg++) {
      assert.notEqual(view.target.x, last)
      last = view.target.x
      regions.add(last)
      view = journey.advance(
        Math.log2(view.span / (3 * view.target.scale)) / 0.32 + 0.000001
      )
    }
    assert.equal(regions.size, 6)
  }
})
