"use client"

import { useEffect, useRef, useState } from "react"
import {
  ORBIT_STRIDE,
  parseFixed,
  precisionFor,
  referenceOrbit,
} from "@/lib/mandelbrot/math"
import {
  advance,
  iterationLimit,
  magnification,
  OCTAVES_PER_SECOND,
  pickPreset,
  spanAt,
  wantedKeyframes,
} from "@/lib/mandelbrot/journey"
import { ZOOM_PRESETS, type ZoomPreset } from "@/lib/mandelbrot/presets"
import { fractalStore } from "./fractal-store"

// How it draws
// ------------
// A true deep zoom: the centre's orbit is computed in arbitrary precision on
// the CPU (lib/mandelbrot/math.ts) and uploaded as a float texture; the
// fragment shader then iterates every pixel as a small difference from that
// orbit (perturbation theory with rebasing), which stays accurate far past the
// point where plain floats run out of digits.
//
// That is too expensive to do for every pixel on every frame, so the zoom is
// drawn as keyframes, one per octave, each rendered once in small tiles spread
// over many frames. The screen shows the current keyframe scaled up with the
// next, sharper one blended into the middle.

const ORBIT_WIDTH = 1024
const STORAGE_KEY = "iterations:fractal"
const HOLD_SECONDS = 5
const FADE_SECONDS = 1.6
const TILE_ROWS = 16
/** Resolution scale and samples per pixel, cheapest first. */
const QUALITY = [
  { scale: 0.5, samples: 1 },
  { scale: 0.7, samples: 1 },
  { scale: 1, samples: 1 },
  { scale: 1, samples: 2 },
  { scale: 1, samples: 4 },
]

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0., 1.); }`

const KEYFRAME = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D orbit;
uniform int orbitLength;
uniform int maxIterations;
uniform int samples;
uniform vec2 resolution;
uniform float mantissa;
uniform int exponent;
out vec4 outColor;

const vec2 OFFSETS[4] = vec2[4](
  vec2(.125, .375), vec2(-.125, -.375), vec2(.375, -.125), vec2(-.375, .125));

// (re mantissa, im mantissa, binary exponent)
vec3 reference(int m) {
  return texelFetch(orbit, ivec2(m & ${ORBIT_WIDTH - 1}, m >> ${Math.log2(ORBIT_WIDTH)}), 0).xyz;
}

// 2^e built from its bit pattern, so it is exact on every GPU; 0 once that is
// too small for a float.
float power(int e) {
  return e < -126 ? 0. : intBitsToFloat((e + 127) << 23);
}

vec2 value(vec3 entry) {
  return entry.xy * power(int(entry.z));
}

// The pixel is at centre + c * 2^exponent. d is its distance from the
// reference orbit in units of 2^e. See perturb() in lib/mandelbrot/math.ts,
// which is this loop in TypeScript.
float escapeTime(vec2 c) {
  vec2 d = vec2(0.);
  int e = exponent;
  float scale = power(e);
  int m = 0;
  vec3 entry = reference(0);
  vec2 Z = value(entry);
  for (int n = 0; n < maxIterations; n++) {
    d = 2. * vec2(Z.x * d.x - Z.y * d.y, Z.x * d.y + Z.y * d.x)
      + scale * vec2(d.x * d.x - d.y * d.y, 2. * d.x * d.y) + c;
    m++;
    entry = reference(m);
    Z = value(entry);
    vec2 z = Z + scale * d;
    float magnitude = dot(z, z);
    if (magnitude > 65536.) return float(n) + 2. - log2(log2(magnitude));
    vec2 w = entry.xy * power(clamp(int(entry.z) - e, -60, 60)) + d;
    if (m == orbitLength - 1 || dot(w, w) < dot(d, d)) {
      d = w;
      m = 0;
      entry = reference(0);
      Z = value(entry);
    }
    if (dot(d, d) > 1099511627776.) {
      d *= 9.5367431640625e-7;
      c *= 9.5367431640625e-7;
      e += 20;
      scale = power(e);
    }
  }
  return -1.;
}

vec3 shade(float v) {
  vec3 interior = vec3(.008, .009, .012);
  if (v < 0.) return interior;
  float t = sqrt(v);
  float band = .5 + .5 * cos(t * 1.9);
  float slow = .5 + .5 * cos(t * .23 + 1.3);
  float light = pow(band, 2.2) * (.35 + .65 * slow);
  float fade = clamp((v - 2.) / 10., 0., 1.);
  return interior + fade * (vec3(.024, .031, .043) + light * vec3(.59, .63, .675));
}

void main() {
  vec3 sum = vec3(0.);
  for (int s = 0; s < samples; s++) {
    vec2 jitter = samples == 1 ? vec2(0.) : OFFSETS[s];
    vec2 uv = (gl_FragCoord.xy + jitter - .5 * resolution) / resolution.y;
    sum += shade(escapeTime(uv * mantissa));
  }
  outColor = vec4(sum / float(samples), 1.);
}`

