// latex-engine.js: a small, framework-agnostic wrapper around the Siglum
// in-browser TeX Live engine (pdfTeX / XeTeX compiled to WebAssembly).
//
// Plain ES module. No bare imports, nothing for a bundler to resolve: the engine
// itself (siglum-engine.js + siglum-worker.js) is loaded at runtime from
// `baseUrl`, so Next.js / Turbopack never sees it.
//
//   const engine = createLatexEngine({ baseUrl: "/latex/" })
//   const result = await engine.compile({
//     files: { "main.tex": "...", "img/logo.png": bytes },
//     main: "main.tex",
//     engine: "pdflatex",            // "pdflatex" | "xelatex" | "auto"
//     onProgress: (message) => {},
//   })
//   // { ok, pdf?, log, passes, ms, error?, synctex?, cancelled?, timedOut? }
//   engine.cancel()   // abort the running compile (terminates the TeX worker)
//   engine.dispose()
//
// TeX runs in a dedicated Web Worker owned by Siglum. Siglum itself decides on
// and runs the extra LaTeX passes and bibtex (bibtex8). This wrapper adds:
// a compile queue, a hard timeout / cancel that kills and recreates the worker,
// friendly progress messages, a pass count, and a uniform result shape.

const DEFAULT_PROXY_HOST = "https://packages.siglum.org"

/**
 * @param {object} [options]
 * @param {string} [options.baseUrl="/latex/"]  Where engine/ is served (siglum-engine.js, siglum-worker.js, current.json, releases/...).
 * @param {string} [options.runtimeUrl]         Override the runtime directory (wasm/ + bundles). Default: `${baseUrl}releases/<releaseId>` from current.json.
 *                                              Pass "hosted" to load everything from Siglum's public CDN instead of your own server.
 * @param {string|null} [options.packageProxyUrl] On-demand package server for packages that are not in the static bundles.
 *                                              Default: Siglum's public proxy for the same release. `null` = offline-only (bundled packages only).
 *                                              A static mirror built by mirror-packages.mjs works too, e.g. "/latex/pkgs".
 * @param {number} [options.timeoutMs=180000]   Hard limit per compile; on expiry the worker is killed and recreated.
 * @param {(line: string) => void} [options.onLog] Raw engine log lines (debugging).
 * @param {object|string[]} [options.eagerBundles] Bundles to load up front, e.g. { pdflatex: ["cm-super"] }.
 * @param {string} [options.wasmUrl]            Override busytex.wasm location (must be the build matching the runtime).
 * @param {string} [options.jsUrl]              Override busytex.js location.
 */
