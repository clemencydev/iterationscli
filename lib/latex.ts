// LaTeX for the editor: reading a document's structure (outline, packages,
// inputs, bibliography), editing its preamble (packages, fonts), turning TeX
// logs into problems with plain-language hints, counting words, and the
// catalogs the editor offers (templates, packages, fonts, completions). Pure,
// so it runs under `node --test`.

export type TexEngine = "pdflatex" | "xelatex" | "lualatex"

// ---- Reading source --------------------------------------------------------

/** Environments whose content TeX does not read as commands. */
const VERBATIM_ENVS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "Verbatim*",
  "BVerbatim",
  "LVerbatim",
  "lstlisting",
  "minted",
  "comment",
  "filecontents",
  "filecontents*",
])
const LETTERS = /[a-zA-Z]+/y
const ENV_NAME = /\s*\{([^{}\n]*)\}/y

/**
 * The source with comments and verbatim text blanked out. It keeps the same
 * length and line breaks, so a position in it is a position in the source.
 */
export function maskSource(source: string): string {
  const out = source.split("")
  const n = source.length
  const clear = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++)
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " "
  }
  const after = (from: number, ch: string) => {
    const k = source.indexOf(ch, from)
    return k < 0 ? n : k + 1
  }
  let i = 0
  while (i < n) {
    const c = source[i]
    if (c === "%") {
      const end = source.indexOf("\n", i)
      const stop = end < 0 ? n : end
      clear(i, stop)
      i = stop
      continue
    }
    if (c !== "\\") {
      i++
      continue
    }
    LETTERS.lastIndex = i + 1
    const name = LETTERS.exec(source)?.[0]
    // A control symbol such as \% or \\: the next character is not special.
    if (!name) {
      i += 2
      continue
    }
    let j = i + 1 + name.length
    if (name === "verb" || name === "lstinline" || name === "mintinline") {
      if (name === "verb" && source[j] === "*") j++
      if (name !== "verb" && source[j] === "[") j = after(j, "]")
      if (name === "mintinline" && source[j] === "{") j = after(j, "}")
      const open = source[j]
      if (!open || /\s/.test(open)) {
        i = j
        continue
      }
      const close = open === "{" ? "}" : open
      let k = j + 1
      while (k < n && source[k] !== close && source[k] !== "\n") k++
      clear(j + 1, k)
      i = k + 1
      continue
    }
    if (name === "begin") {
      ENV_NAME.lastIndex = j
      const env = ENV_NAME.exec(source)
      const envName = env?.[1].trim()
      if (env && envName && VERBATIM_ENVS.has(envName)) {
        const start = j + env[0].length
        const end = source.indexOf(`\\end{${envName}}`, start)
        const stop = end < 0 ? n : end
        clear(start, stop)
        i = stop
        continue
      }
    }
    i = j
  }
  return out.join("")
}

function lineStarts(text: string) {
  const starts = [0]
  for (let i = 0; i < text.length; i++)
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

/** 1-based line of a position. */
function lineOf(starts: number[], index: number) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= index) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

type Command = { name: string; start: number; end: number }

/** Every command in masked text, skipping control symbols such as \\. */
function commandsIn(masked: string): Command[] {
  const out: Command[] = []
  for (const m of masked.matchAll(/\\(?:([a-zA-Z]+)|[\s\S])/g)) {
    const start = m.index ?? 0
    if (m[1]) out.push({ name: m[1], start, end: start + m[0].length })
  }
  return out
}

/** Spaces and at most one line break: a blank line ends a command's arguments. */
function skipSpaces(text: string, i: number) {
  let breaks = 0
  while (i < text.length) {
    const c = text[i]
    if (c === "\n") {
      if (++breaks > 1) break
    } else if (c !== " " && c !== "\t" && c !== "\r") break
    i++
  }
  return i
}

type Group = { start: number; end: number; text: string }

/** A {…} or […] group starting at `i`, with nested braces; undefined if none. */
function readGroup(
  text: string,
  i: number,
  open: "{" | "["
): Group | undefined {
  if (text[i] !== open) return undefined
  const close = open === "{" ? "}" : "]"
  let depth = 0
  for (let k = i + 1; k < text.length; k++) {
    const c = text[k]
    if (c === "\\") k++
    else if (c === "{") depth++
    else if (c === "}" && depth > 0) depth--
    else if (c === close && depth === 0)
      return { start: i, end: k + 1, text: text.slice(i + 1, k) }
    else if (c === "}") return undefined
  }
  return undefined
}

type Args = { star: boolean; args: (Group | undefined)[]; end: number }

/**
 * Reads a command's arguments after `from`. `spec` has one letter per
 * argument, as in xparse: "*" an optional star, "o" an optional [argument],
 * "m" a mandatory {argument}.
 */
function readArgs(text: string, from: number, spec: string): Args {
  let i = from
  let star = false
  const args: (Group | undefined)[] = []
  for (const s of spec) {
    const at = skipSpaces(text, i)
    if (s === "*") {
      if (text[at] === "*") {
        star = true
        i = at + 1
      }
      continue
    }
    const group = readGroup(text, at, s === "o" ? "[" : "{")
    args.push(group)
    if (group) i = group.end
  }
  return { star, args, end: i }
}

/** "a, b={c,d}" → ["a", "b={c,d}"]: commas inside braces do not split. */
function splitList(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ""
  for (const c of text) {
    if (c === "{") depth++
    else if (c === "}") depth--
    if (c === "," && depth === 0) {
      out.push(current)
      current = ""
    } else current += c
  }
  out.push(current)
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)
}