const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D base;
uniform sampler2D overlay;
uniform vec2 resolution;
uniform float shrink;
uniform float baseAspect;
uniform float overlayAspect;
uniform float overlayOn;
uniform float fade;
out vec4 outColor;
void main() {
  vec2 q = (gl_FragCoord.xy - .5 * resolution) / resolution.y;
  vec2 b = q * shrink;
  vec3 color = texture(base, vec2(b.x / baseAspect, b.y) + .5).rgb;
  // The next keyframe covers the middle at twice the detail.
  vec2 o = vec2(2. * b.x / overlayAspect, 2. * b.y);
  vec3 sharp = texture(overlay, o + .5).rgb;
  float edge = .5 - max(abs(o.x), abs(o.y));
  color = mix(color, sharp, overlayOn * smoothstep(0., .08, edge));
  color *= fade * (1. - .3 * smoothstep(.35, 1.3, length(q)));
  float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  outColor = vec4(color + (noise - .5) / 255., 1.);
}`

type Keyframe = {
  index: number
  texture: WebGLTexture
  width: number
  height: number
  samples: number
  limit: number
  x: number
  y: number
  stale: boolean
  started: number
  interrupted: boolean
}

function readLast() {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function remember(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Private mode: the next reload may repeat a preset, nothing else breaks.
  }
}

/** `?fractal=<preset id>&at=<octave>` opens a chosen zoom at a chosen depth. */
function requested() {
  const query = new URLSearchParams(window.location.search)
  const preset = ZOOM_PRESETS.find((item) => item.id === query.get("fractal"))
  const at = Number(query.get("at"))
  return { preset, at: Number.isFinite(at) && at > 0 ? at : 0 }
}

function createRenderer(canvas: HTMLCanvasElement, reducedMotion: boolean) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  })
  if (!gl) return null

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return shader
  }
  const link = (fragment: string) => {
    const program = gl.createProgram()!
    const vs = compile(gl.VERTEX_SHADER, VERTEX)
    const fs = compile(gl.FRAGMENT_SHADER, fragment)
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, "position")
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(
        "Fractal background disabled:",
        gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(program)
      )
      return null
    }
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    const uniforms: Record<string, WebGLUniformLocation | null> = {}
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(program, i)!.name
      uniforms[name] = gl.getUniformLocation(program, name)
    }
    return { program, uniforms }
  }
  const keyframeProgram = link(KEYFRAME)
  const compositeProgram = link(COMPOSITE)
  if (!keyframeProgram || !compositeProgram) return null

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  )
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const framebuffer = gl.createFramebuffer()
  const orbitTexture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, orbitTexture)
  for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
    gl.texParameteri(gl.TEXTURE_2D, name, gl.NEAREST)

  let preset: ZoomPreset = ZOOM_PRESETS[0]
  let orbitLength = 0
  let position = 0
  let fade = 0
  let phase: "zoom" | "hold" | "out" = "zoom"
  let holdLeft = 0
  let labelIn = 0
  // Pixels × samples × iterations this GPU gets through per second, at the
  // share of each frame the zoom allows itself. 0 until one keyframe is timed.
  let throughput = 0
  let tilePixels = 8192
  let overhead = 0
  let sinceProbe = 0
  let pending: Keyframe | null = null
  const frames = new Map<number, Keyframe>()
  const sync = new Uint8Array(4)

  const drop = (frame: Keyframe) => gl.deleteTexture(frame.texture)

  function load(next: ZoomPreset, start = 0) {
    preset = next
    remember(preset.id)
    const bits = precisionFor(preset.depth + 2)
    const centre = {
      re: parseFixed(preset.re, bits),
      im: parseFixed(preset.im, bits),
    }
    const { orbit, length } = referenceOrbit(centre, bits, preset.period + 1)
    orbitLength = length
    const rows = Math.ceil(length / ORBIT_WIDTH)
    const data = new Float32Array(ORBIT_WIDTH * rows * 4)
    for (let i = 0; i < length; i++)
      data.set(orbit.subarray(i * ORBIT_STRIDE, (i + 1) * ORBIT_STRIDE), i * 4)
    gl!.bindTexture(gl!.TEXTURE_2D, orbitTexture)
    gl!.texImage2D(
      gl!.TEXTURE_2D,
      0,
      gl!.RGBA32F,
      ORBIT_WIDTH,
      rows,
      0,
      gl!.RGBA,
      gl!.FLOAT,
      data
    )
    frames.forEach(drop)
    frames.clear()
    if (pending) drop(pending)
    pending = null
    // With reduced motion the page gets one still from partway down.
    position = Math.min(
      preset.depth,
      start || (reducedMotion ? Math.round(preset.depth * 0.45) : 0)
    )
    fade = 0
    phase = "zoom"
  }

  /**
   * The best quality whose keyframe should still finish well inside the time
   * the camera takes to cross one octave: resolution is traded away on slow
   * GPUs, and spare time is spent on anti-aliasing on fast ones.
   */
  function chooseQuality(limit: number) {
    if (!throughput) return QUALITY[2]
    const allowed = (0.45 / OCTAVES_PER_SECOND) * throughput
    for (let i = QUALITY.length - 1; i > 0; i--) {
      const { scale, samples } = QUALITY[i]
      const cost = canvas.width * canvas.height * scale * scale * samples * limit
      if (cost <= allowed) return QUALITY[i]
    }
    return QUALITY[0]
  }

  function begin(index: number): Keyframe {
    const limit = iterationLimit(preset, index)
    const level = chooseQuality(limit)
    const width = Math.max(16, Math.round(canvas.width * level.scale))
    const height = Math.max(16, Math.round(canvas.height * level.scale))
    const texture = gl!.createTexture()!
    gl!.bindTexture(gl!.TEXTURE_2D, texture)
    gl!.texImage2D(
      gl!.TEXTURE_2D,
      0,
      gl!.RGBA8,
      width,
      height,
      0,
      gl!.RGBA,
      gl!.UNSIGNED_BYTE,
      null
    )
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    return {
      index,
      texture,
      width,
      height,
      samples: level.samples,
      limit,
      x: 0,
      y: 0,
      stale: false,
      started: performance.now(),
      interrupted: false,
    }
  }

  /**
   * Renders one tile of the keyframe in progress and waits for the GPU.
   * A probe is a single pixel: it measures what the wait costs by itself.
   */
  function renderTile(frame: Keyframe, probe = false) {
    const { program, uniforms } = keyframeProgram!
    // Small tiles are pieces of a 16-row band; once a whole band is cheap
    // the tile grows downwards instead.
    const whole = frame.x === 0 && tilePixels >= frame.width * TILE_ROWS
    const rows = probe
      ? 1
      : Math.min(
          frame.height - frame.y,
          whole ? Math.floor(tilePixels / frame.width) : TILE_ROWS
        )
    const columns = probe
      ? 1
      : whole
        ? frame.width
        : Math.min(
            frame.width - frame.x,
            Math.max(8, Math.round(tilePixels / TILE_ROWS))
          )
    const span = spanAt(frame.index)
    const started = performance.now()
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer)
    gl!.framebufferTexture2D(
      gl!.FRAMEBUFFER,
      gl!.COLOR_ATTACHMENT0,
      gl!.TEXTURE_2D,
      frame.texture,
      0
    )
    gl!.viewport(0, 0, frame.width, frame.height)
    gl!.enable(gl!.SCISSOR_TEST)
    gl!.scissor(frame.x, frame.y, columns, rows)
    gl!.useProgram(program)
    gl!.activeTexture(gl!.TEXTURE0)
    gl!.bindTexture(gl!.TEXTURE_2D, orbitTexture)
    gl!.uniform1i(uniforms.orbit, 0)
    gl!.uniform1i(uniforms.orbitLength, orbitLength)
    gl!.uniform1i(uniforms.maxIterations, frame.limit)
    gl!.uniform1i(uniforms.samples, frame.samples)
    gl!.uniform2f(uniforms.resolution, frame.width, frame.height)
    gl!.uniform1f(uniforms.mantissa, span.mantissa)
    gl!.uniform1i(uniforms.exponent, span.exponent)
    gl!.drawArrays(gl!.TRIANGLES, 0, 6)
    // Reading a pixel back blocks until the tile is really done, which is what
    // lets the tile size track how fast this GPU is.
    gl!.readPixels(frame.x, frame.y, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, sync)
    gl!.disable(gl!.SCISSOR_TEST)
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
    const elapsed = performance.now() - started
    if (probe) {
      overhead = elapsed
      return
    }
    // Aim for tiles that take the GPU about 4 ms, not counting the wait
    // itself, which can be long when the browser is busy with other things.
    const cost = Math.max(0.25, elapsed - overhead)
    tilePixels = Math.min(
      1 << 20,
      Math.max(1024, tilePixels * Math.min(1.5, Math.max(0.5, 4 / cost)))
    )
    frame.x += columns
    if (frame.x >= frame.width) {
      frame.x = 0
      frame.y += rows
    }
  }

  function finish(frame: Keyframe) {
    gl!.bindTexture(gl!.TEXTURE_2D, frame.texture)
    gl!.generateMipmap(gl!.TEXTURE_2D)
    const old = frames.get(frame.index)
    if (old) drop(old)
    frames.set(frame.index, frame)
    pending = null
    if (frame.interrupted) return
    const seconds = Math.max(0.01, (performance.now() - frame.started) / 1000)
    const measured =
      (frame.width * frame.height * frame.samples * frame.limit) / seconds
    throughput = throughput ? (throughput + measured) / 2 : measured
  }

  function work(budget: number) {
    const started = performance.now()
    const wanted = wantedKeyframes(position, preset)
    if (pending && !wanted.includes(pending.index)) {
      drop(pending)
      pending = null
    }
    frames.forEach((frame, index) => {
      if (index < wanted[0] || index > wanted[wanted.length - 1]) {
        drop(frame)
        frames.delete(index)
      }
    })
    while (performance.now() - started < budget) {
      if (!pending) {
        const next = wanted.find((k) => !frames.has(k) || frames.get(k)!.stale)
        if (next === undefined) return
        pending = begin(next)
      }
      if (sinceProbe-- <= 0) {
        renderTile(pending, true)
        sinceProbe = 24
      }
      renderTile(pending)
      if (pending.y >= pending.height) finish(pending)
    }
  }

  function ready() {
    const first = Math.min(Math.floor(position), preset.depth)
    if (!frames.has(first)) return first - 1
    let last = first
    while (frames.has(last + 1)) last++
    return last
  }

  function draw() {
    const first = Math.min(Math.floor(position), preset.depth)
    const base = frames.get(first)
    const overlay = frames.get(first + 1)
    gl!.viewport(0, 0, canvas.width, canvas.height)
    if (!base) {
      gl!.clearColor(0, 0, 0, 1)
      gl!.clear(gl!.COLOR_BUFFER_BIT)
      return
    }
    const { program, uniforms } = compositeProgram!
    gl!.useProgram(program)
    gl!.activeTexture(gl!.TEXTURE0)
    gl!.bindTexture(gl!.TEXTURE_2D, base.texture)
    gl!.activeTexture(gl!.TEXTURE1)
    gl!.bindTexture(gl!.TEXTURE_2D, (overlay ?? base).texture)
    gl!.activeTexture(gl!.TEXTURE0)
    gl!.uniform1i(uniforms.base, 0)
    gl!.uniform1i(uniforms.overlay, 1)
    gl!.uniform2f(uniforms.resolution, canvas.width, canvas.height)
    gl!.uniform1f(uniforms.shrink, 2 ** (first - position))
    gl!.uniform1f(uniforms.baseAspect, base.width / base.height)
    gl!.uniform1f(
      uniforms.overlayAspect,
      overlay ? overlay.width / overlay.height : 1
    )
    gl!.uniform1f(uniforms.overlayOn, overlay ? 1 : 0)
    gl!.uniform1f(uniforms.fade, fade * fade * (3 - 2 * fade))
    gl!.drawArrays(gl!.TRIANGLES, 0, 6)
  }

  const asked = requested()
  load(asked.preset ?? pickPreset(ZOOM_PRESETS, readLast()), asked.at)

  return {
    /** One animation frame. `seconds` is the time since the previous one. */
    frame(seconds: number) {
      const showing = ready() >= Math.min(Math.floor(position), preset.depth) + 1
      // Until the first picture is up, nothing else needs the frame time.
      work(showing ? Math.min(5, seconds * 300) : 12)
      if (phase === "out") {
        fade = Math.max(0, fade - seconds / FADE_SECONDS)
        if (fade === 0) load(pickPreset(ZOOM_PRESETS, preset.id))
      } else if (showing || fade > 0) {
        fade = Math.min(1, fade + seconds / FADE_SECONDS)
      }
      if (!reducedMotion) {
        if (phase === "zoom") {
          position = advance(position, seconds, ready(), preset.depth)
          if (position >= preset.depth - 0.004) {
            phase = "hold"
            holdLeft = HOLD_SECONDS
          }
        } else if (phase === "hold") {
          holdLeft -= seconds
          if (holdLeft <= 0) phase = "out"
        }
      }
      draw()
      labelIn -= seconds
      if (labelIn <= 0) {
        labelIn = 0.25
        fractalStore.setLabel(`${preset.name} · ${magnification(position)}`)
      }
    },
    /** True once a still picture is complete and nothing more will change. */
    settled() {
      return (
        reducedMotion &&
        fade === 1 &&
        !pending &&
        wantedKeyframes(position, preset).every(
          (k) => frames.has(k) && !frames.get(k)!.stale
        )
      )
    },
    /** The canvas changed size: redraw the keyframes at the new shape. */
    resized() {
      frames.forEach((frame) => (frame.stale = true))
      if (pending) drop(pending)
      pending = null
    },
    interrupted() {
      if (pending) pending.interrupted = true
    },
    dispose() {
      frames.forEach(drop)
      if (pending) drop(pending)
      gl.deleteTexture(orbitTexture)
      gl.deleteFramebuffer(framebuffer)
      gl.deleteBuffer(quad)
      gl.deleteProgram(keyframeProgram.program)
      gl.deleteProgram(compositeProgram.program)
    },
  }
}

/**
 * The page background: a fixed, full-viewport canvas behind everything.
 * Sections that should show it stay transparent and carry
 * `data-fractal-window`; while none of them is on screen the zoom sleeps.
 */
export default function Mandelbrot() {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Bumped when the GPU context comes back, to rebuild everything.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const renderer = createRenderer(element, motion.matches)
    if (!renderer) return

    let frame = 0
    let last = 0
    let visible = true
    let lost = false
    const idle = () =>
      lost || !visible || document.hidden || fractalStore.get().paused

    const tick = (now: number) => {
      frame = 0
      if (idle()) return
      renderer.frame(last ? Math.min((now - last) / 1000, 0.1) : 0)
      last = now
      if (!renderer.settled()) frame = requestAnimationFrame(tick)
    }
    const wake = () => {
      cancelAnimationFrame(frame)
      frame = 0
      last = 0
      renderer.interrupted()
      if (!idle()) frame = requestAnimationFrame(tick)
    }

    let width = 0
    let height = 0
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const resize = () => {
      const rect = element.getBoundingClientRect()
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        1.5,
        Math.sqrt(2_100_000 / Math.max(1, rect.width * rect.height))
      )
      const nextWidth = Math.max(1, Math.round(rect.width * ratio))
      const nextHeight = Math.max(1, Math.round(rect.height * ratio))
      if (nextWidth === width && nextHeight === height) return
      // Mobile browsers resize the viewport as their toolbars slide; only a
      // real change of shape is worth re-rendering the keyframes for.
      const reshaped =
        Math.abs(nextWidth - width) > 4 ||
        Math.abs(nextHeight / nextWidth - height / Math.max(1, width)) > 0.12
      width = element.width = nextWidth
      height = element.height = nextHeight
      if (reshaped) renderer.resized()
      wake()
    }
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(resize, width ? 200 : 0)
    })
    observer.observe(element)
    resize()

    const windows = document.querySelectorAll("[data-fractal-window]")
    const onScreen = new Set<Element>()
    const intersection = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) onScreen.add(entry.target)
        else onScreen.delete(entry.target)
      }
      visible = windows.length === 0 || onScreen.size > 0
      wake()
    })
    windows.forEach((node) => intersection.observe(node))

    const contextLost = (event: Event) => {
      event.preventDefault()
      lost = true
      cancelAnimationFrame(frame)
    }
    const contextRestored = () => setGeneration((value) => value + 1)
    element.addEventListener("webglcontextlost", contextLost)
    element.addEventListener("webglcontextrestored", contextRestored)
    document.addEventListener("visibilitychange", wake)
    const reload = () => setGeneration((value) => value + 1)
    motion.addEventListener("change", reload)
    // The store also carries the label, which changes several times a second;
    // only a change of the pause switch should restart the loop.
    let paused = fractalStore.get().paused
    const unsubscribe = fractalStore.subscribe(() => {
      if (paused === fractalStore.get().paused) return
      paused = !paused
      wake()
    })

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(resizeTimer)
      observer.disconnect()
      intersection.disconnect()
      unsubscribe()
      document.removeEventListener("visibilitychange", wake)
      motion.removeEventListener("change", reload)
      element.removeEventListener("webglcontextlost", contextLost)
      element.removeEventListener("webglcontextrestored", contextRestored)
      if (!lost) renderer.dispose()
    }
  }, [generation])

  return (
    <canvas
      key={generation}
      ref={canvas}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full bg-black"
    />
  )
}
