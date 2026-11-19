#!/usr/bin/env node
// Downloads the Siglum TeX Live runtime (WASM engine + TeX Live bundles) into
//   <dest>/releases/<releaseId>/...   and writes <dest>/current.json
// Every file is checked against the SHA-256 in the release manifest.
//
// Usage:
//   node scripts/latex-assets.mjs [dest=public/latex] [--all] [--no-raw] [--from=github|cdn]
//
//   --no-raw     skip the *.raw bundle copies (~155 MB). Leaves ~127 MB.
//
//   dest         target folder, e.g. public/latex in a Next.js app
//   --all        also fetch LuaLaTeX / ConTeXt / OpTeX bundles (not used by
//                the pdflatex/xelatex wrapper; ~21.6 MB more)
//   --from=cdn   (default) download each file from packages.siglum.org
//   --from=github  download the single release tarball from GitHub Releases
//                (216 MB) and extract it with the system `tar`
//
// Nothing here is bigger than 60 MB per file (cm-super.raw), so the result can
// live in git if you want, but it is ~282 MB: prefer running this script in
// CI / postinstall and keeping public/latex/releases/ in .gitignore.
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync, renameSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ENGINE_VERSION = "0.2.2" // must match the @siglum/engine version bundled in siglum-engine.js
const SERVICE = "https://packages.siglum.org"
const GITHUB = `https://github.com/SiglumProject/siglum/releases/download/v${ENGINE_VERSION}`
// Bundles only LuaLaTeX / ConTeXt / OpTeX use (tex-luatex is also requested by XeLaTeX, so keep it).
const OPTIONAL = /^(fmt-lualatex|tex-lualatex|tex-context|tex-optex)\./

const args = process.argv.slice(2)
const dest = path.resolve(args.find((a) => !a.startsWith("--")) ?? "engine")
const all = args.includes("--all")
// *.raw are uncompressed copies of each bundle used only for HTTP Range reads;
// no compile in the spike's test suite ever requested one. --no-raw saves ~155 MB.
const noRaw = args.includes("--no-raw")
const skip = (name) => (!all && OPTIONAL.test(name)) || (noRaw && name.endsWith(".raw"))
const from = (args.find((a) => a.startsWith("--from=")) ?? "--from=cdn").slice(7)

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { redirect: "follow" })
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      if (attempt >= 4) throw e
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

const descriptor = JSON.parse((await get(`${SERVICE}/engines/${ENGINE_VERSION}/latest.json`)).toString())
if (descriptor.engineVersion !== ENGINE_VERSION) throw new Error("engine version mismatch: " + descriptor.engineVersion)
const manifestBuf = await get(descriptor.manifestUrl)
if (sha256(manifestBuf) !== descriptor.manifestSha256) throw new Error("runtime.json checksum mismatch")
const manifest = JSON.parse(manifestBuf.toString())
const releaseDir = path.join(dest, "releases", manifest.releaseId)
mkdirSync(releaseDir, { recursive: true })
writeFileSync(path.join(releaseDir, "runtime.json"), manifestBuf)
console.log(`Siglum runtime ${manifest.releaseId} (TeX Live ${manifest.texLiveYear}, engine ${manifest.engineVersion}) -> ${releaseDir}`)

const wanted = Object.entries(manifest.files).filter(([name]) => !skip(name))

if (from === "github") {
  const tgz = path.join(dest, `siglum-runtime-v${ENGINE_VERSION}.tar.gz`)
  if (!existsSync(tgz)) { console.log("Downloading release tarball from GitHub..."); writeFileSync(tgz, await get(`${GITHUB}/siglum-runtime-v${ENGINE_VERSION}.tar.gz`)) }
  const sums = (await get(`${GITHUB}/SHA256SUMS`)).toString()
  const expected = sums.split("\n").find((l) => l.includes(".tar.gz"))?.split(/\s+/)[0]
  if (expected && sha256(readFileSync(tgz)) !== expected) throw new Error("tarball checksum mismatch")
  execFileSync("tar", ["xzf", tgz, "-C", releaseDir, "--exclude=._*"], { stdio: "inherit" })
  rmSync(tgz)
}

let bytes = 0, fetched = 0
const queue = [...wanted]
async function worker() {
  while (queue.length) {
    const [name, { size, sha256: hash }] = queue.shift()
    const file = path.join(releaseDir, name)
    if (existsSync(file) && statSync(file).size === size && sha256(readFileSync(file)) === hash) continue
    const buf = await get(`${descriptor.baseUrl}/${name}`)
    if (buf.length !== size || sha256(buf) !== hash) throw new Error(`checksum mismatch for ${name}`)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file + ".part", buf); renameSync(file + ".part", file)
    bytes += buf.length; fetched++
    process.stdout.write(`\r${fetched} files, ${(bytes / 1048576).toFixed(1)} MB   `)
  }
}
await Promise.all(Array.from({ length: 6 }, worker))
for (const [name] of Object.entries(manifest.files)) if (skip(name)) rmSync(path.join(releaseDir, name), { force: true })

writeFileSync(path.join(dest, "current.json"), JSON.stringify({ releaseId: manifest.releaseId, engineVersion: manifest.engineVersion, texLiveYear: manifest.texLiveYear }, null, 2) + "\n")
const total = wanted.reduce((s, [, f]) => s + f.size, 0)
console.log(`\nDone: ${wanted.length} files, ${(total / 1048576).toFixed(1)} MB on disk. Wrote ${path.join(dest, "current.json")}`)