const TEXT_TOKEN =
  /(\\\\\*?(?:\[[^\]]*\])?)|\\([&%$#_{}])|(\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])*\$|\\\([\s\S]*?\\\))|\\(LaTeXe|LaTeX|TeX)(?![a-zA-Z])|\\[a-zA-Z]+\*?(?:\s*\[[^\]]*\])?|\\[\s\S]|[{}~]/g
const NOT_TITLE_TEXT = new Set([
  "label",
  "index",
  "footnote",
  "footnotetext",
  "thanks",
  "vspace",
  "hspace",
])

/** Drops these commands together with their arguments. */
function dropCommands(text: string, names: Set<string>) {
  let out = ""
  let last = 0
  for (const cmd of commandsIn(text)) {
    if (cmd.start < last || !names.has(cmd.name)) continue
    const { end } = readArgs(text, cmd.end, "*om")
    out += text.slice(last, cmd.start)
    last = end
  }
  return out + text.slice(last)
}

/**
 * Heading text as a reader sees it: "\textbf{Intro} to $x$" → "Intro to $x$".
 * Formatting commands and braces go, maths stays as written.
 */
export function plainText(tex: string) {
  return dropCommands(tex, NOT_TITLE_TEXT)
    .replace(TEXT_TOKEN, (token, lineBreak, escaped, math, logo) => {
      if (lineBreak) return " "
      if (escaped) return escaped
      if (math) return math
      if (logo) return logo === "LaTeXe" ? "LaTeX2e" : logo
      // Spacing commands (~, \ , \,) become a space; everything else goes.
      return token === "~" || /^\\[\s,;:!>]$/.test(token) ? " " : ""
    })
    .replace(/\s+/g, " ")
    .trim()
}

// ---- Outline ---------------------------------------------------------------

const HEADINGS = [
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
] as const
const HEADING_COMMAND =
  /\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(?![a-zA-Z])/
const LABEL = /\\label\s*\{([^{}]*)\}/

/** One heading of the document, for the outline panel. */
export type OutlineEntry = {
  kind: (typeof HEADINGS)[number]
  /** 0 for part … 6 for subparagraph. */
  level: number
  /** Braces and simple commands stripped: "\textbf{Intro} to $x$" → "Intro to $x$". */
  title: string
  /** 1-based line of the command. */
  line: number
  starred: boolean
  /** A \label on the same or the next line. */
  label?: string
}

/** The headings of a file, in order. */
export function outline(source: string): OutlineEntry[] {
  const masked = maskSource(source)
  const starts = lineStarts(masked)
  const entries: OutlineEntry[] = []
  for (const cmd of commandsIn(masked)) {
    const level = HEADINGS.indexOf(cmd.name as OutlineEntry["kind"])
    if (level < 0) continue
    const { star, args, end } = readArgs(masked, cmd.end, "*om")
    const title = args[1]
    if (!title) continue
    const entry: OutlineEntry = {
      kind: HEADINGS[level],
      level,
      title: plainText(title.text),
      line: lineOf(starts, cmd.start),
      starred: star,
    }
    // The label may sit inside the title, after it, or on the next line,
    // but not past the next heading.
    const endLine = lineOf(starts, Math.max(end - 1, cmd.start))
    let window = masked.slice(end, starts[endLine + 1] ?? masked.length)
    const next = HEADING_COMMAND.exec(window)
    if (next) window = window.slice(0, next.index)
    const label = LABEL.exec(title.text)?.[1] ?? LABEL.exec(window)?.[1]
    if (label?.trim()) entry.label = label.trim()
    entries.push(entry)
  }
  return entries
}

// ---- Analysis --------------------------------------------------------------

export type Analysis = {
  documentClass?: { name: string; options: string[]; line: number }
  packages: { name: string; options: string[]; line: number }[]
  /** Files pulled in by \input, \include, \subfile, \import …, with ".tex" added when there is no extension. */
  inputs: string[]
  /** \includegraphics targets as written. */
  graphics: string[]
  /** .bib files named by \bibliography or \addbibresource (".bib" added when missing). */
  bibliographies: string[]
  bibTool: "none" | "bibtex" | "biber"
  /** From a "% !TEX program = xelatex" magic comment, or from packages that only one engine supports. */
  engine?: TexEngine
  /** From "% !TEX root = ../main.tex". */
  root?: string
  /** Has both \documentclass and \begin{document}: it can be compiled on its own. */
  standalone: boolean
}

type PackageUse = {
  name: string
  options: string[]
  line: number
  /** Where the \usepackage command starts and ends. */
  start: number
  end: number
  list: Group
}

function packageUses(masked: string, starts: number[]): PackageUse[] {
  const uses: PackageUse[] = []
  for (const cmd of commandsIn(masked)) {
    if (cmd.name !== "usepackage" && cmd.name !== "RequirePackage") continue
    const { args, end } = readArgs(masked, cmd.end, "om")
    const list = args[1]
    if (!list) continue
    const options = args[0] ? splitList(args[0].text) : []
    for (const name of splitList(list.text))
      uses.push({
        name,
        options,
        line: lineOf(starts, cmd.start),
        start: cmd.start,
        end,
        list,
      })
  }
  return uses
}

const BEGIN_DOCUMENT = /\\begin\s*\{document\}/
const hasExtension = (path: string) =>
  /\.[A-Za-z0-9]+$/.test(path.split("/").pop() ?? "")
const withExtension = (path: string, ext: string) => {
  const clean = path.trim().replace(/^\.\//, "")
  return hasExtension(clean) ? clean : clean + ext
}
const ENGINE_NAMES: Record<string, TexEngine> = {
  pdflatex: "pdflatex",
  latex: "pdflatex",
  pdftex: "pdflatex",
  xelatex: "xelatex",
  xetex: "xelatex",
  lualatex: "lualatex",
  luatex: "lualatex",
  lualatexmk: "lualatex",
}
/** Packages that work under one engine only (fontspec also runs on LuaLaTeX, but XeLaTeX is the usual choice). */
const ENGINE_PACKAGES: Record<string, TexEngine> = {
  fontspec: "xelatex",
  polyglossia: "xelatex",
  "unicode-math": "xelatex",
  xeCJK: "xelatex",
  mathspec: "xelatex",
  xltxtra: "xelatex",
  luacode: "lualatex",
  luatexja: "lualatex",
  "luatexja-fontspec": "lualatex",
  luaotfload: "lualatex",
  lualatex_math: "lualatex",
}
const MAGIC_PROGRAM =
  /^[ \t]*%[ \t]*!\s*tex\s+(?:ts-)?program\s*=\s*([^\s%]+)/im
const MAGIC_ROOT = /^[ \t]*%[ \t]*!\s*tex\s+root\s*=\s*(.+?)\s*$/im

/** What a file declares: class, packages, inputs, graphics, bibliography, engine. */
export function analyze(source: string): Analysis {
  const masked = maskSource(source)
  const starts = lineStarts(masked)
  const result: Analysis = {
    packages: [],
    inputs: [],
    graphics: [],
    bibliographies: [],
    bibTool: "none",
    standalone: false,
  }
  let begins = false
  let usesBibliography = false
  const add = (list: string[], item: string) => {
    if (item && !list.includes(item)) list.push(item)
  }
  for (const cmd of commandsIn(masked)) {
    const read = (spec: string) => readArgs(masked, cmd.end, spec).args
    switch (cmd.name) {
      case "documentclass": {
        if (result.documentClass) break
        const [options, name] = read("om")
        if (name?.text.trim())
          result.documentClass = {
            name: name.text.trim(),
            options: options ? splitList(options.text) : [],
            line: lineOf(starts, cmd.start),
          }
        break
      }
      case "input": {
        const [arg] = read("m")
        if (arg) add(result.inputs, withExtension(arg.text, ".tex"))
        else {
          // TeX's own form: \input chapter1
          const bare = /^[ \t]+([^\s{}%\\]+)/.exec(masked.slice(cmd.end))
          if (bare) add(result.inputs, withExtension(bare[1], ".tex"))
        }
        break
      }
      case "include":
      case "subfile": {
        const [arg] = read("m")
        if (arg?.text.trim())
          add(result.inputs, withExtension(arg.text, ".tex"))
        break
      }
      case "import":
      case "subimport":
      case "inputfrom":
      case "includefrom":
      case "subinputfrom":
      case "subincludefrom": {
        const [dir, file] = read("*mm")
        if (dir && file?.text.trim()) {
          const folder = dir.text
            .trim()
            .replace(/\/?$/, "/")
            .replace(/^\.\//, "")
          add(result.inputs, withExtension(folder + file.text.trim(), ".tex"))
        }
        break
      }
      case "includegraphics": {
        const [, , file] = read("*oom")
        if (file?.text.trim()) add(result.graphics, file.text.trim())
        break
      }
      case "bibliography": {
        const [arg] = read("m")
        if (!arg) break
        usesBibliography = true
        for (const name of splitList(arg.text))
          add(result.bibliographies, withExtension(name, ".bib"))
        break
      }
      case "addbibresource":
      case "addglobalbib": {
        const [, arg] = read("om")
        if (arg?.text.trim())
          add(result.bibliographies, withExtension(arg.text, ".bib"))
        break
      }
      case "begin": {
        const [env] = read("m")
        if (env?.text.trim() === "document") begins = true
        break
      }
    }
  }
  for (const use of packageUses(masked, starts))
    result.packages.push({
      name: use.name,
      options: use.options,
      line: use.line,
    })
  const biblatex = result.packages.find((p) => p.name === "biblatex")
  if (biblatex) {
    const backend = biblatex.options
      .map((o) => /^backend\s*=\s*(\S+)$/.exec(o)?.[1])
      .find(Boolean)
    result.bibTool = backend && /^bibtex/.test(backend) ? "bibtex" : "biber"
  } else if (usesBibliography) result.bibTool = "bibtex"

  const program = MAGIC_PROGRAM.exec(source)?.[1].toLowerCase()
  const engine =
    (program && ENGINE_NAMES[program]) ||
    result.packages.map((p) => ENGINE_PACKAGES[p.name]).find(Boolean)
  if (engine) result.engine = engine
  const root = MAGIC_ROOT.exec(source)?.[1]
  if (root) result.root = root
  result.standalone = Boolean(result.documentClass) && begins
  return result
}

/** Joins a path relative to the folder of `from`, resolving "." and "..". */
function resolvePath(from: string, path: string) {
  const parts = path.replace(/\\/g, "/").startsWith("/")
    ? []
    : from.replace(/\\/g, "/").split("/").slice(0, -1)
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") parts.pop()
    else if (part && part !== ".") parts.push(part)
  }
  return parts.join("/")
}
const normalPath = (path: string) => resolvePath("", path)

/** The file to compile: the one with \documentclass, preferring main.tex, honouring a "% !TEX root" comment. */
export function findMainFile(
  files: { name: string; text: string }[]
): string | undefined {
  const tex = files.filter((f) => /\.(tex|ltx)$/i.test(f.name))
  const info = new Map(tex.map((f) => [f.name, analyze(f.text)]))
  const byPath = new Map(tex.map((f) => [normalPath(f.name).toLowerCase(), f]))
  for (const file of tex) {
    const root = info.get(file.name)?.root
    if (!root) continue
    const target = byPath.get(resolvePath(file.name, root).toLowerCase())
    if (target && info.get(target.name)?.documentClass) return target.name
  }
  // Subfiles and standalone figures have a class but are not the document.
  const PARTS = new Set(["subfiles", "standalone"])
  const score = (f: { name: string }) => {
    const a = info.get(f.name)
    if (!a?.documentClass) return -1
    return (a.standalone ? 4 : 0) + (PARTS.has(a.documentClass.name) ? 0 : 8)
  }
  const included = new Set(
    tex.flatMap((f) =>
      (info.get(f.name)?.inputs ?? []).map((i) =>
        resolvePath(f.name, i).toLowerCase()
      )
    )
  )
  const ranked = tex
    .map((file, order) => ({ file, order, score: score(file) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => {
      const key = (r: typeof a) => [
        -r.score,
        included.has(normalPath(r.file.name).toLowerCase()) ? 1 : 0,
        /(^|\/)main\.tex$/i.test(r.file.name) ? 0 : 1,
        r.file.name.split("/").length,
        r.order,
      ]
      const ka = key(a)
      const kb = key(b)
      for (let i = 0; i < ka.length; i++)
        if (ka[i] !== kb[i]) return ka[i] - kb[i]
      return 0
    })
  return ranked[0]?.file.name
}

// ---- Editing the preamble --------------------------------------------------

const FONT_START = /^%% font: (\S+)/
const FONT_END = /^%% end font\s*$/

/** The lines a setFont block occupies, 0-based and inclusive. */
function fontBlock(lines: string[]) {
  const start = lines.findIndex((l) => FONT_START.test(l))
  if (start < 0) return undefined
  const end = lines.findIndex((l, i) => i > start && FONT_END.test(l))
  if (end < 0) return undefined
  const id = FONT_START.exec(lines[start])?.[1] ?? ""
  return { start, end, id }
}

/** Inserts whole lines before line `at` (0-based), keeping the file's line endings. */
function insertLines(source: string, at: number, added: string[]) {
  const crlf = source.includes("\r\n")
  const eol = crlf ? "\r\n" : "\n"
  const lines = source.split("\n")
  if (at >= lines.length) {
    const gap = source === "" || source.endsWith("\n") ? "" : eol
    return source + gap + added.join(eol)
  }
  lines.splice(at, 0, ...added.map((l) => l + (crlf ? "\r" : "")))
  return lines.join("\n")
}

function removeLines(source: string, from: number, to: number) {
  const lines = source.split("\n")
  lines.splice(from, to - from + 1)
  return lines.join("\n")
}

/** Packages that should stay last in the preamble; others go before them. */
const LOAD_LAST = new Set(["hyperref", "cleveref", "bookmark", "glossaries"])

/** Adds \usepackage[options]{name} to the preamble unless it is already loaded; returns the source unchanged if it is. */
export function addPackage(
  source: string,
  name: string,
  options: string[] = []
) {
  const masked = maskSource(source)
  const starts = lineStarts(masked)
  const uses = packageUses(masked, starts)
  if (uses.some((u) => u.name === name)) return source
  const begin = BEGIN_DOCUMENT.exec(masked)?.index ?? masked.length
  const preamble = uses.filter((u) => u.start < begin)
  const line = `\\usepackage${options.length ? `[${options.join(",")}]` : ""}{${name}}`
  const late = LOAD_LAST.has(name)
    ? undefined
    : preamble.find((u) => LOAD_LAST.has(u.name))
  let at: number
  if (late) at = lineOf(starts, late.start) - 1
  else if (preamble.length)
    at = lineOf(starts, preamble[preamble.length - 1].end - 1)
  else {
    const cls = commandsIn(masked).find((c) => c.name === "documentclass")
    if (cls) at = lineOf(starts, readArgs(masked, cls.end, "om").end - 1)
    else if (begin < masked.length) at = lineOf(starts, begin) - 1
    else at = 0
  }
  // Never inside the font block.
  const block = fontBlock(source.split("\n"))
  if (block && at > block.start && at <= block.end) at = block.end + 1
  return insertLines(source, at, [line])
}

/** Removes a package from every \usepackage that loads it; a line left empty goes too. */
export function removePackage(source: string, name: string) {
  const masked = maskSource(source)
  const uses = packageUses(masked, lineStarts(masked)).filter(
    (u) => u.name === name
  )
  let text = source
  // From the end, so earlier positions stay valid.
  for (const use of uses.reverse()) {
    const names = splitList(use.list.text)
    const rest = names.filter((n) => n !== name)
    if (rest.length) {
      const glue = /, /.test(use.list.text) ? ", " : ","
      text =
        text.slice(0, use.list.start + 1) +
        rest.join(glue) +
        text.slice(use.list.end - 1)
      continue
    }
    text = text.slice(0, use.start) + text.slice(use.end)
    const lineStart = text.lastIndexOf("\n", use.start - 1) + 1
    const next = text.indexOf("\n", use.start)
    const lineEnd = next < 0 ? text.length : next
    if (!text.slice(lineStart, lineEnd).trim())
      text =
        text.slice(0, lineStart) + text.slice(next < 0 ? lineEnd : next + 1)
  }
  return text
}

/** Sets the document's font: replaces the block a previous call left (between marker comments) or adds one. "default" removes it. */
export function setFont(source: string, fontId: string) {
  const font =
    fontId === "default" ? undefined : FONTS.find((f) => f.id === fontId)
  if (fontId !== "default" && !font)
    throw new Error(`There is no font called "${fontId}".`)
  const block = fontBlock(source.split("\n"))
  let text = source
  let at: number | undefined
  if (block) {
    at = block.start
    text = removeLines(source, block.start, block.end)
  }
  if (!font) return text
  if (at === undefined) {
    const masked = maskSource(text)
    const starts = lineStarts(masked)
    const cls = commandsIn(masked).find((c) => c.name === "documentclass")
    if (!cls)
      throw new Error(
        "This file has no \\documentclass, so it has no preamble to set a font in."
      )
    const classLine = lineOf(starts, readArgs(masked, cls.end, "om").end - 1)
    const begin = BEGIN_DOCUMENT.exec(masked)
    if (!begin) at = classLine
    else {
      at = lineOf(starts, begin.index) - 1
      if (at < classLine)
        throw new Error(
          "Put \\begin{document} on a line of its own to set a font."
        )
    }
  }
  return insertLines(text, at, [
    `%% font: ${font.id} (set by the font menu; this block is replaced when the font changes)`,
    ...font.preamble.split("\n"),
    "%% end font",
  ])
}

/** The font a previous setFont call chose, if its markers are still there. */
export function currentFont(source: string): string | undefined {
  return fontBlock(source.split("\n"))?.id
}

// ---- Words -----------------------------------------------------------------

const DISPLAY_ENVS = [
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "flalign",
  "flalign*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
]
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const DISPLAY_ENV = new RegExp(
  String.raw`\\begin\s*\{(${DISPLAY_ENVS.map(escapeRegExp).join("|")})\}[\s\S]*?\\end\s*\{\1\}`,
  "g"
)
/** Environments whose content is pictures or code, not prose. */
const UNCOUNTED_ENV =
  /\\begin\s*\{(tikzpicture|axis|pspicture|comment)\}[\s\S]*?\\end\s*\{\1\}/g
/** Commands whose arguments are not prose, by xparse-style argument spec. */
const NOT_TEXT: Record<string, string> = {}
for (const [spec, names] of [
  [
    "m",
    "label ref eqref pageref autoref nameref cref Cref vref labelcref input include subfile includeonly bibliography bibliographystyle hypersetup url footnotetext index pagestyle thispagestyle pagenumbering stepcounter refstepcounter color usetikzlibrary graphicspath geometry newgeometry enlargethispage setlist linespread rowcolor cellcolor cline addbibresource textcolor colorbox href rotatebox scalebox raisebox usetheme usecolortheme usefonttheme",
  ],
  [
    "*oom",
    "cite citep citet citealt citeauthor citeyear parencite textcite autocite footcite nocite Cite includegraphics",
  ],
  ["om", "footnote caption marginpar lstinputlisting bibitem tikz parbox"],
  ["*m", "vspace hspace"],
  [
    "mm",
    "setlength addtolength setcounter addtocounter import subimport multicolumn fcolorbox resizebox inputminted fontsize",
  ],
  ["mmm", "definecolor"],
  ["omm", "rule"],
  ["mom", "multirow"],
  ["*moom", "newcommand renewcommand providecommand"],
  ["*moomm", "newenvironment renewenvironment"],
  ["*momo", "newtheorem"],
] as const)
  for (const name of names.split(" ")) NOT_TEXT[name] = spec
/** Arguments of \begin{…} that are settings, not text. */
const ENV_ARGS: Record<string, string> = {
  tabular: "om",
  "tabular*": "mom",
  tabularx: "mom",
  tabulary: "mom",
  array: "om",
  longtable: "om",
  minipage: "ooom",
  multicols: "m",
  "multicols*": "m",
  wrapfigure: "omm",
  column: "om",
  columns: "o",
  figure: "o",
  "figure*": "o",
  table: "o",
  "table*": "o",
  thebibliography: "m",
  letter: "m",
  tcolorbox: "o",
  subfigure: "om",
  paracol: "m",
  itemize: "o",
  enumerate: "o",
  description: "o",
  frame: "o",
  lstlisting: "o",
  minted: "om",
  adjustbox: "m",
}

/** Replaces commands in place; `edit` returns the replacement and where it ends. */
function rewriteCommands(
  text: string,
  edit: (cmd: Command) => { end: number; text: string } | undefined
) {
  let out = ""
  let last = 0
  for (const cmd of commandsIn(text)) {
    if (cmd.start < last) continue
    const change = edit(cmd)
    if (!change) continue
    out += text.slice(last, cmd.start) + change.text
    last = change.end
  }
  return out + text.slice(last)
}

/** Words in the text of the document, the way Overleaf's word count reads it: commands, comments and math are not counted; heading text is. `headings` is the number of headings, `mathInline` and `mathDisplay` the number of formulas. */
export function wordCount(source: string) {
  const masked = maskSource(source)
  const begin = BEGIN_DOCUMENT.exec(masked)
  const from = begin ? begin.index + begin[0].length : 0
  const end = /\\end\s*\{document\}/.exec(masked.slice(from))
  let text = masked.slice(from, end ? from + end.index : undefined)
  let headings = 0
  let mathInline = 0
  let mathDisplay = 0
  text = rewriteCommands(text, (cmd) => {
    if (!(HEADINGS as readonly string[]).includes(cmd.name)) return undefined
    const { args, end } = readArgs(text, cmd.end, "*om")
    if (!args[1]) return undefined
    headings++
    return { end, text: ` ${args[1].text} ` }
  })
  const display = () => (mathDisplay++, " ")
  const inline = () => (mathInline++, " ")
  text = text
    .replace(/\\\\\*?(?:\s*\[[^\]]*\])?/g, " ")
    // "R\&D" stays one word.
    .replace(/\\[$%&#_{}]/g, "")
    .replace(UNCOUNTED_ENV, " ")
    .replace(DISPLAY_ENV, display)
    .replace(/\\\[[\s\S]*?\\\]/g, display)
    .replace(/\$\$[\s\S]*?\$\$/g, display)
    .replace(/\\begin\s*\{math\}[\s\S]*?\\end\s*\{math\}/g, inline)
    .replace(/\\\([\s\S]*?\\\)/g, inline)
    .replace(/\$[^$]+\$/g, inline)
  text = rewriteCommands(text, (cmd) => {
    if (cmd.name === "begin" || cmd.name === "end") {
      const env = readArgs(text, cmd.end, "m")
      const name = env.args[0]?.text.trim() ?? ""
      const spec = cmd.name === "begin" ? (ENV_ARGS[name] ?? "") : ""
      return { end: readArgs(text, env.end, spec).end, text: " " }
    }
    if (cmd.name === "item") return { end: cmd.end, text: " " }
    const spec = NOT_TEXT[cmd.name] ?? "*o"
    return { end: readArgs(text, cmd.end, spec).end, text: " " }
  })
  const words = text
    .replace(/[{}~&]/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  return { words, headings, mathInline, mathDisplay }
}

// ---- Bibliography ----------------------------------------------------------

/** Removes TeX markup from a BibTeX value: braces, accents, simple commands. */
function bibText(value: string) {
  return value
    .replace(/\\['"`^~=.uvHcdbtr]\s*\{?\s*([A-Za-z])\}?/g, "$1")
    .replace(/\\(LaTeX|TeX)(?![a-zA-Z])\s*/g, "$1")
    .replace(/\\[a-zA-Z]+\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function bibFields(text: string) {
  const fields: Record<string, string> = {}
  const name = /([A-Za-z][\w-]*)\s*=\s*/y
  let i = 0
  while (i < text.length) {
    // Find the next "name =" from here.
    const rest = /[A-Za-z]/.exec(text.slice(i))
    if (!rest) break
    i += rest.index
    name.lastIndex = i
    const m = name.exec(text)
    if (!m) {
      i++
      continue
    }
    let k = name.lastIndex
    let value = ""
    for (;;) {
      if (text[k] === "{") {
        const group = readGroup(text, k, "{")
        const end = group ? group.end : text.length
        value += group ? group.text : text.slice(k + 1)
        k = end
      } else if (text[k] === '"') {
        let j = k + 1
        let depth = 0
        while (j < text.length && !(text[j] === '"' && depth === 0)) {
          if (text[j] === "{") depth++
          else if (text[j] === "}") depth--
          j++
        }
        value += text.slice(k + 1, j)
        k = j + 1
      } else {
        const bare = /^[^,#\s}]+/.exec(text.slice(k))?.[0] ?? ""
        value += bare
        k += bare.length
      }
      const after = skipSpaces(text, k)
      if (text[after] !== "#") break
      k = skipSpaces(text, after + 1)
    }
    fields[m[1].toLowerCase()] = value
    i = Math.max(k, i + 1)
  }
  return fields
}

function bibAuthors(value: string) {
  const people = value
    .split(/\s+and\s+/i)
    .map((person) => {
      const trimmed = person.trim()
      // {World Health Organization} is one name, not a first and last name.
      if (/^\{[^{}]*\}$/.test(trimmed)) return bibText(trimmed)
      const clean = bibText(trimmed)
      return clean.includes(",")
        ? clean.split(",")[0].trim()
        : (clean.split(" ").pop() ?? "")
    })
    .filter(Boolean)
  if (people.length > 2) return `${people[0]} et al.`
  return people.join(" and ")
}

/** Keys defined in BibTeX source, with a short description (author, year, title when present). */
export function bibEntries(bib: string) {
  const out: { key: string; type: string; description: string }[] = []
  const entry = /@\s*([A-Za-z]+)\s*([{(])/g
  let m: RegExpExecArray | null
  while ((m = entry.exec(bib))) {
    const type = m[1].toLowerCase()
    const open = m.index + m[0].length - 1
    const paren = m[2] === "("
    let depth = 0
    let end = bib.length
    for (let k = open + 1; k < bib.length; k++) {
      const c = bib[k]
      if (c === "{") depth++
      else if (c === "}") {
        if (depth === 0 && !paren) {
          end = k
          break
        }
        depth--
      } else if (c === ")" && paren && depth === 0) {
        end = k
        break
      }
    }
    entry.lastIndex = end
    if (type === "comment" || type === "string" || type === "preamble") continue
    const body = bib.slice(open + 1, end)
    const comma = body.indexOf(",")
    const key = (comma < 0 ? body : body.slice(0, comma)).trim()
    if (!key || /[\s{}"=]/.test(key)) continue
    const fields = bibFields(comma < 0 ? "" : body.slice(comma + 1))
    const who = fields.author ?? fields.editor
    const year = fields.year ?? /\d{4}/.exec(fields.date ?? "")?.[0]
    const description = [
      who ? bibAuthors(who) : "",
      year ? bibText(year) : "",
      fields.title ? bibText(fields.title) : "",
    ]
      .filter(Boolean)
      .join(", ")
    out.push({ key, type, description })
  }
  return out
}

const ESCAPES: Record<string, string> = {
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "\\": "\\textbackslash{}",
}

/** Text made safe to put in LaTeX source: & % $ # _ { } ~ ^ \ escaped. */
export const texEscape = (text: string) =>
  text.replace(/[&%$#_{}~^\\]/g, (c) => ESCAPES[c])

// ---- Logs ------------------------------------------------------------------

/** A problem found in a TeX log. */
export type Diagnostic = {
  severity: "error" | "warning" | "info"
  /** One line, without the leading "! " or "LaTeX Warning: ". */
  message: string
  /** The file TeX was reading, from the log's parenthesis stack. */
  file?: string
  line?: number
  /** The log lines around it that help: the offending source line TeX echoes, etc. */
  detail?: string
  /** A plain-language suggestion when the cause is recognisable. */
  hint?: string
}

const encoder = new TextEncoder()
/** TeX breaks log lines at 79 characters (bytes for pdfTeX). */
const isBroken = (line: string) =>
  line.length === 79 || (line.length < 79 && encoder.encode(line).length === 79)

/** The log's lines with TeX's hard wrapping undone. */
function unwrapLog(log: string): string[] {
  const out: string[] = []
  let current = ""
  let open = false
  for (const line of log.replace(/\r\n?/g, "\n").split("\n")) {
    current += line
    open = isBroken(line)
    if (open) continue
    out.push(current)
    current = ""
  }
  if (open && current) out.push(current)
  return out
}

/** Files that come with TeX rather than with the project. */
const SYSTEM_FILE =
  /texmf|texlive|miktex|\/tex\/(?:latex|generic|plain|context)\//i
const FILE_NAME = /^(?:[A-Za-z]:)?[^\s]*\.[A-Za-z][\w-]*$/
const quoted = (text: string) => text.replace(/`([^`']*)'/g, "'$1'")
/** The command at the end of the first line of TeX's context. */
const TRAILING_COMMAND = /(\\(?:[A-Za-z@]+|[^A-Za-z@\s]))\s*$/
const CONTEXT_LINE = /^(<[^>]*>|l\.\d+|\\\S*.*->|\s*\.\.\.\s*$)/

type Found = Omit<Diagnostic, "file" | "line"> & {
  line?: number
  file?: string
  command?: string
}

/** Problems found in a TeX, BibTeX or Biber log, in log order. Never throws. */
export function parseLog(log: string, mainFile?: string): Diagnostic[] {
  try {
    return readLog(typeof log === "string" ? log : "", mainFile)
  } catch {
    return []
  }
}

/**
 * An error as TeX writes it when run with -file-line-error, which the
 * in-browser engine does: "/main.tex:12: Undefined control sequence." where a
 * plain run writes "! Undefined control sequence.".
 */
const FILE_LINE_ERROR = /^(?:[A-Za-z]:)?[^\s:()]+\.[A-Za-z0-9]{1,5}:\d+: /

function readLog(log: string, mainFile?: string): Diagnostic[] {
  // Read both styles as one: the "l.12 …" line that follows gives the line.
  const lines = unwrapLog(log).map((line) =>
    line.replace(FILE_LINE_ERROR, "! ")
  )
  const found: Diagnostic[] = []
  const seen = new Set<string>()
  const stack: (string | null)[] = []

  /** The project file being read, and whether TeX's line numbers point into it. */
  const where = () => {
    let top: string | undefined
    for (let k = stack.length - 1; k >= 0; k--) {
      const file = stack[k]
      if (!file) continue
      top ??= file
      if (!SYSTEM_FILE.test(file)) return { file, trusted: file === top }
    }
    return { file: mainFile, trusted: top === undefined }
  }
  const add = (problem: Found) => {
    const place = where()
    const diagnostic: Diagnostic = {
      severity: problem.severity,
      message: problem.message.replace(/\s+/g, " ").trim(),
    }
    if (!diagnostic.message) return undefined
    // pdfTeX's remarks on the TeX installation's own font map (a font listed
    // twice, an entry it will not use): one per font, on every run, and
    // nothing the writer can act on.
    if (/\(file [^)]*fonts\/map\/[^)]*\.map\)/.test(diagnostic.message))
      return undefined
    const file = problem.file ?? place.file
    if (file) diagnostic.file = file
    if (problem.line !== undefined && (problem.file || place.trusted))
      diagnostic.line = problem.line
    if (problem.detail) diagnostic.detail = problem.detail
    const hint = problem.hint ?? hintFor(diagnostic.message, problem.command)
    if (hint) diagnostic.hint = hint
    const key = [
      diagnostic.severity,
      diagnostic.message,
      file,
      diagnostic.line,
    ].join("|")
    if (seen.has(key)) return undefined
    seen.add(key)
    found.push(diagnostic)
    return diagnostic
  }
  const scan = (text: string) => {
    for (let k = 0; k < text.length; k++) {
      const c = text[k]
      if (c === ")") stack.pop()
      if (c !== "(") continue
      let name: string
      if (text[k + 1] === '"') {
        const close = text.indexOf('"', k + 2)
        name = text.slice(k + 2, close < 0 ? text.length : close)
        k = close < 0 ? text.length : close
      } else {
        name = /^[^\s()"]*/.exec(text.slice(k + 1))?.[0] ?? ""
        k += name.length
      }
      stack.push(FILE_NAME.test(name) ? name.replace(/^\.\//, "") : null)
    }
  }
  /** TeX's context after an error: the lines up to "l.<n>" and the one after it. */
  const context = (from: number, limit: number) => {
    const kept: string[] = []
    let line: number | undefined
    let j = from
    for (; j < lines.length && j < from + limit; j++) {
      const text = lines[j]
      if (text.startsWith("! ")) break
      const at = /^l\.(\d+)/.exec(text)
      if (at) {
        line = Number(at[1])
        kept.push(text.trimEnd())
        const next = lines[j + 1]
        if (next !== undefined && /^\s+\S/.test(next)) {
          kept.push(next.trimEnd())
          j++
        }
        j++
        break
      }
      if (CONTEXT_LINE.test(text) && !/^\s*\.\.\.\s*$/.test(text)) {
        kept.push(text.trimEnd())
        const next = lines[j + 1]
        if (next !== undefined && /^\s+\S/.test(next)) {
          kept.push(next.trimEnd())
          j++
        }
      }
    }
    return line === undefined ? { kept, next: from } : { kept, line, next: j }
  }

  let runaway: string | undefined
  let i = 0
  while (i < lines.length) {
    const text = lines[i]

    if (/^!\s+==>/.test(text) || text.startsWith("!  ")) {
      i++
      continue
    }
    if (text.startsWith("! ")) {
      const head = text.slice(2).trim()
      let message = head.replace(/^LaTeX Error:\s*/, "")
      const pkg = /^(Package|Class) (\S+) Error: (.*)$/.exec(head)
      let j = i + 1
      if (pkg) {
        message = `${pkg[1]} ${pkg[2]}: ${pkg[3]}`
        const prefix = `(${pkg[2]})`
        while (j < lines.length && lines[j].startsWith(prefix)) {
          message += " " + lines[j].slice(prefix.length).trim()
          j++
        }
      }
      message = quoted(message)
      const ctx = context(j, 30)
      const command =
        TRAILING_COMMAND.exec(ctx.kept[0] ?? "")?.[1] ??
        TRAILING_COMMAND.exec(message)?.[1]
      const detail = [runaway, ...ctx.kept].filter(Boolean).join("\n")
      runaway = undefined
      if (/^Emergency stop/.test(message)) {
        // A consequence of the error before it, which may lack the line.
        const previous = found.findLast((d) => d.severity === "error")
        if (previous) {
          if (
            previous.line === undefined &&
            ctx.line !== undefined &&
            where().trusted
          )
            previous.line = ctx.line
          if (!previous.detail && detail) previous.detail = detail
        } else {
          const aborted = lines
            .slice(ctx.next, ctx.next + 3)
            .some((l) => /no legal \\end found/.test(l))
          add({
            severity: "error",
            message,
            line: ctx.line,
            detail: detail || undefined,
            hint: aborted
              ? "The file ended before \\end{document}. Add \\end{document} as the last line of the main file."
              : undefined,
          })
        }
      } else
        add({
          severity: "error",
          message,
          line: ctx.line,
          detail: detail || undefined,
          command,
        })
      i = Math.max(ctx.next, j)
      continue
    }
    if (text.startsWith("Runaway argument?")) {
      const argument = (lines[i + 1] ?? "").trimEnd()
      const followed = lines.slice(i + 2, i + 5).some((l) => l.startsWith("! "))
      if (followed) runaway = `Runaway argument? ${argument}`
      else
        add({
          severity: "error",
          message: "Runaway argument.",
          detail: argument,
          hint: "A command's argument was never closed, so a } is probably missing.",
        })
      i += 2
      continue
    }

    const warning =
      /(LaTeX Font|LaTeX|Package (\S+)|Class (\S+)|pdfTeX) [Ww]arning(?: \([^)]*\))?: /.exec(
        text
      )
    if (warning) {
      scan(text.slice(0, warning.index))
      const [, source, pkg, cls] = warning
      let message = text.slice(warning.index + warning[0].length)
      const prefix =
        source === "LaTeX"
          ? "(LaTeX)"
          : source === "LaTeX Font"
            ? "(Font)"
            : `(${pkg ?? cls ?? "pdfTeX"})`
      let j = i + 1
      while (j < lines.length && lines[j].startsWith(prefix)) {
        message += " " + lines[j].slice(prefix.length).trim()
        j++
      }
      message = quoted(message)
      if (pkg) message = `Package ${pkg}: ${message}`
      else if (cls) message = `Class ${cls}: ${message}`
      else if (source === "pdfTeX") message = `pdfTeX: ${message}`
      const at = [...message.matchAll(/on input line (\d+)/g)].pop()?.[1]
      let line = at ? Number(at) : undefined
      if (source === "pdfTeX") {
        const ctx = context(j, 8)
        line = ctx.line
        j = Math.max(j, ctx.next)
      }
      add({ severity: "warning", message, line })
      i = j
      continue
    }

    const box = /^(Over|Under)full \\([hv])box \(([^)]*)\)(.*)$/.exec(text)
    if (box) {
      const at = /lines? (\d+)/.exec(box[4])?.[1]
      add({
        severity: "info",
        message: text.replace(/\s*\[\]\s*$/, "").trim(),
        line: at ? Number(at) : undefined,
        hint: boxHint(box[1], box[2], box[3]),
      })
      // The box's contents follow, up to a blank line; they are not file names.
      i++
      let skipped = 0
      while (
        i < lines.length &&
        lines[i].trim() &&
        skipped++ < 12 &&
        !/^(! |LaTeX |Package |Class |Overfull |Underfull )/.test(lines[i])
      )
        i++
      continue
    }

    const missing = /Missing character: There is no (.+?) in font (.+?)!/.exec(
      text
    )
    if (missing) {
      scan(text.slice(0, missing.index))
      add({ severity: "warning", message: missing[0] })
      i++
      continue
    }
    if (/^No pages of output\./.test(text)) {
      add({ severity: "warning", message: "No pages of output." })
      i++
      continue
    }

    // BibTeX and Biber.
    const bibWarning = /^Warning--(.*)$/.exec(text)
    if (bibWarning) {
      add({ severity: "warning", message: quoted(bibWarning[1]) })
      i++
      continue
    }
    const bibError =
      /^(I couldn't open (?:database|style|auxiliary) file .*|I found no \\\w+ command.*|.*---line (\d+) of file (.*))$/.exec(
        text
      )
    if (bibError) {
      add({
        severity: "error",
        message: quoted(bibError[1]),
        line: bibError[2] ? Number(bibError[2]) : undefined,
        file: bibError[3]?.trim(),
      })
      i++
      continue
    }
    const biber = /^(?:\[\d+\] )?(?:\S+:\d+> )?(ERROR|WARN) - (.*)$/.exec(text)
    if (biber) {
      add({
        severity: biber[1] === "ERROR" ? "error" : "warning",
        message: biber[2],
      })
      i++
      continue
    }

    scan(text)
    i++
  }
  return found
}

function boxHint(kind: string, box: string, amount: string) {
  const size = amount.replace(/ too (wide|high)$/, "")
  if (kind === "Over" && box === "h")
    return `A line runs ${size} into the margin. Rewording it usually fixes this; a long word or URL may need a hyphenation point (\\-) or a \\linebreak.`
  if (kind === "Over")
    return `Something is ${size} too tall for the space it is in, often a figure or table taller than the page.`
  if (box === "h")
    return "A line was stretched more than LaTeX likes. It is usually harmless; a \\\\ at the end of a paragraph or a short line in a narrow column often causes it."
  return undefined
}

/** Commands people use without loading the package that defines them. */
const COMMAND_PACKAGES: Record<string, string> = {
  includegraphics: "graphicx",
  graphicspath: "graphicx",
  rotatebox: "graphicx",
  scalebox: "graphicx",
  resizebox: "graphicx",
  textcolor: "xcolor",
  color: "xcolor",
  colorbox: "xcolor",
  fcolorbox: "xcolor",
  definecolor: "xcolor",
  pagecolor: "xcolor",
  rowcolor: "[table]xcolor",
  cellcolor: "[table]xcolor",
  href: "hyperref",
  url: "hyperref",
  hypersetup: "hyperref",
  autoref: "hyperref",
  toprule: "booktabs",
  midrule: "booktabs",
  bottomrule: "booktabs",
  cmidrule: "booktabs",
  mathbb: "amssymb",
  mathfrak: "amssymb",
  checkmark: "amssymb",
  text: "amsmath",
  eqref: "amsmath",
  operatorname: "amsmath",
  DeclareMathOperator: "amsmath",
  dfrac: "amsmath",
  tfrac: "amsmath",
  binom: "amsmath",
  boldsymbol: "amsmath",
  mathscr: "mathrsfs",
  bm: "bm",
  SI: "siunitx",
  si: "siunitx",
  qty: "siunitx",
  num: "siunitx",
  unit: "siunitx",
  multirow: "multirow",
  cref: "cleveref",
  Cref: "cleveref",
  lstinputlisting: "listings",
  lstset: "listings",
  tikz: "tikz",
  usetikzlibrary: "tikz",
  newgeometry: "geometry",
  titleformat: "titlesec",
  titlespacing: "titlesec",
  setlist: "enumitem",
  fancyhf: "fancyhdr",
  fancyhead: "fancyhdr",
  fancyfoot: "fancyhdr",
  captionof: "caption",
  captionsetup: "caption",
  subcaption: "subcaption",
  printbibliography: "biblatex",
  addbibresource: "biblatex",
  parencite: "biblatex",
  textcite: "biblatex",
  autocite: "biblatex",
  citep: "natbib",
  citet: "natbib",
  faEnvelope: "fontawesome5",
  faPhone: "fontawesome5",
  faGithub: "fontawesome5",
  faLinkedin: "fontawesome5",
  faGlobe: "fontawesome5",
  faIcon: "fontawesome5",
  lipsum: "lipsum",
  blindtext: "blindtext",
  sout: "ulem",
  uline: "ulem",
  hl: "soul",
  onehalfspacing: "setspace",
  doublespacing: "setspace",
  singlespacing: "setspace",
  justifying: "ragged2e",
  RaggedRight: "ragged2e",
  FloatBarrier: "placeins",
  arraybackslash: "array",
  makecell: "makecell",
  thead: "makecell",
  ce: "mhchem",
  cancel: "cancel",
  xspace: "xspace",
  todo: "todonotes",
  lastpage: "lastpage",
  ifthenelse: "ifthen",
  AtBeginEnvironment: "etoolbox",
  mathlarger: "relsize",
  nicefrac: "nicefrac",
  coloneqq: "mathtools",
  DeclarePairedDelimiter: "mathtools",
  euro: "eurosym",
}
const ENV_PACKAGES: Record<string, string> = {
  "align*": "amsmath",
  align: "amsmath",
  gather: "amsmath",
  "gather*": "amsmath",
  multline: "amsmath",
  "multline*": "amsmath",
  flalign: "amsmath",
  "equation*": "amsmath",
  split: "amsmath",
  pmatrix: "amsmath",
  bmatrix: "amsmath",
  vmatrix: "amsmath",
  matrix: "amsmath",
  cases: "amsmath",
  aligned: "amsmath",
  proof: "amsthm",
  lstlisting: "listings",
  tikzpicture: "tikz",
  axis: "pgfplots",
  tabularx: "tabularx",
  longtable: "longtable",
  multicols: "multicol",
  wrapfigure: "wrapfig",
  subfigure: "subcaption",
  landscape: "pdflscape",
  tcolorbox: "tcolorbox",
  minted: "minted",
  algorithm: "algorithm",
  algorithmic: "algpseudocode",
  comment: "comment",
  paracol: "paracol",
  spacing: "setspace",
  adjustbox: "adjustbox",
  threeparttable: "threeparttable",
}
const usepackage = (spec: string) => {
  const m = /^(\[[^\]]*\])?(.+)$/.exec(spec)
  return `\\usepackage${m?.[1] ?? ""}{${m?.[2] ?? spec}}`
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3
  let previous = Array.from({ length: b.length + 1 }, (_, k) => k)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    previous = row
  }
  return previous[b.length]
}

/** The known name closest to a misspelling, if one is close enough. */
function closest(name: string, known: Iterable<string>) {
  const limit = name.length > 5 ? 2 : 1
  let best: string | undefined
  let distance = limit + 1
  for (const candidate of known) {
    if (candidate === name) return undefined
    const d = editDistance(name, candidate)
    if (d < distance) {
      best = candidate
      distance = d
    }
  }
  return best
}

const HINTS: [
  RegExp,
  (m: RegExpExecArray, command?: string) => string | undefined,
][] = [
  [
    /^Undefined control sequence/,
    (_, command) => undefinedCommandHint(command),
  ],
  [
    /File '([^']+)' not found|I can't find file '([^']+)'|I couldn't open (?:database|style) file (\S+)/,
    (m) => missingFileHint(m[1] ?? m[2] ?? m[3]),
  ],
  [/^Environment (\S+) undefined/, (m) => undefinedEnvironmentHint(m[1])],
  [
    /^Missing \$ inserted/,
    () =>
      "A maths-only symbol such as _ or ^ was used outside a formula. Put the formula between $ and $, or write \\_ for a literal underscore.",
  ],
  [
    /^Missing [{}] inserted/,
    () =>
      "A brace is missing or a group was closed in the wrong place. Check that every { on this line has its matching }.",
  ],
  [
    /^Extra \}, or forgotten|^Too many \}'s/,
    () =>
      "There is a } with no { to match it. Remove it, or add the { it was meant to close.",
  ],
  [
    /^Extra alignment tab has been changed/,
    () =>
      "This table row has more & separators than the table has columns. Remove an &, add a column to the table's column list (for example {lll}), or write \\& for an ampersand in text.",
  ],
  [
    /^Misplaced alignment tab character &/,
    () => "An & appeared outside a table. To print an ampersand, write \\&.",
  ],
  [
    /^File ended while scanning use of (\\\S+?)\.?$/,
    (m) =>
      `The file ended while ${m[1]} was still reading its argument, so a } is missing. Check the braces after the last ${m[1]}.`,
  ],
  [
    /^Paragraph ended before (\\\S+?) was complete/,
    (m) =>
      `A blank line appeared inside the argument of ${m[1]}, which usually means a } is missing. Close the argument before the blank line.`,
  ],
  [
    /^Emergency stop/,
    () =>
      "TeX stopped before the end of the document. Fix the error reported above this one; if there is none, check that the file ends with \\end{document}.",
  ],
  [
    /^TeX capacity exceeded/,
    () =>
      "TeX ran out of memory, which almost always means a command calls itself without end (for example a \\renewcommand that uses the command it redefines). Check your recent definitions; a very large table or picture can also cause it.",
  ],
  [
    /Unknown option '([^']+)' for (?:package|class) '([^']+)'/,
    (m) =>
      `${m[2]} has no option called ${m[1]}. Check the spelling inside the square brackets where ${m[2]} is loaded, or remove the option.`,
  ],
  [
    /Unknown option '([^']+)'/,
    (m) =>
      `${m[1]} is not an option this package knows. Check the spelling inside the square brackets, or remove it.`,
  ],
  [
    /^Option clash for package (\S+?)\.?$/,
    (m) =>
      `The ${m[1]} package is loaded twice with different options, possibly once by another package or the class. Load it once, before anything else that needs it, with all the options together.`,
  ],
  [
    /requires either XeTeX or LuaTeX/,
    () =>
      "fontspec only works with XeLaTeX or LuaLaTeX. Switch the compiler to XeLaTeX, or remove fontspec and pick a pdfLaTeX font.",
  ],
  [
    /^Font .* not loadable|font "?[^"]*"? cannot be found|cannot find the font/i,
    () =>
      "This font is not installed for the compiler. Pick a font from the font menu, or upload the font files to the project and load them by file name.",
  ],
  [
    /^Undefined colou?r '([^']+)'|Undefined colou?r '([^']+)'/,
    (m) =>
      `The colour ${m[1] ?? m[2]} is not defined. Define it first, for example \\definecolor{${m[1] ?? m[2]}}{HTML}{1F5F8B}, or use a predefined name such as blue.`,
  ],
  [
    /^Unicode character (.+?) \(U\+([0-9A-F]+)\)/,
    (m) =>
      `pdfLaTeX has no glyph set up for ${m[1]} (U+${m[2]}), often a symbol pasted from elsewhere. Replace it with the LaTeX command for it, or compile with XeLaTeX.`,
  ],
  [
    /^Missing \\begin\{document\}/,
    () =>
      "Something in the preamble prints text: a stray character, or a typo in a command. Move text below \\begin{document}, and check this line.",
  ],
  [
    /^Can be used only in preamble/,
    () =>
      "This command only works in the preamble. Move it above \\begin{document}.",
  ],
  [
    /^\\begin\{([^}]*)\} on input line (\d+) ended by \\end\{([^}]*)\}/,
    (m) =>
      `The \\begin{${m[1]}} on line ${m[2]} is closed by \\end{${m[3]}}. Add \\end{${m[1]}} before it, or fix a misspelt name.`,
  ],
  [
    /^Command (\\\S+?) already defined/,
    (m) =>
      `${m[1]} already exists, so \\newcommand will not redefine it. Choose another name, or use \\renewcommand if you mean to replace it.`,
  ],
  [
    /^There's no line here to end/,
    () =>
      "A \\\\ appears where no line has started, often right after a heading, a blank line or \\begin of a list. Remove it, or use \\vspace{...} for vertical space.",
  ],
  [
    /^Something's wrong--perhaps a missing \\item/,
    () =>
      "A list (itemize, enumerate or description) has text before its first \\item, or has no items. Start every entry with \\item.",
  ],
  [
    /^Lonely \\item/,
    () => "\\item only works inside a list such as itemize or enumerate.",
  ],
  [
    /^Double (superscript|subscript)/,
    (m) =>
      `Two ${m[1] === "superscript" ? "^" : "_"} in a row are ambiguous. Group them with braces, as in x${m[1] === "superscript" ? "^{ab}" : "_{ab}"}.`,
  ],
  [
    /^Missing number, treated as zero/,
    () =>
      "A command expected a number or a length and got something else: often a missing unit, or a \\\\ followed by text in square brackets.",
  ],
  [
    /^Illegal unit of measure/,
    () =>
      "A length is missing its unit. Write 2cm, 10pt or 0.5\\linewidth, not a bare number.",
  ],
  [
    /^Not in outer par mode/,
    () =>
      "A figure, table or \\marginpar is inside a box, minipage or another float, where it cannot float. Move it out, or use \\captionof inside a minipage instead.",
  ],
  [
    /^Too many unprocessed floats/,
    () =>
      "Too many figures and tables are waiting for a place. Add \\clearpage after some of them, or give them more freedom with [htbp].",
  ],
  [
    /^Missing \\right\. inserted|^Extra \\right/,
    () =>
      "Every \\left needs a matching \\right in the same formula line; use \\right. for an invisible one.",
  ],
  [
    /^Display math should end with \$\$/,
    () =>
      "A display formula was not closed the way it was opened. Write display maths as \\[ ... \\] rather than $$ ... $$.",
  ],
  [
    /^Bad math environment delimiter/,
    () =>
      "\\[ and \\] (or \\( and \\)) are mismatched, or one formula is inside another.",
  ],
  [
    /^Illegal parameter number in definition|^You can't use .macro parameter character #/,
    () => "A # appears where LaTeX does not expect one. To print #, write \\#.",
  ],
  [
    /^Missing control sequence inserted/,
    () =>
      "\\newcommand needs a command name with a backslash, as in \\newcommand{\\name}{...}.",
  ],
  [
    /^\\verb ended by end of line/,
    () =>
      "\\verb must open and close on the same line. Use the verbatim environment for longer text.",
  ],
  [
    /^Argument of (\\\S+) has an extra \}/,
    (m) =>
      `${m[1]} got a } where its argument should start. A { is probably missing, or a command in a heading or caption needs \\protect in front of it.`,
  ],
  [
    /Bibliography not compatible with author-year/,
    () =>
      "This bibliography style gives numbers, but natbib expects author-year. Use a style such as plainnat, or load natbib with the [numbers] option.",
  ],
  [
    /^Reference '([^']+)' on page \S+ undefined/,
    (m) =>
      `There is no \\label{${m[1]}}, or it was added since the last compile. Check the name; if it is right, compile again.`,
  ],
  [
    /Citation '([^']+)'(?: on page \S+)? undefined/,
    (m) =>
      `No bibliography entry has the key ${m[1]}, or the bibliography has not been rebuilt yet. Check the key against your .bib file; if it is right, compile again.`,
  ],
  [
    /I didn't find a database entry for ["']([^"']+)["']/,
    (m) =>
      `No entry in the .bib file has the key ${m[1]}. Check the key used in \\cite.`,
  ],
  [
    /^There were undefined (references|citations)/,
    () =>
      "Compile again. If this stays, one of the references or citations above has no matching \\label or bibliography entry.",
  ],
  [
    /^Label\(s\) may have changed/,
    () => "Compile again so the cross-references are up to date.",
  ],
  [
    /^Label '([^']+)' multiply defined/,
    (m) =>
      `Two \\label commands use the name ${m[1]}, so references to it may point to the wrong place. Rename one of them.`,
  ],
  [
    /^There were multiply-defined labels/,
    () => "Two \\label commands share a name; the warnings above say which.",
  ],
  [
    /Token not allowed in a PDF string/,
    () =>
      "A heading contains maths or a command that cannot go into the PDF's bookmarks. Wrap it as \\texorpdfstring{with formatting}{plain text}; the PDF still looks right either way.",
  ],
  [
    /^Font shape '([^']+)' undefined|^Some font shapes were not available/,
    () =>
      "The font has no such shape (for example small capitals or bold italic), so LaTeX used the closest one.",
  ],
  [
    /float specifier changed to/,
    () =>
      "LaTeX could not place the float exactly where [h] asked. Use [htbp] to give it more choice, or [H] from the float package to force the spot.",
  ],
  [
    /^Float too large for page/,
    () =>
      "A figure or table is taller than the page. Make it smaller, for example with width=0.8\\linewidth on \\includegraphics.",
  ],
  [
    /^Missing character: There is no (.+?) in font/,
    (m) =>
      `The font has no glyph for ${m[1]}, so it was left out of the PDF. Use the LaTeX command for it, or compile with XeLaTeX and a font that has it.`,
  ],
  [
    /^Unused global option/,
    () =>
      "An option in \\documentclass[...] is not used by the class or any package. Check its spelling.",
  ],
  [
    /^Empty .thebibliography. environment/,
    () =>
      "The bibliography has no entries. Cite something with \\cite, or add \\nocite{*} to list every entry in the .bib file.",
  ],
  [
    /^No pages of output/,
    () =>
      "Nothing was typeset: there is no text between \\begin{document} and \\end{document}.",
  ],
  [
    /^I found no \\citation commands/,
    () =>
      "Nothing is cited. Add \\cite{key} in the text, or \\nocite{*} to list every entry.",
  ],
  [
    /^I found no \\bibdata command/,
    () =>
      "There is no \\bibliography{file} telling BibTeX which .bib file to read.",
  ],
  [
    /^I found no \\bibstyle command/,
    () =>
      "There is no \\bibliographystyle{...}; add one, such as \\bibliographystyle{plain}.",
  ],
]

