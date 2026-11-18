"use client"

import { useEffect, useRef, useState } from "react"
import { createJourney } from "./mandelbrot-journey"

const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`
const fragment = `
precision highp float;
uniform vec2 resolution;
uniform vec3 camera;
uniform vec3 parentChart;
uniform vec3 childChart;
uniform vec3 nextChart;
uniform vec2 childOffset;
const vec2 origin = vec2(-.55,0.);
bool insideChart(vec2 local) {
  return dot(local-origin,local-origin) <= 25.;
}
vec3 explore(vec2 c) {
  vec2 z = vec2(0.);
  float iterations = 0.;
  float radius = 0.;
  for(int i=0; i<420; i++) {
    z = vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y) + c;
    radius = dot(z,z);
    iterations = float(i);
    if(radius > 256.) break;
  }
  if(radius <= 256.) return vec3(.008,.009,.012);
  float smoothCount = iterations + 1. - log2(max(.001,log2(radius)));
  float bands = .5 + .5*cos(smoothCount*.14);
  vec3 low = vec3(.025,.03,.04);
  vec3 high = vec3(.58,.62,.67);
  vec3 color = mix(low,high,pow(bands,2.4));
  vec3 interior = vec3(.008,.009,.012);
  // The far exterior of each inset matches its host's solid interior.
  return mix(interior,color * (.45 + .55*smoothstep(0.,75.,smoothCount)),smoothstep(2.,8.,smoothCount));
}
void main(){
  vec2 uv = (gl_FragCoord.xy-.5*resolution)/resolution.y;
  vec2 c = camera.xy + uv*camera.z;
  // Work in bounded local coordinates at every depth. The two sides of a
  // handoff describe the same scene, including the parent on wide screens.
  if (!insideChart(c)) {
    c = parentChart.xy + (c-origin)*parentChart.z;
  } else {
    vec2 child = origin + childOffset + uv*(camera.z/childChart.z);
    if (insideChart(child)) {
      c = child;
      vec2 nested = origin + (child-nextChart.xy)/nextChart.z;
      if (insideChart(nested)) c = nested;
    }
  }
  vec3 color = explore(c);
  color *= 1.-.3*smoothstep(.3,1.4,length(uv));
  gl_FragColor=vec4(color,1.);
}`

export default function Mandelbrot() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const route = useRef<ReturnType<typeof createJourney> | null>(null)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const gl = element.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
    })
    if (!gl) return
    const shaders: WebGLShader[] = []
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
    }
    const program = gl.createProgram(),
      vs = compile(gl.VERTEX_SHADER, vertex),
      fs = compile(gl.FRAGMENT_SHADER, fragment)
    if (!program || !vs || !fs) {
      shaders.forEach((s) => gl.deleteShader(s))
      if (program) gl.deleteProgram(program)
      return
    }
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      shaders.forEach((s) => gl.deleteShader(s))
      return
    }
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    const position = gl.getAttribLocation(program, "position")
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const resolution = gl.getUniformLocation(program, "resolution"),
      camera = gl.getUniformLocation(program, "camera"),
      parentChart = gl.getUniformLocation(program, "parentChart"),
      childChart = gl.getUniformLocation(program, "childChart"),
      nextChart = gl.getUniformLocation(program, "nextChart"),
      childOffset = gl.getUniformLocation(program, "childOffset")
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let frame = 0,
      last = 0,
      rendered = 0,
      visible = true,
      lost = false
    const journey = route.current ?? (route.current = createJourney())
    let pendingSeconds = 0
    const draw = () => {
      gl.viewport(0, 0, element.width, element.height)
      gl.uniform2f(resolution, element.width, element.height)
      const view = journey.advance(pendingSeconds)
      pendingSeconds = 0
      gl.uniform3f(camera, view.x, view.y, view.span)
      gl.uniform3f(parentChart, view.parent.x, view.parent.y, view.parent.scale)
      gl.uniform3f(childChart, view.target.x, view.target.y, view.target.scale)
      gl.uniform3f(nextChart, view.next.x, view.next.y, view.next.scale)
      gl.uniform2f(
        childOffset,
        (view.x - view.target.x) / view.target.scale,
        (view.y - view.target.y) / view.target.scale
      )
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    const tick = (now: number) => {
      frame = 0
      if (lost || !visible || document.hidden || paused || motion.matches) {
        last = 0
        return
      }
      if (last) pendingSeconds += Math.min((now - last) / 1000, 0.1)
      last = now
      if (now - rendered >= 1000 / 24) {
        draw()
        rendered = now
      }
      frame = requestAnimationFrame(tick)
    }
    const wake = () => {
      cancelAnimationFrame(frame)
      frame = 0
      last = 0
      if (!lost) {
        draw()
        frame = requestAnimationFrame(tick)
      }
    }
    const resize = () => {
      const rect = element.getBoundingClientRect()
      const ratio = Math.min(
        1,
        900 / Math.max(1, rect.width),
        650 / Math.max(1, rect.height)
      )
      element.width = Math.max(1, Math.round(rect.width * ratio))
      element.height = Math.max(1, Math.round(rect.height * ratio))
      wake()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      wake()
    })
    intersection.observe(element)
    const contextLost = (event: Event) => {
      event.preventDefault()
      lost = true
      cancelAnimationFrame(frame)
    }
    element.addEventListener("webglcontextlost", contextLost)
    document.addEventListener("visibilitychange", wake)
    motion.addEventListener("change", wake)
    resize()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      intersection.disconnect()
      document.removeEventListener("visibilitychange", wake)
      motion.removeEventListener("change", wake)
      element.removeEventListener("webglcontextlost", contextLost)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      shaders.forEach((s) => gl.deleteShader(s))
    }
  }, [paused])
  return (
    <>
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full bg-black"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.65),rgba(0,0,0,0.12))]"
      />
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
        aria-label={
          paused ? "Resume fractal animation" : "Pause fractal animation"
        }
        className="absolute right-5 bottom-5 z-10 border border-white/20 bg-black/60 px-3 py-2 font-mono text-[10px] text-white/70 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
      >
        {paused ? "▶ Resume" : "Ⅱ Pause"} zoom
      </button>
    </>
  )
}
