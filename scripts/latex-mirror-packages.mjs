#!/usr/bin/env node
// Builds a static, self-hosted replacement for the on-demand package proxy.
// The engine asks `${packageProxyUrl}/api/texlive/<pkg>?tlYear=2026` for a TeX
// Live package archive (.tar.xz) when a package is not in the static bundles.
// Siglum's proxy returns the unmodified TeX Live archive (verified byte-for-byte
// for titlesec), so a folder of archives served as static files is enough:
//
//   node scripts/latex-mirror-packages.mjs [dest=public/latex/pkgs] [pkg ...]
//   -> dest/api/texlive/<pkg>          (served by any static host; query string ignored)
//   createLatexEngine({ baseUrl: "/latex/", packageProxyUrl: location.origin + "/latex/pkgs" })
//
// CTAN mirrors send no CORS headers, so the browser cannot fetch them directly;
// this script copies them onto your own origin instead. Packages not mirrored
// simply fail with "File `x.sty' not found" (no third-party request is made).
// The default list is every package the spike's test suite pulled from the proxy.
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const YEAR = 2026 // must match the runtime's texLiveYear (engine/current.json)
const CURRENT = "https://tug.ctan.org/systems/texlive/tlnet"
const HISTORIC = `https://ftp.tu-chemnitz.de/pub/tug/historic/systems/texlive/${YEAR}/tlnet-final`
const DEFAULT = `beamer biblatex charter enumitem fontawesome5 fontawesome6 fontaxes fontspec helvetic logreq
marvosym mathpazo microtype moderncv multirow newtx palatino pdfcolmk pgf preprint times titlesec translator xcolor
xkeyval xpatch xstring binhex=kastrup`.split(/\s+/)

const [destArg, ...pkgs] = process.argv.slice(2)
const dest = path.resolve(destArg ?? "engine/pkgs", "api", "texlive")
mkdirSync(dest, { recursive: true })
// tlnet moves to the next TeX Live year every spring; use the frozen archive then.
const root = (await fetch(`${CURRENT}/TEXLIVE_${YEAR}`, { method: "HEAD" })).ok ? CURRENT : HISTORIC
console.log(`TeX Live ${YEAR} archives from ${root}`)
// "name=texlivepkg" stores a TeX Live package under the name the engine asks
// for. The real proxy resolves these through CTAN's API (/api/ctan-pkg), which a
// static mirror cannot answer: e.g. newtx needs binhex.tex, shipped in "kastrup".
for (const spec of pkgs.length ? pkgs : DEFAULT) {
  const [pkg, source = pkg] = spec.split("=")
  const file = path.join(dest, pkg)
  if (existsSync(file)) continue
  const r = await fetch(`${root}/archive/${source}.tar.xz`)
  if (!r.ok) { console.warn(`  ${pkg}: HTTP ${r.status} (skipped)`); continue }
  const buf = Buffer.from(await r.arrayBuffer())
  writeFileSync(file, buf)
  console.log(`  ${pkg}  ${(buf.length / 1024).toFixed(0)} KB`)
}
console.log(`done -> ${dest}`)