export function createLatexEngine(options = {}) {
  const baseUrl = new URL(options.baseUrl ?? "/latex/", globalThis.location?.href).href.replace(/\/?$/, "/")
  const timeoutMs = options.timeoutMs ?? 180000
  let compiler = null
  let ready = null
  let disposed = false
  let queue = Promise.resolve()
  let current = null // { onProgress, lines, abort }

  async function setup() {
    const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ baseUrl + "siglum-engine.js")
    let runtime
    if (options.runtimeUrl === "hosted") {
      runtime = await mod.resolveRuntime()
    } else {
      let base = options.runtimeUrl
      let releaseId = null
      if (!base) {
        const pointer = await (await fetch(baseUrl + "current.json")).json()
        releaseId = pointer.releaseId
        base = baseUrl + "releases/" + releaseId
      }
      base = new URL(base, globalThis.location?.href).href.replace(/\/$/, "")
      releaseId ??= base.match(/\/releases\/([^/]+)$/)?.[1] ?? null
      const proxy = options.packageProxyUrl === undefined
        ? (releaseId ? `${DEFAULT_PROXY_HOST}/releases/${releaseId}` : null)
        : options.packageProxyUrl && new URL(options.packageProxyUrl, globalThis.location?.href).href.replace(/\/$/, "")
      runtime = {
        wasmUrl: `${base}/wasm/busytex.wasm`,
        jsUrl: `${base}/wasm/busytex.js`,
        bundlesUrl: base,
        ctanProxyUrl: proxy,
        xzwasmUrl: `${base}/xzwasm.js`,
        runtimeBase: base,
      }
    }
    if (options.wasmUrl) runtime.wasmUrl = new URL(options.wasmUrl, globalThis.location?.href).href
    if (options.jsUrl) runtime.jsUrl = new URL(options.jsUrl, globalThis.location?.href).href
    const c = new mod.SiglumCompiler({
      wasmUrl: runtime.wasmUrl,
      jsUrl: runtime.jsUrl,
      bundlesUrl: runtime.bundlesUrl,
      ctanProxyUrl: runtime.ctanProxyUrl ?? null,
      xzwasmUrl: runtime.xzwasmUrl,
      workerUrl: baseUrl + "siglum-worker.js",
      eagerBundles: options.eagerBundles ?? {},
      maxRetries: 15,
      verbose: false,
      onLog: handleLog,
      onProgress: (stage, detail) => report(detail || stage),
    })
    // The package index (file-to-package.json) ships with the static runtime,
    // so read it from there rather than from the proxy host.
    if (runtime.runtimeBase && c.ctanFetcher) c.ctanFetcher.bundlesUrl = runtime.runtimeBase
    await c.init()
    compiler = c
    return c
  }

  // Workarounds for missing-file cases Siglum 0.2.2's worker does not retry on
  // its own. Returns true when something new was loaded and a recompile makes sense.
  let fontIndex = null
  async function recover(c, engineName, rawText, tried) {
    // TeX hard-wraps log lines at 79 columns, so undo the wrapping first.
    const text = rawText + "\n" + rawText.replace(/\r?\n/g, "")
    let changed = false
    const addEager = (bundle) => {
      const e = Array.isArray(c.eagerBundles) ? { pdflatex: [...c.eagerBundles], xelatex: [...c.eagerBundles] } : { ...c.eagerBundles }
      e[engineName] = [...new Set([...(e[engineName] ?? []), bundle])]
      c.eagerBundles = e
    }
    // 1. T1/TS1 Computer Modern (ecrm*, tcrm*: \usepackage[T1]{fontenc} without
    //    lmodern, or any textcomp symbol) needs the deferred cm-super bundle,
    //    which the worker never requests ("Font tcrm1095 at 600 not found").
    if (/Font (?:ec|tc)[a-z]{2,4}\d{3,4} at \d+ not found/.test(text) && !tried.has("bundle:cm-super")) {
      tried.add("bundle:cm-super"); addEager("cm-super"); changed = true
      report("Downloading cm-super fonts (T1/TS1 Computer Modern, one-time ~60 MB)")
    }
    // 2. A package loads xcolor/graphicx indirectly, so the "graphics" bundle
    //    (color.cfg, pdftex.def, xetex.def) was not preselected.
    if (/No driver specified/.test(text) && !tried.has("bundle:graphics")) {
      tried.add("bundle:graphics"); addEager("graphics"); changed = true
      report("Loading graphics drivers")
    }
    // 3. Font metrics / Type 1 files of a TeX Live font package that is not
    //    bundled (times, helvetic, palatino, charter, urw fonts...).
    const fonts = new Set()
    for (const m of text.matchAll(/=([A-Za-z0-9_-]+) at [\d.]+pt not loadable: Metric \(TFM\) file not found/g)) fonts.add(m[1])
    for (const m of text.matchAll(/\(file ([A-Za-z0-9_-]+)\.(?:pfb|tfm|vf)\)/g)) fonts.add(m[1])
    for (const m of text.matchAll(/Font ([A-Za-z0-9_-]+) at \d+ not found/g)) if (!/^(?:ec|tc)[a-z]{2,4}\d/.test(m[1])) fonts.add(m[1])
    if (fonts.size) {
      fontIndex ??= await fetch(c.bundlesUrl + "/font-file-to-package.json").then((r) => r.json()).catch(() => ({}))
      for (const f of fonts) {
        const pkg = fontIndex[f] ?? fontIndex[f.replace(/\.(pfb|tfm|vf)$/, "")]
        if (!pkg || tried.has("pkg:" + pkg)) continue
        tried.add("pkg:" + pkg)
        if (c.bundleManager?.bundleExists?.(pkg)) { addEager(pkg); changed = true; continue }
        report(`Downloading font package ${pkg} (for ${f})`)
        try { if (await c.ctanFetcher.fetchPackage(pkg)) changed = true } catch {}
      }
    }
    return changed
  }

  function report(message) {
    try { current?.onProgress?.(message) } catch {}
  }

  function handleLog(line) {
    line = String(line)
    options.onLog?.(line)
    if (!current) return
    current.lines.push(line)
    let m
    if ((m = line.match(/\[TEXLIVE\] Fetching (\S+)/))) report(`Downloading package ${m[1]}`)
    else if ((m = line.match(/Missing: (\S+), (?:loading bundle|fetching) (\S+)/))) report(`Downloading ${m[2].replace(/\.\.\.$/, "")} (for ${m[1]})`)
    else if ((m = line.match(/Worker requested bundle: (\S+)/))) report(`Loading bundle ${m[1]}`)
    else if ((m = line.match(/^Pre-fetch: (.*)/))) report(`Packages: ${m[1]}`)
    else if (/Auto-rerun pass|Building bibliography|bibtex/i.test(line)) report(line.replace(/^\[[^\]]*\]\s*/, ""))
  }

  function ensureReady() {
    if (disposed) return Promise.reject(new Error("LaTeX engine disposed"))
    ready ??= setup().catch((e) => { ready = null; throw e })
    return ready
  }

  function killWorker() {
    if (!compiler) return
    const pending = compiler.pendingCompile
    compiler.pendingCompile = null
    compiler.terminate() // frees the WASM heap; the next compile spawns a fresh worker
    try { pending?.reject(new Error("cancelled")) } catch {}
  }

  async function runOne(job) {
    const t0 = performance.now()
    const lines = []
    let settleAbort
    const aborted = new Promise((resolve) => (settleAbort = resolve))
    current = { onProgress: job.onProgress, lines, abort: settleAbort }
    const finish = (extra) => ({ passes: 0, log: "", ...extra, ms: Math.round(performance.now() - t0) })
    const timer = setTimeout(() => settleAbort("timeout"), job.timeoutMs ?? timeoutMs)
    const onAbort = () => settleAbort("cancelled")
    job.signal?.addEventListener("abort", onAbort)
    try {
      if (job.signal?.aborted) return finish({ ok: false, cancelled: true, error: "cancelled" })
      report("Starting engine")
      const c = await Promise.race([ensureReady(), aborted.then((why) => { throw new Error(why) })])
      const mainPath = normalise(job.main ?? "main.tex")
      const extra = {}
      let source = null
      for (const [name, value] of Object.entries(job.files ?? {})) {
        const p = normalise(name)
        if (p === mainPath) source = typeof value === "string" ? value : new TextDecoder().decode(value)
        else extra[p] = typeof value === "string" ? value : new Uint8Array(value)
      }
      if (source == null) return finish({ ok: false, error: `main file ${mainPath} not found in files`, log: "" })
      const start = () => c.compile(source, {
        engine: job.engine ?? "pdflatex",
        mainFile: mainPath,
        additionalFiles: extra,
        useCache: job.useCache ?? true,
      })
      let run, outcome
      const tried = new Set()
      for (let attempt = 0; ; attempt++) {
        run = start()
        outcome = await Promise.race([run.then((r) => ({ r }), (e) => ({ e })), aborted.then((why) => ({ why }))])
        if (!outcome.r || outcome.r.success || attempt >= 4) break
        // Siglum's own retry loop misses some missing-file cases; fix them up
        // here and compile again (see recover()).
        const text = String(outcome.r.log ?? "") + "\n" + String(outcome.r.error ?? "")
        if (!(await recover(c, job.engine ?? "pdflatex", text, tried))) break
      }
      if (outcome.why) {
        killWorker()
        run.catch(() => {})
        return finish({
          ok: false, [outcome.why === "timeout" ? "timedOut" : "cancelled"]: true,
          error: outcome.why === "timeout" ? `Compile exceeded ${job.timeoutMs ?? timeoutMs} ms and was stopped` : "cancelled",
          log: lines.join("\n"),
        })
      }
      if (outcome.e) {
        killWorker()
        return finish({ ok: false, error: String(outcome.e?.message ?? outcome.e), log: lines.join("\n") })
      }
      const r = outcome.r
      const passes = countPasses(lines, r)
      const log = typeof r.log === "string" && r.log.length ? r.log : lines.join("\n")
      if (r.success && r.pdf?.byteLength) {
        return finish({ ok: true, pdf: r.pdf, log, passes, cached: !!r.cached, synctex: r.syncTexData ?? undefined, engineLog: lines.join("\n") })
      }
      return finish({ ok: false, error: r.error ?? "compile failed", log, passes, engineLog: lines.join("\n") })
    } catch (e) {
      const why = String(e?.message ?? e)
      if (why === "timeout" || why === "cancelled") killWorker()
      return finish({ ok: false, error: why, log: lines.join("\n"), timedOut: why === "timeout" || undefined, cancelled: why === "cancelled" || undefined })
    } finally {
      clearTimeout(timer)
      job.signal?.removeEventListener("abort", onAbort)
      current = null
    }
  }

  return {
    /** Starts downloading the engine (WASM + core bundles) without compiling. */
    preload: () => ensureReady().then(() => undefined),
    /** Queues a compile; compiles run one at a time. */
    compile(job) {
      const p = queue.then(() => runOne(job))
      queue = p.catch(() => {})
      return p
    },
    /** Stops the running compile (if any); its result resolves with cancelled: true. */
    cancel() { current?.abort("cancelled") },
    /** Clears cached on-demand packages (keeps WASM/bundles). */
    clearPackageCache: async () => (await ensureReady()).clearCache(),
    dispose() {
      disposed = true
      current?.abort("cancelled")
      try { compiler?.unload() } catch {}
      compiler = null
      ready = null
    },
  }
}

function normalise(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.?\/+/, "")
}


function countPasses(lines, r) {
  const text = lines.join("\n")
  const m = text.match(/Completed (\d+) passes/)
  if (m) return Number(m[1])
  if (r?.cached) return 0
  return r?.stats?.passes ?? 1
}
