// Each entry is the centre of a stable periodic component. Its child chart
// fits inside the component's dark interior, surrounded by its actual boundary.
// The scale maps one unit of the child chart into its parent's coordinates.
const regions = [
  [-0.12256117, 0.74486177, 0.015],
  [-1.75487767, 0, 0.0008],
  [-0.15652017, 1.03224711, 0.00032],
  [-0.50434018, 0.56276576, 0.006],
  [-0.1980421, 1.10026954, 0.00003],
  [-1.62541373, 0, 0.00018],
] as const

export type ZoomRegion = { x: number; y: number; scale: number }
const origin = -0.55
const initialSpan = 3
const octavesPerSecond = 0.32

export function createJourney(random = Math.random) {
  let bag: number[] = []
  let lastIndex = -1
  function pick(): ZoomRegion {
    if (!bag.length) {
      bag = regions.map((_, i) => i)
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[bag[i], bag[j]] = [bag[j], bag[i]]
      }
      if (bag.at(-1) === lastIndex) {
        const end = bag.length - 1
        ;[bag[0], bag[end]] = [bag[end], bag[0]]
      }
    }
    lastIndex = bag.pop()!
    const [x, y, scale] = regions[lastIndex]
    return { x, y: random() < 0.5 ? y : -y, scale }
  }
  let target = pick()
  let parent = target
  let next = pick()
  let depth = 0
  return {
    advance(seconds: number) {
      depth += seconds * octavesPerSecond
      while (depth >= -Math.log2(target.scale)) {
        depth += Math.log2(target.scale)
        parent = target
        target = next
        next = pick()
      }
      const zoom = 2 ** -depth
      // Finish steering early. Zero pan velocity at either end keeps the
      // camera tangent continuous when we change coordinate systems.
      const t = Math.min(1, depth / 3)
      const remaining = (1 - t) ** 3 * (1 + 3 * t)
      return {
        parent,
        target,
        next,
        x: target.x + (origin - target.x) * remaining,
        y: target.y * (1 - remaining),
        span: initialSpan * zoom,
      }
    },
  }
}