/** A plain-language suggestion for a log message, when the cause is recognisable. */
function hintFor(message: string, command?: string) {
  const text = message.replace(/^(?:Package|Class) \S+: /, "")
  for (const [pattern, hint] of HINTS) {
    const m = pattern.exec(text)
    if (m) return hint(m, command)
  }
  return undefined
}

function undefinedCommandHint(command?: string) {
  if (!command)
    return "LaTeX met a command it does not know. Check the spelling on this line, or load the package that defines it."
  const name = command.slice(1)
  const pkg = COMMAND_PACKAGES[name]
  if (pkg) {
    const packageName = pkg.replace(/^\[[^\]]*\]/, "")
    return `${command} comes from the ${packageName} package, which is not loaded. Add ${usepackage(pkg)} to the preamble.`
  }
  const near = closest(name, knownCommands())
  return near
    ? `${command} is not a command LaTeX knows. Did you mean \\${near}? If not, load the package that defines it.`
    : `${command} is not a command LaTeX knows. Check the spelling, or load the package that defines it.`
}

function undefinedEnvironmentHint(name: string) {
  const pkg = ENV_PACKAGES[name]
  if (pkg)
    return `The ${name} environment comes from the ${pkg} package, which is not loaded. Add \\usepackage{${pkg}} to the preamble.`
  if (
    /^(theorem|lemma|definition|corollary|proposition|remark|example|exercise|problem)$/.test(
      name
    )
  )
    return `There is no ${name} environment until you define it, for example \\newtheorem{${name}}{${name[0].toUpperCase()}${name.slice(1)}} in the preamble (with the amsthm package).`
  const near = closest(name, knownEnvironments())
  return near
    ? `There is no environment called ${name}. Did you mean ${near}?`
    : `There is no environment called ${name}. Check the spelling, or load the package that defines it.`
}

