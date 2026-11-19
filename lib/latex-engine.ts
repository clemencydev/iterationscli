"use client"

// The TeX compiler: pdfLaTeX from TeX Live, compiled to WebAssembly and run
// in a Web Worker in this browser (the Siglum engine, public/latex/). Nothing
// about a document leaves the device; the only requests are for the engine
// itself and for the LaTeX packages a document loads.
//
// The engine's small scripts are served from /latex/. Its large runtime (the
// compiler and TeX Live, about 50 MB on first use) comes from /latex/releases/
// when `npm run latex:assets` has put it there, and otherwise from the engine
// project's own file server.

export type CompileResult = {
  ok: boolean
  pdf?: Uint8Array
  /** The TeX log, for lib/latex.ts's parseLog. */
  log: string
  /** How many times TeX ran (cross-references and bibliographies need several). */
  passes: number
  ms: number
  error?: string
  timedOut?: boolean
  cancelled?: boolean
}
export type CompileJob = {
  /** Every file of the document by its path from the document's folder. */
  files: Record<string, string | Uint8Array>
  /** Path of the file to compile. */
  main: string
  /** What the engine is doing, e.g. "Downloading package titlesec". */
  onProgress?: (message: string) => void
  signal?: AbortSignal
}
type Engine = {
  preload: () => Promise<void>
  compile: (
    job: CompileJob & { engine: "pdflatex"; useCache: boolean }
  ) => Promise<CompileResult>
  cancel: () => void
}

/** The engines this compiler really has. XeLaTeX and LuaLaTeX do not work in it yet. */
export const ENGINES = ["pdflatex"] as const
export const ENGINE_NAME = "pdfLaTeX · TeX Live 2026"

const BASE = "/latex/"
const READY = "iterations:latex-ready"
let engine: Promise<Engine> | null = null

async function start(): Promise<Engine> {
  // Loaded by address at run time, so the bundler never tries to build it.
  const address = `${BASE}latex-engine.js`
  const wrapper = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ address
  )) as {
    createLatexEngine: (options: Record<string, unknown>) => Engine
  }
  const { releaseId } = (await (await fetch(`${BASE}current.json`)).json()) as {
    releaseId: string
  }
  const local = await fetch(`${BASE}releases/${releaseId}/runtime.json`, {
    method: "HEAD",
  }).then(
    (response) => response.ok,
    () => false
  )
  const packages = process.env.NEXT_PUBLIC_LATEX_PACKAGES
  return wrapper.createLatexEngine({
    baseUrl: BASE,
    ...(local ? {} : { runtimeUrl: "hosted" }),
    ...(packages ? { packageProxyUrl: packages } : {}),
  })
}

const ready = () => {
  engine ??= start().catch((error) => {
    engine = null
    throw error
  })
  return engine
}

/** True once the engine has compiled something in this browser, so it is cached. */
export function engineCached() {
  try {
    return localStorage.getItem(READY) === "1"
  } catch {
    return false
  }
}

/** Compiles a document to PDF. Never rejects: failures come back in the result. */
export async function compileLatex(job: CompileJob): Promise<CompileResult> {
  try {
    const result = await (
      await ready()
    ).compile({ ...job, engine: "pdflatex", useCache: false })
    if (result.ok) {
      try {
        localStorage.setItem(READY, "1")
        void navigator.storage?.persist?.()
      } catch {
        // The engine still works; it is only not remembered as downloaded.
      }
    }
    return result
  } catch (error) {
    return {
      ok: false,
      log: "",
      passes: 0,
      ms: 0,
      error:
        error instanceof Error && error.message
          ? `The LaTeX engine could not start: ${error.message}`
          : "The LaTeX engine could not start. Check the connection and try again.",
    }
  }
}

/** Stops the compile in progress, if any. */
export function cancelCompile() {
  void engine?.then(
    (running) => running.cancel(),
    () => {}
  )
}