function missingFileHint(file: string) {
  const ext = /\.([A-Za-z0-9]+)$/.exec(file)?.[1]?.toLowerCase()
  const base = file.replace(/\.[^.]+$/, "")
  if (ext === "sty")
    return `The package ${base} is not available. Check the spelling where it is loaded; if it is a custom package, add ${file} to the project next to the main file.`
  if (ext === "cls")
    return `The document class ${base} is not available. Check the spelling in \\documentclass, or add ${file} to the project next to the main file.`
  if (ext === "bib")
    return `${file} is not in the project. Check the name in \\bibliography or \\addbibresource (names are case-sensitive).`
  if (!ext || /^(png|jpe?g|pdf|eps|svg|gif|bmp|tiff?)$/.test(ext))
    return `The image ${file} is not in the project. Upload it, or fix the path in \\includegraphics (names are case-sensitive).`
  return `LaTeX cannot find ${file}. Check the file name and folder; names are case-sensitive.`
}

const RERUN = [
  /Rerun to get [\s\S]{0,60}?(?:right|correct)/i,
  /Label\(s\) may have changed/,
  /Citation\(s\) may have changed/,
  /\brerun LaTeX/i,
  /Table widths have changed/,
  /^No file \S+\.(?:toc|lof|lot|nav|loa|lol)\.$/m,
]

/** True when the log asks for another pass (cross-references, citations, TOC, longtable …). */
export function needsRerun(log: string): boolean {
  try {
    const text = unwrapLog(typeof log === "string" ? log : "").join("\n")
    return RERUN.some((pattern) => pattern.test(text))
  } catch {
    return false
  }
}

// ---- Completions -----------------------------------------------------------

/** One entry the editor can offer while typing. */
export type Completion = {
  /** What is typed and matched, e.g. "\\section", "itemize", "geometry". */
  label: string
  kind:
    | "command"
    | "environment"
    | "package"
    | "class"
    | "reference"
    | "citation"
    | "file"
  /** Short description shown beside it. */
  detail?: string
  /**
   * What to insert, in CodeMirror snippet syntax: "\\frac{${1:num}}{${2:den}}".
   * Missing means insert the label. For an environment it is the whole
   * \begin … \end block.
   */
  apply?: string
}

type CatalogEntry = {
  name: string
  args: string
  detail: string
  body?: string
}

/** Parses the compact catalogs below: "name{arg}[opt] detail" or "@detail: name name …". */
function parseCatalog(data: string): CatalogEntry[] {
  const out: CatalogEntry[] = []
  for (const raw of data.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("@")) {
      const colon = line.indexOf(":")
      const detail = line.slice(1, colon).trim()
      for (const name of line
        .slice(colon + 1)
        .trim()
        .split(/\s+/))
        out.push({ name, args: "", detail })
      continue
    }
    const m = /^([A-Za-z]+\*?)((?:\[[^\]]*\]|\{[^}]*\})*)\s*(.*)$/.exec(line)
    if (!m) continue
    const body = / \*(\w+)$/.exec(m[3])
    out.push({
      name: m[1],
      args: m[2],
      detail: body ? m[3].slice(0, body.index) : m[3],
      body: body?.[1],
    })
  }
  return out
}

/** "{title}[opt]" → "{${1:title}}[${2:opt}]", numbering from `from`. */
function placeholders(args: string, from = 1) {
  let n = from
  const text = args.replace(
    /\[([^\]]*)\]|\{([^}]*)\}/g,
    (_, opt: string | undefined, req: string | undefined) =>
      opt !== undefined
        ? `[\${${n++}:${opt}}]`
        : `{\${${n++}${req ? `:${req}` : ""}}}`
  )
  return { text, next: n }
}

/** Snippet bodies for environments, by the marker at the end of their catalog line. */
const ENV_BODIES: Record<string, (n: number) => string> = {
  list: (n) => `\t\\item \${${n}}`,
  desc: (n) => `\t\\item[\${${n}:term}] \${${n + 1}}`,
  figure: (n) =>
    `\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{\${${n}:file}}\n\t\\caption{\${${n + 1}:caption}}\n\t\\label{fig:\${${n + 2}:label}}`,
  table: (n) =>
    `\t\\centering\n\t\\caption{\${${n}:caption}}\n\t\\label{tab:\${${n + 1}:label}}\n\t\\begin{tabular}{\${${n + 2}:ll}}\n\t\t\${${n + 3}} \\\\\n\t\\end{tabular}`,
  rows: (n) => `\t\${${n}} \\\\`,
  align: (n) => `\t\${${n}} &= \${${n + 1}} \\\\\n\t&= \${${n + 2}}`,
  cases: (n) =>
    `\t\${${n}} & \\text{if } \${${n + 1}} \\\\\n\t\${${n + 2}} & \\text{otherwise}`,
  matrix: (n) =>
    `\t\${${n}} & \${${n + 1}} \\\\\n\t\${${n + 2}} & \${${n + 3}}`,
  bib: (n) => `\t\\bibitem{\${${n}:key}} \${${n + 1}}`,
  columns: (n) =>
    `\t\\begin{column}{0.5\\textwidth}\n\t\t\${${n}}\n\t\\end{column}\n\t\\begin{column}{0.5\\textwidth}\n\t\t\${${n + 1}}\n\t\\end{column}`,
}
/** Commands whose snippet cannot be written as plain {} and [] arguments. */
const COMMAND_SNIPPETS: Record<string, string> = {
  verb: "\\verb|${1:text}|",
  item: "\\item ",
  only: "\\only<${1:2}>{${2:text}}",
  uncover: "\\uncover<${1:2->}>{${2:text}}",
  onslide: "\\onslide<${1:2->}>",
  left: "\\left${1:(} ${2} \\right${3:)}",
  begin: "\\begin{${1:environment}}\n\t${2}\n\\end{${1:environment}}",
}

let commandCache: Completion[] | undefined
let environmentCache: Completion[] | undefined

function catalogCommands() {
  commandCache ??= parseCatalog(COMMAND_DATA).map((c) => {
    const completion: Completion = {
      label: `\\${c.name}`,
      kind: "command",
      detail: c.detail,
    }
    const apply =
      COMMAND_SNIPPETS[c.name] ??
      (c.args ? `\\${c.name}${placeholders(c.args).text}` : undefined)
    if (apply) completion.apply = apply
    return completion
  })
  return commandCache
}

function catalogEnvironments() {
  environmentCache ??= parseCatalog(ENVIRONMENT_DATA).map((e): Completion => {
    const begin = placeholders(e.args)
    const body = (ENV_BODIES[e.body ?? ""] ?? ((n: number) => `\t\${${n}}`))(
      begin.next
    )
    return {
      label: e.name,
      kind: "environment",
      detail: e.detail,
      apply: `\\begin{${e.name}}${begin.text}\n${body}\n\\end{${e.name}}`,
    }
  })
  return environmentCache
}

const knownCommands = () => catalogCommands().map((c) => c.label.slice(1))
const knownEnvironments = () => catalogEnvironments().map((e) => e.label)

/** Commands, environments and theorems this document defines, and its labels. */
function documentCompletions(source: string): Completion[] {
  const masked = maskSource(source)
  const starts = lineStarts(masked)
  const out: Completion[] = []
  const nameAt = (from: number) => {
    const at = skipSpaces(masked, from)
    const group = readGroup(masked, at, "{")
    const text = group
      ? group.text.trim()
      : /^\\[A-Za-z@]+/.exec(masked.slice(at))?.[0]
    const end = group ? group.end : at + (text?.length ?? 0)
    return text && /^\\[A-Za-z@]+$/.test(text) ? { name: text, end } : undefined
  }
  const command = (name: string, count: number, detail: string) => {
    const args = Array.from({ length: count }, () => "{}").join("")
    const completion: Completion = { label: name, kind: "command", detail }
    if (count) completion.apply = name + placeholders(args).text
    out.push(completion)
  }
  for (const cmd of commandsIn(masked)) {
    const line = lineOf(starts, cmd.start)
    switch (cmd.name) {
      case "label": {
        const [arg] = readArgs(masked, cmd.end, "m").args
        if (arg?.text.trim())
          out.push({
            label: arg.text.trim(),
            kind: "reference",
            detail: `label on line ${line}`,
          })
        break
      }
      case "newcommand":
      case "renewcommand":
      case "providecommand":
      case "DeclareRobustCommand": {
        const star = readArgs(masked, cmd.end, "*")
        const name = nameAt(star.end)
        if (!name) break
        const [count] = readArgs(masked, name.end, "o").args
        command(
          name.name,
          Number(count?.text.trim()) || 0,
          `defined on line ${line}`
        )
        break
      }
      case "DeclareMathOperator": {
        const name = nameAt(readArgs(masked, cmd.end, "*").end)
        if (name) command(name.name, 0, `operator defined on line ${line}`)
        break
      }
      case "NewDocumentCommand":
      case "RenewDocumentCommand":
      case "ProvideDocumentCommand": {
        const name = nameAt(cmd.end)
        if (!name) break
        const [spec] = readArgs(masked, name.end, "m").args
        command(
          name.name,
          (spec?.text.match(/m/g) ?? []).length,
          `defined on line ${line}`
        )
        break
      }
      case "def": {
        const m = /^\s*(\\[A-Za-z@]+)((?:#\d)*)/.exec(masked.slice(cmd.end))
        if (m) command(m[1], m[2].length / 2, `defined on line ${line}`)
        break
      }
      case "newenvironment":
      case "renewenvironment":
      case "NewDocumentEnvironment":
      case "newtheorem": {
        const { args } = readArgs(masked, cmd.end, "*m")
        const name = args[0]?.text.trim()
        if (!name || !/^[A-Za-z@*]+$/.test(name)) break
        out.push({
          label: name,
          kind: "environment",
          detail:
            cmd.name === "newtheorem"
              ? `theorem defined on line ${line}`
              : `defined on line ${line}`,
          apply: `\\begin{${name}}\n\t\${1}\n\\end{${name}}`,
        })
        break
      }
    }
  }
  return out
}

/** Commands and environments, the catalog of packages and classes, plus what this document defines: \label names (kind "reference"), \newcommand names, and, when given, keys from .bib text (kind "citation") and project file names (kind "file"). */
export function completions(
  source: string,
  extra: { bib?: string[]; files?: string[] } = {}
): Completion[] {
  const all: Completion[] = [
    ...documentCompletions(source),
    ...catalogCommands(),
    ...catalogEnvironments(),
    ...PACKAGES.map(
      (p): Completion => ({
        label: p.name,
        kind: "package",
        detail: p.summary,
      })
    ),
    ...CLASSES.map(
      ([name, detail]): Completion => ({ label: name, kind: "class", detail })
    ),
  ]
  for (const bib of extra.bib ?? []) {
    // A bare key is accepted as well as .bib text.
    if (!bib.includes("@") && /^[^\s,{}]+$/.test(bib.trim()))
      all.push({ label: bib.trim(), kind: "citation" })
    else
      for (const entry of bibEntries(bib))
        all.push({
          label: entry.key,
          kind: "citation",
          detail: entry.description || entry.type,
        })
  }
  for (const file of extra.files ?? []) all.push({ label: file, kind: "file" })
  const seen = new Set<string>()
  return all.filter((c) => {
    const key = `${c.kind} ${c.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ---- Catalogs --------------------------------------------------------------

// One command per line: name, its arguments ({} required, [] optional, with
// the placeholder text), then what it does. "@detail: a b c" lists commands
// without arguments that share a description.
const COMMAND_DATA = String.raw`
part{title} Part heading
chapter{title} Chapter heading
chapter*{title} Unnumbered chapter heading
section{title} Section heading
section*{title} Unnumbered section heading
subsection{title} Subsection heading
subsection*{title} Unnumbered subsection heading
subsubsection{title} Subsubsection heading
subsubsection*{title} Unnumbered subsubsection heading
paragraph{title} Run-in paragraph heading
subparagraph{title} Run-in subparagraph heading
appendix Start the appendices
tableofcontents Table of contents
listoffigures List of figures
listoftables List of tables
maketitle Print the title, author and date
title{title} Document title
author{name} Author; separate several with \and
date{date} Date under the title
thanks{text} Footnote on the title or an author
and Separates authors in \author
today Today's date
frontmatter Front matter: roman page numbers (book)
mainmatter Main matter (book)
backmatter Back matter (book)
documentclass[options]{class} Document class
usepackage{package} Load a package
RequirePackage{package} Load a package from a package or class
input{file} Insert another file here
include{file} Include a chapter file, starting a new page
includeonly{files} Compile only these \include files
subfile{file} Include a file that also compiles alone (subfiles)
begin{environment} Start an environment
end{environment} End an environment
label{name} Name this place for cross-references
ref{label} Number of a label
pageref{label} Page of a label
eqref{label} Equation number in parentheses (amsmath)
autoref{label} Number with its name, e.g. "Figure 2" (hyperref)
nameref{label} Title of a labelled section (hyperref)
cref{label} Reference with its name (cleveref)
Cref{label} Reference with its name, capitalised (cleveref)
cite{key} Citation
nocite{key} List in the bibliography without citing; * lists all
citep{key} Parenthetical citation (natbib)
citet{key} Textual citation (natbib)
citeauthor{key} Author of a citation (natbib)
citeyear{key} Year of a citation (natbib)
parencite{key} Citation in parentheses (biblatex)
textcite{key} Citation as part of the sentence (biblatex)
autocite{key} Citation in the style's preferred form (biblatex)
footcite{key} Citation in a footnote (biblatex)
printbibliography Print the bibliography (biblatex)
addbibresource{file.bib} Bibliography file (biblatex)
bibliography{file} Bibliography from a .bib file (BibTeX)
bibliographystyle{plain} Bibliography style (BibTeX)
bibitem{key} Entry in thebibliography
footnote{text} Footnote
footnotemark Footnote mark only
footnotetext{text} Footnote text only
marginpar{text} Note in the margin
caption{text} Caption of a figure or table
captionof{figure}{text} Caption outside a float (caption)
newpage Start a new page
clearpage New page after placing waiting figures and tables
cleardoublepage New right-hand page
pagebreak Page break, stretching the page
nopagebreak Avoid a page break here
linebreak Line break, stretching the line
newline New line
noindent No indent for this paragraph
indent Indent this paragraph
par End the paragraph
centering Centre what follows
raggedright Ragged right margin from here
raggedleft Ragged left margin from here
hfill Push what follows to the right
vfill Push what follows to the bottom
hspace{length} Horizontal space
hspace*{length} Horizontal space kept at line starts
vspace{length} Vertical space
vspace*{length} Vertical space kept at page tops
smallskip Small vertical space
medskip Medium vertical space
bigskip Big vertical space
quad Space of 1em
qquad Space of 2em
enspace Space of half an em
textbf{text} Bold
textit{text} Italic
emph{text} Emphasis (italic, or upright inside italic)
underline{text} Underline
texttt{text} Typewriter
textsc{text} Small capitals
textsf{text} Sans serif
textrm{text} Roman
textsl{text} Slanted
textup{text} Upright
textmd{text} Medium weight
textnormal{text} Normal font
textsuperscript{text} Superscript text
textsubscript{text} Subscript text
MakeUppercase{text} Upper case
MakeLowercase{text} Lower case
@Font from here on: bfseries itshape ttfamily scshape sffamily rmfamily mdseries upshape slshape normalfont
@Font size from here on: tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge
fontsize{size}{skip} Exact font size; follow with \selectfont
selectfont Apply \fontsize
item List item
LaTeX The LaTeX logo
TeX The TeX logo
@Text symbol: ldots dots textbackslash textbar textbullet textasciitilde textasciicircum textdegree copyright textregistered texttrademark dag ddag pounds textellipsis textendash textemdash textquoteleft textquoteright guillemotleft guillemotright
newcommand{\name}{definition} Define a command
renewcommand{\name}{definition} Redefine a command
providecommand{\name}{definition} Define a command unless it exists
newenvironment{name}{before}{after} Define an environment
renewenvironment{name}{before}{after} Redefine an environment
NewDocumentCommand{\name}{m}{definition} Define a command with an argument spec
newtheorem{name}{Title} Define a theorem-like environment
theoremstyle{definition} Style for the next \newtheorem (amsthm)
newcounter{name} Define a counter
setcounter{counter}{value} Set a counter
addtocounter{counter}{value} Add to a counter
stepcounter{counter} Increase a counter by one
arabic{counter} Counter as 1, 2, 3
roman{counter} Counter as i, ii, iii
alph{counter} Counter as a, b, c
setlength{\length}{value} Set a length
addtolength{\length}{value} Add to a length
linewidth Width of the current line
textwidth Width of the text block
textheight Height of the text block
columnwidth Width of a column
paperwidth Width of the paper
parindent Paragraph indent
parskip Space between paragraphs
baselineskip Distance between lines
tabcolsep Space between table columns
arraystretch Row height factor in tables
linespread{1.2} Line spacing factor
makebox[width]{text} Box of a given width
mbox{text} Text that is never broken
fbox{text} Framed box
framebox[width]{text} Framed box of a given width
parbox{width}{text} Paragraph in a box
raisebox{lift}{text} Raise or lower text
rule{width}{height} Filled rectangle
hrulefill Rule filling the line
dotfill Dots filling the line
phantom{text} Space as large as the text
pagestyle{plain} Page style
thispagestyle{empty} Page style of this page only
pagenumbering{arabic} Page numbering style
twocolumn Two columns from a new page
onecolumn One column from a new page
url{address} Web address
href{address}{text} Link
hypersetup{colorlinks=true} hyperref settings
texorpdfstring{with formatting}{plain text} Different text in PDF bookmarks
includegraphics[width=\linewidth]{file} Insert an image (graphicx)
graphicspath{folders} Folders to look in for images (graphicx)
rotatebox{angle}{content} Rotate (graphicx)
scalebox{factor}{content} Scale (graphicx)
resizebox{width}{height}{content} Resize; ! keeps the ratio (graphicx)
textcolor{color}{text} Coloured text (xcolor)
color{color} Colour from here on (xcolor)
colorbox{color}{text} Text on a coloured background (xcolor)
fcolorbox{frame}{background}{text} Framed coloured box (xcolor)
definecolor{name}{HTML}{1F5F8B} Define a colour (xcolor)
pagecolor{color} Page background colour (xcolor)
rowcolor{color} Row background colour (xcolor with the table option)
cellcolor{color} Cell background colour (xcolor with the table option)
toprule Top rule of a table (booktabs)
midrule Middle rule of a table (booktabs)
bottomrule Bottom rule of a table (booktabs)
cmidrule{2-3} Rule under some columns (booktabs)
addlinespace Extra space between rows (booktabs)
hline Horizontal line in a table
cline{2-3} Line under some columns
multicolumn{2}{c}{text} Cell spanning columns
multirow{2}{*}{text} Cell spanning rows (multirow)
arraybackslash Restores \\ after \centering in a column (array)
tabularnewline End a table row
setlist{options} List settings (enumitem)
titleformat{\section}{\large\bfseries}{\thesection}{1em}{} Heading format (titlesec)
titlespacing*{\section}{0pt}{12pt}{6pt} Heading spacing (titlesec)
titlerule Rule under a heading (titlesec)
fancyhf{} Clear headers and footers (fancyhdr)
fancyhead[L]{text} Header (fancyhdr)
fancyfoot[C]{text} Footer (fancyhdr)
geometry{margin=1in} Page size and margins (geometry)
newgeometry{margin=1in} New margins from here (geometry)
restoregeometry Back to the first margins (geometry)
onehalfspacing One-and-a-half line spacing (setspace)
doublespacing Double line spacing (setspace)
lipsum[1] Dummy text (lipsum)
lstinputlisting{file} Code listing from a file (listings)
lstset{options} Code listing settings (listings)
lstinline Inline code (listings)
verb Inline verbatim text
SI{value}{unit} Quantity with a unit (siunitx)
qty{value}{unit} Quantity with a unit (siunitx 3)
num{number} Formatted number (siunitx)
unit{unit} Unit on its own (siunitx 3)
usetikzlibrary{library} Load TikZ libraries
tikz{commands} Inline TikZ drawing
draw Draw a path (TikZ)
fill Fill a path (TikZ)
node Place text (TikZ)
coordinate Name a point (TikZ)
addplot Plot data or a function (pgfplots)
pause Show the rest on the next slide (beamer)
frametitle{title} Frame title (beamer)
framesubtitle{text} Frame subtitle (beamer)
titlepage Title page (beamer)
usetheme{Madrid} Beamer theme
usecolortheme{beaver} Beamer colour theme
alert{text} Highlighted text (beamer)
only Show only on some slides (beamer)
uncover Reveal on some slides (beamer)
onslide Slide range for what follows (beamer)
institute{name} Institution (beamer)
subtitle{text} Subtitle (beamer)
todo{note} Note in the margin (todonotes)
signature{name} Name under the closing (letter)
address{address} Sender's address (letter)
opening{Dear Sir or Madam,} Opening of a letter (letter)
closing{Yours faithfully,} Closing of a letter (letter)
encl{list} Enclosures (letter)
cc{names} Copies to (letter)
ps P.S. (letter)
faEnvelope Envelope icon (fontawesome5)
faPhone Phone icon (fontawesome5)
faGithub GitHub icon (fontawesome5)
faLinkedin LinkedIn icon (fontawesome5)
faGlobe Globe icon (fontawesome5)
faMapMarker Map pin icon (fontawesome5)
frac{num}{den} Fraction
dfrac{num}{den} Fraction in display size (amsmath)
tfrac{num}{den} Fraction in text size (amsmath)
sqrt{x} Square root; [n] for the n-th root
binom{n}{k} Binomial coefficient (amsmath)
text{text} Text inside maths (amsmath)
mathrm{text} Roman letters in maths
mathbf{text} Bold letters in maths
mathit{text} Italic letters in maths
mathsf{text} Sans serif letters in maths
mathtt{text} Typewriter letters in maths
mathcal{X} Calligraphic capitals
mathbb{R} Blackboard bold (amssymb)
mathfrak{g} Fraktur (amssymb)
mathscr{L} Script capitals (mathrsfs)
boldsymbol{x} Bold symbol (amsmath)
bm{x} Bold symbol (bm)
operatorname{name} Upright operator name (amsmath)
DeclareMathOperator{\name}{name} Define an operator (amsmath)
left Delimiter that grows with its contents
right Closing delimiter for \left
hat{x} Hat accent
widehat{xy} Wide hat accent
bar{x} Bar accent
overline{x} Line over
underline{x} Line under
vec{x} Vector arrow
tilde{x} Tilde accent
widetilde{xy} Wide tilde accent
dot{x} Dot accent
ddot{x} Double dot accent
overrightarrow{AB} Arrow over
overbrace{x}^{text} Brace over
underbrace{x}_{text} Brace under
stackrel{top}{relation} Symbol over a relation
overset{top}{x} Symbol over (amsmath)
underset{bottom}{x} Symbol under (amsmath)
substack{lines} Several lines under a sum (amsmath)
tag{label} Own equation tag (amsmath)
notag No number for this line (amsmath)
nonumber No number for this line
intertext{text} Text between aligned lines (amsmath)
displaystyle Display-size maths
limits Limits above and below
ensuremath{maths} Maths whether or not in a formula
@Greek letter: alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
@Relation: leq geq neq approx equiv sim simeq cong propto ll gg subset subseteq supset supseteq in notin ni perp parallel mid models vdash prec succ preceq succeq
@Binary operator: times cdot div pm mp cap cup setminus wedge vee oplus otimes circ bullet star ast odot
@Arrow: to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow mapsto implies iff uparrow downarrow longrightarrow longleftarrow Longrightarrow hookrightarrow
@Symbol: infty partial nabla forall exists nexists emptyset varnothing ell hbar Re Im aleph angle triangle prime neg top bot cdots vdots ddots checkmark square
@Big operator: sum prod int iint iiint oint bigcup bigcap bigoplus bigotimes coprod
@Function name: sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg exp lim limsup liminf sup inf max min arg det dim gcd deg ker Pr hom
@Delimiter: langle rangle lceil rceil lfloor rfloor lvert rvert lVert rVert
`

// Environments, in the same form. A trailing "*kind" picks the body that is
// inserted between \begin and \end.
const ENVIRONMENT_DATA = String.raw`
document The document's body
itemize Bulleted list *list
enumerate Numbered list *list
description List of terms and descriptions *desc
figure[htbp] Figure with a caption *figure
table[htbp] Table with a caption *table
tabular{ll} Table *rows
tabularx{\linewidth}{lX} Table with stretching X columns (tabularx) *rows
longtable{ll} Table that breaks across pages (longtable) *rows
array{cc} Array inside maths *rows
center Centred lines
flushleft Left-aligned lines
flushright Right-aligned lines
quote Short quotation
quotation Quotation of several paragraphs
verse Poetry
abstract Abstract
minipage{0.48\linewidth} Box of a given width
verbatim Text exactly as typed
lstlisting[language=Python] Code listing (listings)
minted{python} Highlighted code (minted; needs shell escape)
equation Numbered equation
equation* Unnumbered equation (amsmath)
align Equations aligned at & (amsmath) *align
align* Unnumbered aligned equations (amsmath) *align
gather Centred equations (amsmath)
gather* Unnumbered centred equations (amsmath)
multline Equation over several lines (amsmath)
multline* Unnumbered equation over several lines (amsmath)
flalign Equations aligned to both margins (amsmath) *align
split Split one equation over lines (amsmath) *align
aligned Aligned block inside an equation (amsmath) *align
cases Cases with a brace (amsmath) *cases
matrix Matrix without delimiters (amsmath) *matrix
pmatrix Matrix in parentheses (amsmath) *matrix
bmatrix Matrix in brackets (amsmath) *matrix
Bmatrix Matrix in braces (amsmath) *matrix
vmatrix Determinant (amsmath) *matrix
Vmatrix Norm matrix (amsmath) *matrix
smallmatrix Small matrix for running text (amsmath) *matrix
proof Proof ending with a box (amsthm)
theorem Theorem (define it with \newtheorem)
lemma Lemma (define it with \newtheorem)
definition Definition (define it with \newtheorem)
corollary Corollary (define it with \newtheorem)
proposition Proposition (define it with \newtheorem)
example Example (define it with \newtheorem)
remark Remark (define it with \newtheorem)
thebibliography{99} Bibliography written by hand *bib
frame{title} Slide (beamer)
block{title} Block (beamer)
alertblock{title} Highlighted block (beamer)
exampleblock{title} Example block (beamer)
columns Columns on a slide (beamer) *columns
column{0.5\textwidth} One column (beamer)
tikzpicture Drawing (TikZ)
axis Plot axes (pgfplots)
subfigure{0.48\linewidth} Sub-figure with its own caption (subcaption)
wrapfigure{r}{0.4\linewidth} Figure with text flowing around it (wrapfig)
multicols{2} Several columns of text (multicol)
titlepage Page for the title
letter{recipient} One letter (letter class)
tcolorbox[title=Title] Coloured box (tcolorbox)
algorithm Algorithm float (algorithm)
algorithmic Pseudocode (algpseudocode)
comment Text left out of the document (comment)
landscape Landscape pages (pdflscape)
spacing{1.5} Line spacing for a passage (setspace)
`

/** Document classes the editor offers after \documentclass. */
const CLASSES: [string, string][] = [
  ["article", "Articles, reports and short documents"],
  ["report", "Longer reports with chapters"],
  ["book", "Books, with front and back matter"],
  ["letter", "Letters"],
  ["beamer", "Slides"],
  ["memoir", "Books and reports with many layout options"],
  ["scrartcl", "KOMA-Script article"],
  ["scrreprt", "KOMA-Script report"],
  ["scrbook", "KOMA-Script book"],
  ["scrlttr2", "KOMA-Script letter"],
  ["amsart", "American Mathematical Society article"],
  ["amsbook", "American Mathematical Society book"],
  ["extarticle", "article with sizes from 8pt to 20pt"],
  ["standalone", "A single picture or formula, cropped"],
  ["moderncv", "Resumes in a modern style"],
  ["IEEEtran", "IEEE journal and conference papers"],
  ["exam", "Exams and problem sets"],
  ["tufte-handout", "Handouts with wide margins for notes"],
]

export type PackageInfo = {
  name: string
  summary: string
  category: string
  options?: string[]
  snippet?: string
}

type PackageRow = [
  name: string,
  summary: string,
  options?: string[],
  snippet?: string,
]
const group = (category: string, rows: PackageRow[]): PackageInfo[] =>
  rows.map(([name, summary, options, snippet]) => ({
    name,
    summary,
    category,
    ...(options ? { options } : {}),
    ...(snippet ? { snippet } : {}),
  }))

/** Packages people reach for, by what they are for. */
export const PACKAGES: PackageInfo[] = [
  ...group("Page layout", [
    [
      "geometry",
      "Sets the paper size and margins in one line.",
      [
        "margin=1in",
        "a4paper",
        "letterpaper",
        "landscape",
        "top=",
        "bottom=",
        "left=",
        "right=",
      ],
      "\\usepackage[margin=1in]{geometry}",
    ],
    [
      "fancyhdr",
      "Custom headers and footers.",
      undefined,
      "\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyfoot[C]{\\thepage}",
    ],
    [
      "titlesec",
      "Changes how section headings look and how much space surrounds them.",
      ["compact", "small"],
      "\\titleformat{\\section}{\\large\\bfseries}{\\thesection}{1em}{}",
    ],
    ["titling", "Control over the title block made by \\maketitle."],
    ["tocloft", "Changes how the table of contents and lists of figures look."],
    [
      "setspace",
      "Line spacing: \\onehalfspacing, \\doublespacing.",
      ["onehalfspacing", "doublespacing"],
    ],
    ["parskip", "Space between paragraphs instead of indents."],
    [
      "multicol",
      "Text in several columns, balanced on the last page.",
      undefined,
      "\\begin{multicols}{2}\n...\n\\end{multicols}",
    ],
    [
      "pdflscape",
      "Landscape pages inside a portrait document, turned in the PDF.",
    ],
    [
      "lastpage",
      'The number of the last page, for "Page 2 of 5".',
      undefined,
      "Page \\thepage\\ of \\pageref{LastPage}",
    ],
    ["changepage", "Changes the margins for a passage with adjustwidth."],
    [
      "ragged2e",
      "Better ragged-right text that still hyphenates: \\RaggedRight, \\justifying.",
    ],
    [
      "microtype",
      "Subtle spacing and margin tweaks that make text look better and fit more.",
    ],
    ["fullpage", "Narrow margins without choosing them yourself."],
    ["emptypage", "Leaves the pages blank that \\cleardoublepage adds."],
  ]),
  ...group("Fonts", [
    [
      "fontenc",
      "Font encoding. T1 gives accented letters that hyphenate and copy correctly.",
      ["T1"],
      "\\usepackage[T1]{fontenc}",
    ],
    [
      "inputenc",
      "Input encoding for pdfLaTeX; UTF-8 is the default in current LaTeX.",
      ["utf8"],
    ],
    ["lmodern", "Latin Modern, the scalable version of LaTeX's standard font."],
    [
      "fontspec",
      "Use any OpenType or TrueType font (XeLaTeX or LuaLaTeX only).",
      undefined,
      "\\setmainfont{TeX Gyre Pagella}",
    ],
    [
      "fontawesome5",
      "Font Awesome icons: \\faEnvelope, \\faPhone, \\faGithub, \\faLinkedin.",
      undefined,
      "\\faEnvelope\\ name@example.com",
    ],
    ["anyfontsize", "Lets \\fontsize use any size without warnings."],
    [
      "textcomp",
      "Extra text symbols; built into current LaTeX, kept for old documents.",
    ],
    ["newtxtext", "Times-like text font; pair with newtxmath."],
    ["newpxtext", "Palatino-like text font; pair with newpxmath."],
  ]),
  ...group("Math", [
    [
      "amsmath",
      "The standard for maths: align, gather, cases, \\text, \\eqref and more.",
      ["fleqn", "leqno"],
    ],
    ["amssymb", "Extra maths symbols and blackboard bold, \\mathbb{R}."],
    [
      "amsthm",
      "Theorem, lemma and proof environments.",
      undefined,
      "\\newtheorem{theorem}{Theorem}[section]",
    ],
    [
      "mathtools",
      "Fixes and extras for amsmath (loads it): \\coloneqq, paired delimiters.",
    ],
    ["thmtools", "Easier theorem styles and a list of theorems."],
    ["bm", "Bold maths symbols with \\bm."],
    ["mathrsfs", "Script capitals with \\mathscr."],
    [
      "siunitx",
      "Numbers and units typeset consistently: \\qty{9.81}{m/s^2}.",
      undefined,
      "\\qty{3.2}{\\kilo\\gram}",
    ],
    ["cancel", "Strike through terms in a formula with \\cancel."],
    ["nicefrac", "Diagonal fractions such as \\nicefrac{1}{2}."],
    ["physics", "Shortcuts for derivatives, brackets and vectors in physics."],
    [
      "mhchem",
      "Chemical formulas and equations with \\ce{H2O}.",
      ["version=4"],
    ],
    ["unicode-math", "OpenType maths fonts (XeLaTeX or LuaLaTeX only)."],
    ["esint", "More integral signs, such as \\oiint."],
  ]),
  ...group("Graphics", [
    [
      "graphicx",
      "Images with \\includegraphics, plus rotating and scaling.",
      undefined,
      "\\includegraphics[width=0.8\\linewidth]{image}",
    ],
    ["adjustbox", "Scale, trim, frame and align boxes with key=value options."],
    ["overpic", "Write text or arrows on top of an image."],
    [
      "pdfpages",
      "Insert pages of another PDF into the document.",
      undefined,
      "\\includepdf[pages=-]{file.pdf}",
    ],
    ["rotating", "Rotated figures and tables (sidewaysfigure, sidewaystable)."],
    [
      "svg",
      "SVG images; needs Inkscape and shell escape, so it rarely works online.",
    ],
  ]),
  ...group("Tables", [
    [
      "array",
      "Column types with formatting, such as >{\\centering\\arraybackslash}p{3cm}.",
    ],
    [
      "booktabs",
      "Clean professional table rules: \\toprule, \\midrule, \\bottomrule.",
    ],
    [
      "tabularx",
      "Tables of a set width with stretching X columns.",
      undefined,
      "\\begin{tabularx}{\\linewidth}{lX}\n...\n\\end{tabularx}",
    ],
    ["tabulary", "Tables whose columns share the width by content."],
    ["longtable", "Tables that continue across pages."],
    ["multirow", "Cells spanning several rows."],
    ["makecell", "Line breaks and formatting inside table cells."],
    [
      "colortbl",
      "Coloured table rows and cells (or use xcolor's table option).",
    ],
    ["threeparttable", "Tables with notes underneath, aligned to the table."],
    ["diagbox", "A diagonal line in the corner cell of a table."],
    ["dcolumn", "Columns aligned on the decimal point."],
  ]),
  ...group("Lists", [
    [
      "enumitem",
      "Control over list spacing, labels and indents.",
      ["inline", "shortlabels"],
      "\\begin{itemize}[noitemsep]\n...\n\\end{itemize}",
    ],
    ["paralist", "Compact and inline lists (older than enumitem)."],
    ["tasks", "Horizontal lists in columns, for exercises."],
  ]),
  ...group("Colours and boxes", [
    [
      "xcolor",
      "Colours by name, mix or code: \\textcolor, \\definecolor.",
      ["dvipsnames", "svgnames", "table"],
      "\\definecolor{accent}{HTML}{1F5F8B}",
    ],
    [
      "tcolorbox",
      "Coloured, framed boxes with titles; highly configurable.",
      ["most"],
      "\\begin{tcolorbox}[title=Note]\n...\n\\end{tcolorbox}",
    ],
    ["mdframed", "Framed boxes that break across pages."],
    ["framed", "Simple frames and shaded backgrounds around text."],
  ]),
  ...group("Links and references", [
    [
      "hyperref",
      "Clickable links, PDF bookmarks and metadata. Load it last.",
      ["hidelinks", "colorlinks", "pdfusetitle"],
      "\\href{https://example.com}{text}",
    ],
    [
      "cleveref",
      'References that name what they point to: \\cref gives "Figure 3". Load after hyperref.',
      ["capitalise", "nameinlink"],
    ],
    ["url", "Web addresses that break across lines, with \\url."],
    ["bookmark", "Better PDF bookmarks than hyperref alone."],
    ["varioref", 'References with page hints: "on the next page".'],
    ["xr", "References to labels in another document."],
  ]),
  ...group("Bibliography", [
    [
      "biblatex",
      "Modern bibliographies with many styles; usually run with Biber.",
      ["style=authoryear", "style=numeric", "style=apa", "backend=biber"],
      "\\addbibresource{references.bib}\n...\n\\printbibliography",
    ],
    [
      "natbib",
      "Author-year and numeric citations with BibTeX: \\citet, \\citep.",
      ["numbers", "round", "sort&compress"],
    ],
    ["cite", "Sorted, compressed numeric citations like [1-4]."],
    ["doi", "Clickable DOIs in the bibliography."],
    ["csquotes", "Quotation marks right for the language: \\enquote."],
  ]),
  ...group("Code listings", [
    [
      "listings",
      "Code listings with syntax colouring, no external tools.",
      undefined,
      "\\begin{lstlisting}[language=Python]\n...\n\\end{lstlisting}",
    ],
    [
      "minted",
      "High-quality code highlighting with Pygments; needs shell escape.",
    ],
    ["fancyvrb", "Verbatim text with frames, line numbers and colours."],
    ["verbatim", "A better verbatim environment and \\verbatiminput."],
    ["algorithm2e", "Algorithms in pseudocode, with its own syntax."],
    ["algorithm", "A float for algorithms, with a caption."],
    [
      "algpseudocode",
      "Pseudocode commands: \\If, \\For, \\State (algorithmicx).",
    ],
  ]),
  ...group("Languages", [
    [
      "babel",
      "Hyphenation, dates and labels in other languages (pdfLaTeX).",
      ["english", "french", "german", "spanish", "british"],
      "\\usepackage[english]{babel}",
    ],
    ["polyglossia", "Languages for XeLaTeX and LuaLaTeX."],
    ["xeCJK", "Chinese, Japanese and Korean text with XeLaTeX."],
  ]),
  ...group("Floats", [
    ["float", "The [H] placement: put the figure exactly here."],
    [
      "caption",
      "Caption formatting and \\captionof for captions outside floats.",
      ["font=small", "labelfont=bf"],
    ],
    [
      "subcaption",
      "Sub-figures with their own captions: (a), (b).",
      undefined,
      "\\begin{subfigure}{0.48\\linewidth}\n...\n\\end{subfigure}",
    ],
    ["wrapfig", "Figures with text flowing around them."],
    ["placeins", "\\FloatBarrier stops figures drifting past a point."],
    ["afterpage", "Run something after the current page, such as \\clearpage."],
  ]),
  ...group("Drawing", [
    [
      "tikz",
      "Drawings and diagrams written in LaTeX.",
      undefined,
      "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}",
    ],
    [
      "pgfplots",
      "Plots of data and functions, built on TikZ.",
      undefined,
      "\\pgfplotsset{compat=1.18}",
    ],
    ["tikz-cd", "Commutative diagrams."],
    ["circuitikz", "Electrical circuits."],
    ["forest", "Trees, such as syntax trees."],
    ["chemfig", "Chemical structure formulas."],
    ["pgfgantt", "Gantt charts."],
  ]),
  ...group("Slides", [
    [
      "appendixnumberbeamer",
      "Backup slides after \\appendix do not count in the frame total.",
    ],
    ["pgfpages", "Several slides per page, or notes on a second screen."],
    ["animate", "Animations from frames or images in the PDF."],
  ]),
  ...group("Utilities", [
    ["etoolbox", "Tools for package writers: hooks, patches, tests."],
    ["xparse", "Commands with flexible arguments; built into current LaTeX."],
    ["ifthen", "Conditionals: \\ifthenelse."],
    ["calc", "Arithmetic in lengths: \\setlength{\\x}{\\linewidth-2cm}."],
    ["xspace", "Space after a command used in text, only where needed."],
    ["lipsum", "Dummy text: \\lipsum[1-3]."],
    ["blindtext", "Dummy text and whole dummy documents."],
    ["todonotes", "Notes in the margin and a list of to-dos.", ["disable"]],
    ["comment", "Leave out passages with \\begin{comment}."],
    ["datetime2", "Dates and times in many formats."],
    [
      "ulem",
      "Underline and strike out that break across lines: \\uline, \\sout.",
      ["normalem"],
    ],
    ["soul", "Highlight, letter-space and underline: \\hl."],
    ["footmisc", "Footnote options: symbols, bottom placement."],
    [
      "appendix",
      "Appendices with their own headings and table of contents entries.",
    ],
    ["glossaries", "Glossaries and lists of acronyms."],
    ["imakeidx", "Indexes, built in one run."],
    ["subfiles", "Parts of a document that also compile on their own."],
    ["import", "\\import and \\subimport with paths relative to the file."],
    ["standalone", "Include pictures made with the standalone class."],
    ["eurosym", "The euro sign: \\euro."],
    ["relsize", "Font sizes relative to the current one."],
    ["textpos", "Place text at exact positions on the page."],
    ["eso-pic", "Put things on every page's background, such as a watermark."],
  ]),
]

export type FontInfo = {
  id: string
  name: string
  kind: "serif" | "sans" | "mono" | "math" | "icons"
  engine: "pdflatex" | "xelatex" | "any"
  /** Lines for the preamble. */
  preamble: string
  description: string
}

const T1 = "\\usepackage[T1]{fontenc}"
const SANS_DEFAULT = "\\renewcommand{\\familydefault}{\\sfdefault}"
// newtxmath and newpxmath define \Bbbk, which amssymb also defines.
const BBBK = "\\let\\Bbbk\\relax"
/** fontspec loading OpenType files by name, so no installed fonts are needed. */
const fontFiles = (
  family: string,
  upright: string,
  bold: string,
  italic: string,
  boldItalic: string
) =>
  [
    "\\usepackage{fontspec}",
    `\\setmainfont{${family}}[`,
    "  Extension = .otf,",
    `  UprightFont = *${upright},`,
    `  BoldFont = *${bold},`,
    `  ItalicFont = *${italic},`,
    `  BoldItalicFont = *${boldItalic}`,
    "]",
  ].join("\n")
const font = (
  id: string,
  name: string,
  kind: FontInfo["kind"],
  engine: FontInfo["engine"],
  preamble: string[] | string,
  description: string
): FontInfo => ({
  id,
  name,
  kind,
  engine,
  preamble: Array.isArray(preamble) ? preamble.join("\n") : preamble,
  description,
})

/** Fonts the font menu offers. */
export const FONTS: FontInfo[] = [
  font(
    "latin-modern",
    "Latin Modern",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{lmodern}"],
    "LaTeX's classic look, as a scalable font with proper accents. The safe default."
  ),
  font(
    "times",
    "Times (newtx)",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{newtxtext}", BBBK, "\\usepackage{newtxmath}"],
    "Times-like text with matching maths. Compact; common in journals and resumes."
  ),
  font(
    "termes",
    "TeX Gyre Termes",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{tgtermes}"],
    "Times-like text; maths stays in Computer Modern."
  ),
  font(
    "palatino",
    "Palatino (newpx)",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{newpxtext}", BBBK, "\\usepackage{newpxmath}"],
    "Palatino-like text with matching maths. Elegant and easy to read."
  ),
  font(
    "pagella",
    "TeX Gyre Pagella",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{tgpagella}"],
    "Palatino-like text; maths stays in Computer Modern."
  ),
  font(
    "charter",
    "Charter",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{charter}"],
    "Bitstream Charter: sturdy, clear on screens and in print."
  ),
  font(
    "libertine",
    "Linux Libertine",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{libertine}", BBBK, "\\usepackage[libertine]{newtxmath}"],
    "A warm book face with matching maths; Biolinum is its sans."
  ),
  font(
    "ebgaramond",
    "EB Garamond",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{ebgaramond}"],
    "A classic Garamond for books and humanities papers."
  ),
  font(
    "bookman",
    "Bookman (TeX Gyre Bonum)",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{tgbonum}"],
    "A wide, friendly serif."
  ),
  font(
    "schoolbook",
    "New Century Schoolbook",
    "serif",
    "pdflatex",
    [T1, "\\usepackage{fouriernc}"],
    "Very legible serif with matching maths (Fourier)."
  ),
  font(
    "helvetica",
    "Helvetica (TeX Gyre Heros)",
    "sans",
    "pdflatex",
    [T1, "\\usepackage{tgheros}", SANS_DEFAULT],
    "The familiar neutral sans, for the whole document."
  ),
  font(
    "latin-modern-sans",
    "Latin Modern Sans",
    "sans",
    "pdflatex",
    [T1, "\\usepackage{lmodern}", SANS_DEFAULT],
    "LaTeX's own sans serif, for the whole document."
  ),
  font(
    "fira-sans",
    "Fira Sans",
    "sans",
    "pdflatex",
    [T1, "\\usepackage[sfdefault]{FiraSans}"],
    "Mozilla's humanist sans; popular for slides and resumes."
  ),
  font(
    "roboto",
    "Roboto",
    "sans",
    "pdflatex",
    [T1, "\\usepackage[sfdefault]{roboto}"],
    "Google's sans from Android; modern and compact."
  ),
  font(
    "lato",
    "Lato",
    "sans",
    "pdflatex",
    [T1, "\\usepackage[default]{lato}"],
    "A warm, rounded sans for resumes and reports."
  ),
  font(
    "inconsolata",
    "Inconsolata",
    "mono",
    "pdflatex",
    [T1, "\\usepackage[varqu,varl]{inconsolata}"],
    "A clear typewriter font for code, with straight quotes."
  ),
  font(
    "fira-mono",
    "Fira Mono",
    "mono",
    "pdflatex",
    [T1, "\\usepackage{FiraMono}"],
    "Fira's monospaced companion, for code."
  ),
  font(
    "euler",
    "Euler maths",
    "math",
    "pdflatex",
    ["\\usepackage{eulervm}"],
    "Hermann Zapf's handwritten-looking maths letters; pairs with Palatino."
  ),
  font(
    "fontawesome",
    "Font Awesome icons",
    "icons",
    "any",
    ["\\usepackage{fontawesome5}"],
    "Icons for contact lines: \\faEnvelope, \\faPhone, \\faGithub, \\faLinkedin."
  ),
  font(
    "xe-latin-modern",
    "Latin Modern (OpenType)",
    "serif",
    "xelatex",
    ["\\usepackage{fontspec}"],
    "fontspec's default font. Needs XeLaTeX."
  ),
  font(
    "xe-pagella",
    "TeX Gyre Pagella (OpenType)",
    "serif",
    "xelatex",
    fontFiles("texgyrepagella", "-regular", "-bold", "-italic", "-bolditalic"),
    "Palatino-like, loaded from the font files that come with TeX. Needs XeLaTeX."
  ),
  font(
    "xe-heros",
    "TeX Gyre Heros (OpenType)",
    "sans",
    "xelatex",
    fontFiles("texgyreheros", "-regular", "-bold", "-italic", "-bolditalic"),
    "Helvetica-like, loaded from the font files that come with TeX. Needs XeLaTeX."
  ),
  font(
    "xe-libertinus",
    "Libertinus Serif (OpenType)",
    "serif",
    "xelatex",
    fontFiles("LibertinusSerif", "-Regular", "-Bold", "-Italic", "-BoldItalic"),
    "The maintained successor to Linux Libertine. Needs XeLaTeX."
  ),
  font(
    "xe-math",
    "Latin Modern Math (OpenType)",
    "math",
    "xelatex",
    ["\\usepackage{unicode-math}", "\\setmathfont{latinmodern-math.otf}"],
    "OpenType maths for XeLaTeX. Do not load amssymb with it."
  ),
  font(
    "xe-project",
    "Font files in this project",
    "serif",
    "xelatex",
    [
      "\\usepackage{fontspec}",
      "% Upload the font files to a fonts/ folder and change the names below.",
      "\\setmainfont{MyFont}[",
      "  Path = fonts/,",
      "  Extension = .ttf,",
      "  UprightFont = *-Regular,",
      "  BoldFont = *-Bold,",
      "  ItalicFont = *-Italic,",
      "  BoldItalicFont = *-BoldItalic",
      "]",
    ],
    "Any .ttf or .otf font you upload to the project. Needs XeLaTeX."
  ),
  font(
    "xe-system",
    "A font installed on the computer",
    "serif",
    "xelatex",
    ["\\usepackage{fontspec}", "\\setmainfont{Georgia}"],
    "A font by its installed name, such as Georgia. Works only where that font is installed; needs XeLaTeX."
  ),
]

// ---- Templates -------------------------------------------------------------

export type Template = {
  id: string
  name: string
  description: string
  category:
    | "resume"
    | "letter"
    | "article"
    | "report"
    | "slides"
    | "notes"
    | "other"
  engine: TexEngine
  /** File to compile. */
  main: string
  files: { name: string; text: string }[]
}

const RESUME_CLASSIC = String.raw`% A one-page, one-column resume. The helper commands below set the look;
% the body only uses \resumeheader, \entry, \project and the highlights list.
\documentclass[letterpaper,11pt]{article}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[left=0.6in,right=0.6in,top=0.5in,bottom=0.5in]{geometry}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{tabularx}
\usepackage[hidelinks]{hyperref}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\raggedright

% Section headings: small capitals over a full-width rule.
\titleformat{\section}{\large\scshape}{}{0pt}{}[\titlerule]
\titlespacing*{\section}{0pt}{10pt}{5pt}

% Bullet lists: tight, with a small indent.
\setlist[itemize]{leftmargin=1.2em, itemsep=1pt, parsep=0pt, topsep=2pt, partopsep=0pt}

% Separator for the contact line.
\newcommand{\sep}{\enspace\textbar\enspace}

% \resumeheader{Name}{contact line}
\newcommand{\resumeheader}[2]{%
  \begin{center}
    {\Huge\scshape #1}\\[4pt]
    \small #2
  \end{center}
  \vspace{-4pt}%
}

% \entry{Organisation}{Location}{Role or degree}{Dates}
\newcommand{\entry}[4]{%
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    \textbf{#1} & #2 \\
    \textit{\small #3} & \textit{\small #4}
  \end{tabular*}\par
}

% \project{Name}{Tools}{Dates}
\newcommand{\project}[3]{%
  \begin{tabular*}{\textwidth}{@{}l@{\extracolsep{\fill}}r@{}}
    \textbf{#1} \textbar{} \textit{\small #2} & \small #3
  \end{tabular*}\par
}

% The bullet points under an entry.
\newenvironment{highlights}{\begin{itemize}}{\end{itemize}\vspace{3pt}}

\begin{document}

\resumeheader{Maya Lindqvist}{%
  Portland, OR \sep (555) 014-2386 \sep
  \href{mailto:maya.lindqvist@example.com}{maya.lindqvist@example.com} \sep
  \href{https://example.com/maya}{example.com/maya} \sep
  \href{https://example.org/mlindqvist}{example.org/mlindqvist}}

\section{Experience}

\entry{Northwind Analytics}{Portland, OR}{Senior Software Engineer}{Mar 2022 -- Present}
\begin{highlights}
  \item Led a team of four rebuilding the reporting pipeline in Go and PostgreSQL, cutting nightly run time from 6 hours to 40 minutes.
  \item Designed a caching layer for the customer dashboard API that lowered p95 latency by 38\% and saved \$120k a year in compute.
  \item Introduced contract tests between eight services, reducing production incidents from integration bugs by half.
  \item Mentored three junior engineers through their first on-call rotations and design reviews.
\end{highlights}

\entry{Bluefin Labs}{Seattle, WA}{Software Engineer}{Jun 2019 -- Feb 2022}
\begin{highlights}
  \item Built the event ingestion service (Python, Kafka) handling 2 million events a day with 99.95\% uptime.
  \item Replaced a hand-rolled job scheduler with Airflow, giving analysts self-service access to 40 data jobs.
  \item Wrote the onboarding guide for the platform team, now used for every new hire.
\end{highlights}

\entry{Cedar Valley Credit Union}{Eugene, OR}{Software Engineering Intern}{Jun 2018 -- Sep 2018}
\begin{highlights}
  \item Automated monthly compliance reports with Python and SQL, saving the finance team two days each month.
  \item Added accessibility fixes to the member portal, bringing it to WCAG 2.1 AA.
\end{highlights}

\section{Projects}

\project{Trailhead}{TypeScript, React, SQLite}{2023}
\begin{highlights}
  \item Open-source trip planner for hiking groups with offline maps; 1,200 monthly users.
  \item Wrote a route-sharing format and importer used by two other hiking apps.
\end{highlights}

\project{ledger-lint}{Rust}{2021}
\begin{highlights}
  \item Command-line checker for plain-text accounting files that finds unbalanced entries and typos in account names.
\end{highlights}

\section{Education}

\entry{University of Oregon}{Eugene, OR}{B.S. in Computer Science, minor in Mathematics}{2015 -- 2019}
\begin{highlights}
  \item GPA 3.8/4.0. Teaching assistant for Data Structures (two terms).
\end{highlights}

\section{Skills}

\begin{tabularx}{\textwidth}{@{}l X@{}}
  \textbf{Languages} & Go, Python, TypeScript, SQL, Rust, Bash \\
  \textbf{Tools} & PostgreSQL, Kafka, Airflow, Docker, Kubernetes, Terraform, AWS \\
  \textbf{Practices} & System design, code review, testing strategy, incident response
\end{tabularx}

\end{document}
`

const RESUME_MODERN = String.raw`% A resume with a coloured header band and two columns: a sidebar for
% contact details and skills, and a main column for experience.
\documentclass[letterpaper,10pt]{article}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[margin=0.5in]{geometry}
\usepackage{xcolor}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}

% Latin Modern Sans throughout.
\renewcommand{\familydefault}{\sfdefault}

% Change these two colours to restyle the whole page.
\definecolor{accent}{HTML}{1F5F8B}
\definecolor{muted}{HTML}{5A5A5A}

\pagestyle{empty}
\setlength{\parindent}{0pt}

% Headings: bold capitals in the accent colour over a thin rule.
\titleformat{\section}{\color{accent}\normalsize\bfseries}{}{0pt}{\MakeUppercase}[{\color{accent}\titlerule[0.8pt]}]
\titlespacing*{\section}{0pt}{10pt}{5pt}

\setlist[itemize]{leftmargin=1em, label={\color{accent}\textbullet}, itemsep=1pt, parsep=0pt, topsep=2pt}

% \headerband{Name}{Headline}
\newcommand{\headerband}[2]{%
  \noindent\colorbox{accent}{%
    \parbox{\dimexpr\textwidth-2\fboxsep\relax}{%
      \vspace{8pt}%
      \hspace{6pt}{\color{white}\fontsize{24}{28}\selectfont\bfseries #1}\par
      \vspace{4pt}%
      \hspace{6pt}{\color{white}\large #2}\par
      \vspace{8pt}%
    }}\par
  \vspace{6pt}%
}

% \job{Role}{Company}{Location}{Dates}
\newcommand{\job}[4]{%
  {\bfseries #1}\hfill{\small\color{muted}#4}\par
  {\color{accent}#2}\enspace{\small\color{muted}#3}\par
}

% \sidelabel{Label}: a small muted label in the sidebar.
\newcommand{\sidelabel}[1]{{\small\color{muted}#1}\par}

\begin{document}

\headerband{Nadia Osei}{Product Designer \enspace\textbullet\enspace Design systems and research}

\begin{minipage}[t]{0.30\textwidth}
\raggedright

\section{Contact}
\sidelabel{Email}
\href{mailto:nadia.osei@example.com}{nadia.osei@example.com}\par
\medskip
\sidelabel{Phone}
(555) 017-4420\par
\medskip
\sidelabel{Portfolio}
\href{https://example.com/nadia}{example.com/nadia}\par
\medskip
\sidelabel{Location}
Austin, TX\par

\section{Skills}
\begin{itemize}
  \item Interaction design
  \item Design systems
  \item User research
  \item Prototyping
  \item Accessibility (WCAG)
  \item Workshop facilitation
\end{itemize}

\section{Tools}
Figma, FigJam, Framer, Maze, Dovetail, HTML and CSS, Jira

\section{Education}
{\bfseries B.F.A. Interaction Design}\par
Lakeshore Institute of Art\par
{\small\color{muted}2012 -- 2016}\par

\section{Languages}
English (native)\par
French (professional)\par

\end{minipage}%
\hfill
\begin{minipage}[t]{0.66\textwidth}

\section{Profile}
Product designer with eight years of experience shipping web and mobile products. I build design systems that let teams move quickly without losing consistency, and I ground decisions in research with real customers.

\section{Experience}

\job{Lead Product Designer}{Brightlane}{Austin, TX}{2021 -- Present}
\begin{itemize}
  \item Built the Brightlane design system (140 components) used by six product teams; design-to-build time for new screens fell by 35\%.
  \item Redesigned onboarding after 30 customer interviews, raising week-one activation from 41\% to 58\%.
  \item Run the monthly design critique and coach two designers.
\end{itemize}
\medskip

\job{Senior Product Designer}{Copperleaf Health}{Remote}{2018 -- 2021}
\begin{itemize}
  \item Led design for the patient scheduling app, rated 4.8 stars by 20,000 users.
  \item Partnered with engineering to ship an accessible colour palette and type scale across web and iOS.
  \item Set up a research panel of 300 patients for fast, repeatable usability tests.
\end{itemize}
\medskip

\job{Product Designer}{Fieldnote}{Chicago, IL}{2016 -- 2018}
\begin{itemize}
  \item Designed the first mobile version of the note-taking product, from sketches to launch.
  \item Created the illustration style used in marketing and empty states.
\end{itemize}

\section{Selected projects}

\job{Open Forms}{Side project}{}{2023}
\begin{itemize}
  \item An open-source library of accessible form patterns with usage guidance; 900 stars on its repository.
\end{itemize}

\end{minipage}

\end{document}
`

const CV_ACADEMIC = String.raw`% A multi-page academic CV. Publications come from publications.bib:
% every entry in it is listed (see \nocite{*} below). Compile with
% pdfLaTeX, then BibTeX, then pdfLaTeX twice.
\documentclass[11pt]{article}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{tabularx}
\usepackage{fancyhdr}
\usepackage[hidelinks]{hyperref}

\setlength{\parindent}{0pt}
\titleformat{\section}{\large\bfseries}{}{0pt}{}[\titlerule]
\titlespacing*{\section}{0pt}{14pt}{6pt}
\setlist{itemsep=2pt, topsep=3pt}

\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\fancyfoot[L]{\small Elena Marsh --- Curriculum Vitae}
\fancyfoot[R]{\small Page \thepage}

% A dated list: \begin{dated} When & What \\ ... \end{dated}
\newenvironment{dated}{\par\noindent\tabularx{\textwidth}{@{}p{0.18\textwidth}X@{}}}{\endtabularx\par}

% The bibliography becomes the Publications section.
\renewcommand{\refname}{Publications}

\begin{document}

\begin{center}
  {\LARGE\bfseries Elena Marsh}\\[4pt]
  Associate Professor of Environmental Engineering\\
  Department of Civil and Environmental Engineering, Ridgeview University\\
  100 University Avenue, Ridgeview, ST 01234\\[2pt]
  \href{mailto:e.marsh@example.edu}{e.marsh@example.edu} \enspace\textbar\enspace
  \href{https://example.edu/marsh}{example.edu/marsh}
\end{center}

\section{Appointments}
\begin{dated}
  2021 -- present & Associate Professor, Department of Civil and Environmental Engineering, Ridgeview University \\
  2015 -- 2021 & Assistant Professor, Department of Civil and Environmental Engineering, Ridgeview University \\
  2013 -- 2015 & Postdoctoral Researcher, Coastal Water Laboratory, Harborview Institute of Technology
\end{dated}

\section{Education}
\begin{dated}
  2013 & Ph.D. in Environmental Engineering, Northfield University\newline
  Thesis: \emph{Nutrient transport in restored urban wetlands}. Advisor: Prof.\ Samuel Achterberg \\
  2008 & M.S. in Civil Engineering, Northfield University \\
  2006 & B.S. in Chemical Engineering, Lakeside College, summa cum laude
\end{dated}

\section{Research interests}
Urban hydrology; green infrastructure for stormwater; nutrient cycling in wetlands; low-cost sensor networks for water quality.

\section{Grants}
\begin{dated}
  2022 -- 2025 & Principal Investigator. \emph{Sensor networks for real-time stormwater quality}. Regional Water Research Fund, \$480,000. \\
  2019 -- 2022 & Co-Investigator. \emph{Restoring wetlands at the urban edge}. Foundation for Environmental Science, \$310,000. \\
  2016 -- 2018 & Principal Investigator. \emph{Early Career Award: bioretention design under climate change}. Ridgeview University, \$60,000.
\end{dated}

\section{Awards}
\begin{dated}
  2023 & Excellence in Teaching Award, College of Engineering, Ridgeview University \\
  2018 & Best Paper Award, Conference on Urban Water Systems \\
  2013 & Outstanding Dissertation Award, Northfield University
\end{dated}

\nocite{*}
\bibliographystyle{plain}
\bibliography{publications}

\section{Invited talks}
\begin{itemize}
  \item \emph{What a thousand sensors taught us about urban runoff}. Water Futures Symposium, Lakeport, 2024.
  \item \emph{Designing wetlands for cities that flood}. Department seminar, Harborview Institute of Technology, 2022.
  \item \emph{Low-cost monitoring for small utilities}. Regional Utilities Forum, Ridgeview, 2020.
\end{itemize}

\section{Teaching}
\begin{dated}
  2016 -- present & CEE 341: Water Resources Engineering (undergraduate, 90 students a year) \\
  2018 -- present & CEE 642: Urban Hydrology (graduate) \\
  2021 & Designed CEE 210: Introduction to Environmental Data, a new required course
\end{dated}

\section{Students supervised}
\begin{dated}
  Current & Priya Raman (Ph.D.), Tomasz Kowal (Ph.D.), Ana Lucia Ferreira (M.S.) \\
  Graduated & Dr.\ Kwame Mensah (Ph.D. 2022, now at Coastal Water Laboratory); Jun Takahashi (M.S. 2020)
\end{dated}

\section{Service}
\begin{itemize}
  \item Associate Editor, \emph{Journal of Urban Water Research}, 2021 -- present.
  \item Reviewer for six journals and two funding agencies.
  \item Chair, Graduate Admissions Committee, Department of Civil and Environmental Engineering, 2020 -- 2023.
\end{itemize}

\end{document}
`

const CV_BIB = String.raw`@article{marsh2023sensors,
  author  = {Marsh, Elena and Raman, Priya and Kowal, Tomasz},
  title   = {Low-cost sensor networks for continuous stormwater quality monitoring},
  journal = {Journal of Urban Water Research},
  year    = {2023},
  volume  = {18},
  number  = {2},
  pages   = {112--129}
}

@article{mensah2022wetlands,
  author  = {Mensah, Kwame and Marsh, Elena},
  title   = {Nitrogen removal in constructed wetlands at the urban edge},
  journal = {Ecological Engineering Letters},
  year    = {2022},
  volume  = {41},
  pages   = {77--90}
}

@inproceedings{marsh2018bioretention,
  author    = {Marsh, Elena and Takahashi, Jun},
  title     = {Bioretention design under shifting rainfall patterns},
  booktitle = {Proceedings of the Conference on Urban Water Systems},
  year      = {2018},
  pages     = {205--214}
}

@incollection{marsh2016chapter,
  author    = {Marsh, Elena},
  title     = {Measuring nutrients in small urban streams},
  booktitle = {Methods in Urban Hydrology},
  editor    = {Achterberg, Samuel and Lindgren, Maja},
  publisher = {Ridgeview University Press},
  year      = {2016},
  pages     = {33--58}
}

@techreport{marsh2020guide,
  author      = {Marsh, Elena and Ferreira, Ana Lucia},
  title       = {A field guide to water-quality sensors for small utilities},
  institution = {Ridgeview University},
  type        = {Technical Report},
  number      = {CEE-2020-04},
  year        = {2020}
}
`

const COVER_LETTER = String.raw`% A cover letter matching the classic resume: same header, same font.
\documentclass[letterpaper,11pt]{article}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage[hidelinks]{hyperref}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{8pt}

% Separator for the contact line.
\newcommand{\sep}{\enspace\textbar\enspace}

% \letterheader{Name}{contact line}
\newcommand{\letterheader}[2]{%
  \begin{center}
    {\Huge\scshape #1}\\[4pt]
    \small #2
  \end{center}
  \vspace{-6pt}
  \rule{\textwidth}{0.4pt}
}

\begin{document}

\letterheader{Maya Lindqvist}{%
  Portland, OR \sep (555) 014-2386 \sep
  \href{mailto:maya.lindqvist@example.com}{maya.lindqvist@example.com} \sep
  \href{https://example.com/maya}{example.com/maya}}

\today

Hiring Team\\
Riverstone Software\\
220 Harbor Street\\
Portland, OR 97204

Dear Hiring Team,

I am writing to apply for the Staff Software Engineer role on Riverstone's data platform team. For the past seven years I have built and run data systems that people depend on every day, and I would like to bring that experience to a team whose product I already use.

At Northwind Analytics I led the rebuild of our reporting pipeline, cutting the nightly run from six hours to forty minutes and giving analysts results before their working day starts. I also designed the caching layer behind our customer dashboard, which lowered latency by 38\% while reducing our compute bill. Both projects depended as much on careful planning with other teams as on the code itself.

What draws me to Riverstone is your focus on reliability for small businesses. Your recent write-up on moving to event-driven billing matched problems I have solved before, and I would enjoy working on the next stage of that system with your team.

Thank you for considering my application. I would welcome the chance to talk about how I could help.

Sincerely,

\vspace{24pt}
Maya Lindqvist

\end{document}
`

const LETTER = String.raw`% A formal letter with the standard letter class. The sender's address
% and signature are set once, before \begin{document}.
\documentclass[11pt]{letter}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}

\signature{Daniel Okoro}
\address{14 Alder Lane\\Springfield, ST 01234\\(555) 016-7731}
\date{\today}

\begin{document}

\begin{letter}{Ms Priya Raman\\Office of Admissions\\Northfield College\\200 College Road\\Northfield, ST 05678}

\opening{Dear Ms Raman,}

I am writing to confirm that I accept the offer of a place on the M.Sc. in Applied Statistics beginning this September, as set out in your letter of 2 May.

As requested, I enclose the signed acceptance form and copies of my degree certificate and transcript. I understand that the tuition deposit is due by 30 June, and I will pay it through the student portal before then.

Please let me know if you need anything further from me. I look forward to joining the programme.

\closing{Yours sincerely,}

\encl{Signed acceptance form; degree certificate; transcript}

\cc{Dr Helen Fairweather, Programme Director}

\end{letter}

\end{document}
`

const ARTICLE = String.raw`\documentclass[11pt]{article}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage[hidelinks]{hyperref}

\title{Predicting Bicycle Demand from Weather and Calendar Data}
\author{Clara Brandt\thanks{Department of Statistics, Northfield University. \texttt{c.brandt@example.edu}}
  \and Tomas Ferreira}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
Bike-sharing schemes need to know how many bicycles riders will want each hour, so that stations are neither empty nor full. We compare three models that predict hourly demand from weather and calendar data on two years of trips from a mid-sized city. A regularised linear model with a few interaction terms comes within 4\% of a gradient-boosted model while remaining easy to explain to operators.
\end{abstract}

\section{Introduction}
\label{sec:introduction}

Demand for shared bicycles rises and falls with the hour, the day of the week and the weather \cite{fanaee2014event}. Operators use forecasts to plan when vans move bicycles between stations \cite{raviv2013static}. Section~\ref{sec:method} describes our models, and Section~\ref{sec:results} compares them.

\section{Method}
\label{sec:method}

For each hour $t$ we observe the number of trips $y_t$ and a vector of features $x_t$: temperature, humidity, wind speed, rain, hour of day, day of week and public holidays. We fit a linear model with an $\ell_2$ penalty,
\begin{equation}
  \hat{\beta} = \operatorname*{arg\,min}_{\beta} \sum_{t=1}^{n} \left( y_t - x_t^{\top} \beta \right)^2 + \lambda \lVert \beta \rVert_2^2,
  \label{eq:ridge}
\end{equation}
choosing $\lambda$ by five-fold cross-validation. Equation~\eqref{eq:ridge} has a closed-form solution, so the model refits in under a second. We compare it with a random forest and a gradient-boosted model \cite{friedman2001greedy}. Figure~\ref{fig:pipeline} shows the steps.

\begin{figure}[htbp]
  \centering
  \fbox{\parbox[c][4cm][c]{0.7\linewidth}{\centering
    Placeholder figure\\[2pt]
    \small Replace this box with \texttt{\textbackslash includegraphics}.}}
  \caption{From raw trip records to hourly forecasts.}
  \label{fig:pipeline}
\end{figure}

\section{Results}
\label{sec:results}

Table~\ref{tab:results} reports the error on the last six months, which no model saw during fitting.

\begin{table}[htbp]
  \centering
  \caption{Forecast error on the held-out months (lower is better).}
  \label{tab:results}
  \begin{tabular}{lrrr}
    \toprule
    Model & MAE (trips) & RMSE (trips) & Fit time (s) \\
    \midrule
    Ridge regression & 41.2 & 58.9 & 0.4 \\
    Random forest & 39.8 & 56.1 & 31.0 \\
    Gradient boosting & 39.5 & 55.3 & 48.7 \\
    \bottomrule
  \end{tabular}
\end{table}

\section{Conclusion}

A simple model explains most of the variation in demand. Because operators can see why it predicts what it does, it is easier to trust when planning the day.

\bibliographystyle{plain}
\bibliography{references}

\end{document}
`

const ARTICLE_BIB = String.raw`@article{fanaee2014event,
  author  = {Fanaee-T, Hadi and Gama, Joao},
  title   = {Event labeling combining ensemble detectors and background knowledge},
  journal = {Progress in Artificial Intelligence},
  year    = {2014},
  volume  = {2},
  number  = {2},
  pages   = {113--127}
}

@article{raviv2013static,
  author  = {Raviv, Tal and Tzur, Michal and Forma, Iris A.},
  title   = {Static repositioning in a bike-sharing system: models and solution approaches},
  journal = {EURO Journal on Transportation and Logistics},
  year    = {2013},
  volume  = {2},
  number  = {3},
  pages   = {187--229}
}

@article{friedman2001greedy,
  author  = {Friedman, Jerome H.},
  title   = {Greedy function approximation: a gradient boosting machine},
  journal = {The Annals of Statistics},
  year    = {2001},
  volume  = {29},
  number  = {5},
  pages   = {1189--1232}
}
`

const REPORT = String.raw`% A report split into chapter files. Each \include starts a new page;
% \includeonly{chapters/results} in the preamble compiles one chapter alone.
\documentclass[11pt]{report}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath}
\usepackage{booktabs}
\usepackage[hidelinks]{hyperref}

\title{Community Garden Water Use\\[6pt]\large Findings from the 2025 Growing Season}
\author{Harbor District Garden Network}
\date{November 2025}

\begin{document}

\maketitle

\begin{abstract}
Over one growing season we measured the water used by twelve community gardens. Gardens with drip irrigation used 31\% less water per square metre than those watered by hand, without lower harvests. This report describes how we measured, what we found, and what we recommend for next season.
\end{abstract}

\tableofcontents

\include{chapters/introduction}
\include{chapters/methods}
\include{chapters/results}

\appendix
\include{chapters/appendix}

\end{document}
`

const REPORT_INTRO = String.raw`\chapter{Introduction}
\label{chap:introduction}

The Harbor District Garden Network looks after twelve community gardens on city land. Water is the largest running cost after rent, and the city has asked every network to report its use before the next lease.

This report answers three questions:
\begin{enumerate}
  \item How much water does each garden use per square metre?
  \item Does the watering method make a difference?
  \item What could we change next season?
\end{enumerate}

Chapter~\ref{chap:methods} explains how we measured, Chapter~\ref{chap:results} gives the findings, and Appendix~\ref{app:form} reproduces the form volunteers filled in.
`

const REPORT_METHODS = String.raw`\chapter{Methods}
\label{chap:methods}

\section{Meters}

Each garden had a meter fitted to its main tap in April. Volunteers read the meters every Sunday from May to September and recorded the readings on the form in Appendix~\ref{app:form}.

\section{Normalising by area}

Gardens differ in size, so we report use per square metre of planted beds. For garden $g$ with weekly readings $r_{g,1}, \dots, r_{g,n}$ and planted area $A_g$, the season's use per square metre is
\begin{equation}
  u_g = \frac{r_{g,n} - r_{g,1}}{A_g}.
  \label{eq:use}
\end{equation}

\section{Watering methods}

Five gardens use drip irrigation on timers; the other seven water by hand with hoses and cans.
`

const REPORT_RESULTS = String.raw`\chapter{Results}
\label{chap:results}

\section{Use per square metre}

Table~\ref{tab:use} gives the use from Equation~\eqref{eq:use} for each watering method.

\begin{table}[htbp]
  \centering
  \caption{Water used per square metre of beds, May to September.}
  \label{tab:use}
  \begin{tabular}{lrrr}
    \toprule
    Method & Gardens & Mean (litres) & Range (litres) \\
    \midrule
    Drip irrigation & 5 & 412 & 365--470 \\
    Hand watering & 7 & 597 & 488--731 \\
    \bottomrule
  \end{tabular}
\end{table}

\section{Recommendations}

\begin{itemize}
  \item Fit drip lines to the three largest hand-watered gardens first; they account for most of the difference.
  \item Keep the weekly readings: they cost little and caught two leaks this season.
\end{itemize}
`

const REPORT_APPENDIX = String.raw`\chapter{Reading form}
\label{app:form}

Volunteers recorded the following each Sunday:

\begin{description}
  \item[Garden] The garden's name.
  \item[Date] The date of the reading.
  \item[Reading] The meter reading in litres.
  \item[Notes] Anything unusual: leaks, events, rain.
\end{description}
`

const SLIDES = String.raw`\documentclass{beamer}

\usetheme{Madrid}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{booktabs}

\title[Faster Builds]{Faster Builds with Remote Caching}
\subtitle{What we learned moving 40 services}
\author{Jonas Weber}
\institute{Platform Team, Lumen Freight}
\date{\today}

% An outline slide at the start of each section.
\AtBeginSection[]{%
  \begin{frame}{Outline}
    \tableofcontents[currentsection]
  \end{frame}
}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

\section{The problem}

\begin{frame}{Why builds were slow}
  \begin{itemize}
    \item<1-> Every pull request rebuilt every service from scratch
    \item<2-> Median CI time grew from 9 to 27 minutes in a year
    \item<3-> Engineers batched changes to avoid waiting, so reviews got larger
  \end{itemize}
\end{frame}

\section{What we did}

\begin{frame}{Two changes}
  \begin{columns}[T]
    \begin{column}{0.48\textwidth}
      \textbf{Before}
      \begin{itemize}
        \item Local caches only
        \item Each runner starts cold
        \item Tests rerun for unchanged code
      \end{itemize}
    \end{column}
    \begin{column}{0.48\textwidth}
      \begin{block}{After}
        A shared remote cache keyed on inputs, so a result built once is reused by every runner and laptop.
      \end{block}
      \begin{alertblock}{Watch out}
        Builds must be reproducible, or the cache serves wrong results.
      \end{alertblock}
    \end{column}
  \end{columns}
\end{frame}

\begin{frame}{How much time we save}
  If a fraction $h$ of build steps hit the cache and a hit costs a fraction $c$ of a full build step, the expected build time is
  \begin{equation}
    T = T_0 \left( (1 - h) + h c \right).
  \end{equation}
  \pause
  With $h = 0.8$ and $c = 0.05$, builds take $24\%$ of the time they used to.
\end{frame}

\section{Results}

\begin{frame}{Results after three months}
  \begin{table}
    \centering
    \begin{tabular}{lrr}
      \toprule
      Measure & Before & After \\
      \midrule
      Median CI time (min) & 27 & 8 \\
      Cache hit rate & --- & 81\% \\
      Pull requests per engineer per week & 3.1 & 4.6 \\
      \bottomrule
    \end{tabular}
  \end{table}
  \begin{exampleblock}{Takeaway}
    Make builds reproducible first; the cache is the easy part.
  \end{exampleblock}
\end{frame}

\begin{frame}
  \centering
  \Large Questions?\par
  \bigskip
  \normalsize jonas.weber@example.com
\end{frame}

\end{document}
`

const NOTES = String.raw`% Maths notes and homework: theorem environments, numbered exercises,
% and problems with solutions.
\documentclass[11pt]{article}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}

\theoremstyle{plain}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{corollary}[theorem]{Corollary}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newtheorem{example}[theorem]{Example}
\newtheorem{exercise}{Exercise}[section]
\newtheorem{problem}{Problem}
\theoremstyle{remark}
\newtheorem*{remark}{Remark}

% A solution is set like a proof, headed "Solution".
\newenvironment{solution}{\begin{proof}[Solution]}{\end{proof}}

\newcommand{\R}{\mathbb{R}}
\newcommand{\N}{\mathbb{N}}
\newcommand{\abs}[1]{\left\lvert #1 \right\rvert}

\title{MATH 221: Real Analysis\\[4pt]\large Notes and Problem Set 3}
\author{Sam Ortega}
\date{\today}

\begin{document}

\maketitle

\section{Convergent sequences}

\begin{definition}
A sequence $(a_n)$ of real numbers \emph{converges} to $L \in \R$ if for every $\varepsilon > 0$ there is an $N \in \N$ such that $\abs{a_n - L} < \varepsilon$ for all $n \geq N$.
\end{definition}

\begin{theorem}[Uniqueness of limits]
\label{thm:unique}
A sequence has at most one limit.
\end{theorem}

\begin{proof}
Suppose $(a_n)$ converges to both $L$ and $M$. Given $\varepsilon > 0$, choose $N$ so that $\abs{a_n - L} < \varepsilon/2$ and $\abs{a_n - M} < \varepsilon/2$ for $n \geq N$. Then
\[
  \abs{L - M} \leq \abs{L - a_N} + \abs{a_N - M} < \varepsilon.
\]
Since $\varepsilon$ was arbitrary, $L = M$.
\end{proof}

\begin{example}
The sequence $a_n = 1/n$ converges to $0$: given $\varepsilon > 0$, take $N > 1/\varepsilon$.
\end{example}

\begin{remark}
Theorem~\ref{thm:unique} lets us write $\lim_{n \to \infty} a_n$ without ambiguity.
\end{remark}

\begin{exercise}
Show that every convergent sequence is bounded.
\end{exercise}

\begin{exercise}
Show that $a_n = (-1)^n$ does not converge.
\end{exercise}

\section{Problem set 3}

\begin{problem}
Let $a_n = \dfrac{2n + 1}{n + 3}$.
\begin{enumerate}[label=(\alph*)]
  \item Find $L = \lim_{n \to \infty} a_n$.
  \item Find an $N$ such that $\abs{a_n - L} < 10^{-3}$ for all $n \geq N$.
\end{enumerate}
\end{problem}

\begin{solution}
\begin{enumerate}[label=(\alph*)]
  \item Dividing through by $n$, $a_n = \dfrac{2 + 1/n}{1 + 3/n} \to 2$, so $L = 2$.
  \item We have
  \begin{align*}
    \abs{a_n - 2} &= \abs{\frac{2n + 1 - 2n - 6}{n + 3}} \\
                  &= \frac{5}{n + 3},
  \end{align*}
  which is less than $10^{-3}$ when $n + 3 > 5000$, so $N = 4998$ works.
\end{enumerate}
\end{solution}

\begin{problem}
Prove that if $a_n \to L$ and $b_n \to M$, then $a_n + b_n \to L + M$.
\end{problem}

\begin{solution}
Given $\varepsilon > 0$, choose $N_1$ and $N_2$ with $\abs{a_n - L} < \varepsilon/2$ for $n \geq N_1$ and $\abs{b_n - M} < \varepsilon/2$ for $n \geq N_2$. For $n \geq \max(N_1, N_2)$ the triangle inequality gives $\abs{(a_n + b_n) - (L + M)} < \varepsilon$.
\end{solution}

\end{document}
`

const BLANK = String.raw`\documentclass[11pt]{article}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}

\title{Untitled}
\author{}
\date{\today}

\begin{document}

\maketitle

Start writing here.

\end{document}
`

const main = (text: string) => [{ name: "main.tex", text }]

/** Starting points for a new project. */
export const TEMPLATES: Template[] = [
  {
    id: "resume-classic",
    name: "Classic resume",
    description:
      "One page, one column, dense and ATS-friendly: contact line, ruled sections, role and date rows, tight bullets.",
    category: "resume",
    engine: "pdflatex",
    main: "main.tex",
    files: main(RESUME_CLASSIC),
  },
  {
    id: "resume-modern",
    name: "Modern resume",
    description:
      "A coloured header band, a sidebar for contact details and skills, and a main column for experience.",
    category: "resume",
    engine: "pdflatex",
    main: "main.tex",
    files: main(RESUME_MODERN),
  },
  {
    id: "cv-academic",
    name: "Academic CV",
    description:
      "A multi-page CV with appointments, grants, teaching and publications from a .bib file.",
    category: "resume",
    engine: "pdflatex",
    main: "main.tex",
    files: [
      { name: "main.tex", text: CV_ACADEMIC },
      { name: "publications.bib", text: CV_BIB },
    ],
  },
  {
    id: "cover-letter",
    name: "Cover letter",
    description:
      "A one-page cover letter with the same header and font as the classic resume.",
    category: "letter",
    engine: "pdflatex",
    main: "main.tex",
    files: main(COVER_LETTER),
  },
  {
    id: "letter",
    name: "Formal letter",
    description:
      "A formal letter with the standard letter class: addresses, opening, closing, enclosures.",
    category: "letter",
    engine: "pdflatex",
    main: "main.tex",
    files: main(LETTER),
  },
  {
    id: "article",
    name: "Article",
    description:
      "A paper with a title, abstract, sections, a figure, a table, an equation and a bibliography.",
    category: "article",
    engine: "pdflatex",
    main: "main.tex",
    files: [
      { name: "main.tex", text: ARTICLE },
      { name: "references.bib", text: ARTICLE_BIB },
    ],
  },
  {
    id: "report",
    name: "Report with chapters",
    description:
      "A report whose chapters live in their own files, with a table of contents and an appendix.",
    category: "report",
    engine: "pdflatex",
    main: "main.tex",
    files: [
      { name: "main.tex", text: REPORT },
      { name: "chapters/introduction.tex", text: REPORT_INTRO },
      { name: "chapters/methods.tex", text: REPORT_METHODS },
      { name: "chapters/results.tex", text: REPORT_RESULTS },
      { name: "chapters/appendix.tex", text: REPORT_APPENDIX },
    ],
  },
  {
    id: "slides",
    name: "Slides",
    description:
      "A beamer deck: title, outline, two columns, blocks, an equation and step-by-step lists.",
    category: "slides",
    engine: "pdflatex",
    main: "main.tex",
    files: main(SLIDES),
  },
  {
    id: "notes",
    name: "Maths notes and homework",
    description:
      "Theorems, definitions and proofs, numbered exercises, and problems with solutions.",
    category: "notes",
    engine: "pdflatex",
    main: "main.tex",
    files: main(NOTES),
  },
  {
    id: "blank",
    name: "Blank document",
    description: "The smallest sensible starting point.",
    category: "other",
    engine: "pdflatex",
    main: "main.tex",
    files: main(BLANK),
  },
]
