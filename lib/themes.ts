// Site themes: the color schemes a terminal ships with, applied to the whole
// website. "default" is the site's own black-and-white look and sets nothing.
// The scheme values are the ones Windows Terminal ships in its defaults.json
// (which is what PowerShell runs in), plus the Ubuntu terminal's. Pure, so it
// runs under `node --test`; lib/theme-client.ts applies it to the page.

export type Scheme = {
  id: string
  name: string
  background: string
  foreground: string
  selection?: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  purple: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightPurple: string
  brightCyan: string
  brightWhite: string
  /** The scheme color used for buttons, focus rings and highlights. */
  accent: string
}

const scheme = (
  id: string,
  name: string,
  background: string,
  foreground: string,
  accent: string,
  colors: string,
  selection?: string
): Scheme => {
  const c = colors.split(" ").map((hex) => `#${hex}`)
  return {
    id,
    name,
    background,
    foreground,
    selection,
    accent,
    black: c[0],
    red: c[1],
    green: c[2],
    yellow: c[3],
    blue: c[4],
    purple: c[5],
    cyan: c[6],
    white: c[7],
    brightBlack: c[8],
    brightRed: c[9],
    brightGreen: c[10],
    brightYellow: c[11],
    brightBlue: c[12],
    brightPurple: c[13],
    brightCyan: c[14],
    brightWhite: c[15],
  }
}

const CAMPBELL =
  "0c0c0c c50f1f 13a10e c19c00 0037da 881798 3a96dd cccccc 767676 e74856 16c60c f9f1a5 3b78ff b4009e 61d6d6 f2f2f2"
const TANGO =
  "000000 cc0000 4e9a06 c4a000 3465a4 75507b 06989a d3d7cf 555753 ef2929 8ae234 fce94f 729fcf ad7fa8 34e2e2 eeeeec"
const SOLARIZED =
  "002b36 dc322f 859900 b58900 268bd2 d33682 2aa198 eee8d5 073642 cb4b16 586e75 657b83 839496 6c71c4 93a1a1 fdf6e3"
const VSCODE =
  "000000 cd3131 0dbc79 e5e510 2472c8 bc3fbc 11a8cd e5e5e5 666666 f14c4c 23d18b f5f543 3b8eea d670d6 29b8db e5e5e5"
const CGA =
  "000000 aa0000 00aa00 aa5500 0000aa aa00aa 00aaaa aaaaaa 555555 ff5555 55ff55 ffff55 5555ff ff55ff 55ffff ffffff"

/** Every scheme, in the order they are listed. */
export const SCHEMES: Scheme[] = [
  scheme("campbell", "Campbell", "#0c0c0c", "#cccccc", "#f9f1a5", CAMPBELL),
  scheme(
    "campbell-powershell",
    "Campbell Powershell",
    "#012456",
    "#cccccc",
    "#f9f1a5",
    CAMPBELL
  ),
  scheme(
    "vintage",
    "Vintage",
    "#000000",
    "#c0c0c0",
    "#00ff00",
    "000000 800000 008000 808000 000080 800080 008080 c0c0c0 808080 ff0000 00ff00 ffff00 0000ff ff00ff 00ffff ffffff"
  ),
  scheme(
    "one-half-dark",
    "One Half Dark",
    "#282c34",
    "#dcdfe4",
    "#61afef",
    "282c34 e06c75 98c379 e5c07b 61afef c678dd 56b6c2 dcdfe4 5a6374 e06c75 98c379 e5c07b 61afef c678dd 56b6c2 dcdfe4"
  ),
  scheme(
    "one-half-light",
    "One Half Light",
    "#fafafa",
    "#383a42",
    "#0184bc",
    "383a42 e45649 50a14f c18301 0184bc a626a4 0997b3 fafafa 4f525d df6c75 98c379 e4c07a 61afef c577dd 56b5c1 ffffff"
  ),
  scheme(
    "solarized-dark",
    "Solarized Dark",
    "#002b36",
    "#839496",
    "#268bd2",
    SOLARIZED
  ),
  scheme(
    "solarized-light",
    "Solarized Light",
    "#fdf6e3",
    "#657b83",
    "#268bd2",
    SOLARIZED
  ),
  scheme("tango-dark", "Tango Dark", "#000000", "#d3d7cf", "#8ae234", TANGO),
  scheme("tango-light", "Tango Light", "#ffffff", "#555753", "#3465a4", TANGO),
  scheme("dark-plus", "Dark+", "#1e1e1e", "#cccccc", "#3b8eea", VSCODE),
  scheme(
    "vscode-dark-modern",
    "VSCode Dark Modern",
    "#1f1f1f",
    "#cccccc",
    "#3b8eea",
    VSCODE,
    "#264f78"
  ),
  scheme(
    "vscode-light-modern",
    "VSCode Light Modern",
    "#ffffff",
    "#3b3b3b",
    "#0451a5",
    "000000 cd3131 00bc00 949800 0451a5 bc05bc 0598bc 555555 666666 cd3131 14ce14 b5ba00 0451a5 bc05bc 0598bc a5a5a5",
    "#add6ff"
  ),
  scheme(
    "dimidium",
    "Dimidium",
    "#141414",
    "#bab7b6",
    "#37e57b",
    "000000 cf494c 60b442 db9c11 0575d8 af5ed2 1db6bb bab7b6 817e7e ff643b 37e57b fccd1a 688dfd ed6fe9 32e0fb dee3e4",
    "#8db8e5"
  ),
  scheme(
    "ottosson",
    "Ottosson",
    "#000000",
    "#bebebe",
    "#92a4fd",
    "000000 be2c21 3fae3a be9a4a 204dbe bb54be 00a7b2 bebebe 808080 ff3e30 58ea51 ffc944 2f6aff fc74ff 00e1f0 ffffff",
    "#92a4fd"
  ),
  scheme("cga", "CGA", "#000000", "#aaaaaa", "#55ffff", CGA),
  scheme(
    "ibm-5153",
    "IBM 5153",
    "#000000",
    "#aaaaaa",
    "#55ff55",
    CGA.replace("aa5500", "c47e00")
  ),
  // The GNOME terminal as Ubuntu ships it: the Tango palette on aubergine.
  scheme("ubuntu", "Ubuntu", "#300a24", "#ffffff", "#8ae234", TANGO),
]

export const DEFAULT_SCHEME = "default"

const key = (name: string) =>
  name
    .toLowerCase()
    .replace(/\+/g, " plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

/** The scheme a word names ("Campbell Powershell", "one-half-dark"), or undefined. */
export function findScheme(name: string | undefined): Scheme | undefined {
  const wanted = key(name ?? "")
  return SCHEMES.find((s) => s.id === wanted || key(s.name) === wanted)
}

/** True for "default" and the names that used to mean it. */
export const isDefaultScheme = (name: string | undefined) =>
  ["default", "original", "none", "off", "reset"].includes(
    (name ?? "").toLowerCase()
  )

// ---- Color arithmetic ------------------------------------------------------

type Rgb = [number, number, number]
const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]
const hex = (c: Rgb) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`
/** `amount` of `a` over `b`, in sRGB like CSS color-mix. */
export const mix = (a: string, b: string, amount: number) => {
  const x = rgb(a),
    y = rgb(b)
  return hex([0, 1, 2].map((i) => x[i] * amount + y[i] * (1 - amount)) as Rgb)
}
const luminance = (color: string) => {
  const [r, g, b] = rgb(color).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast ratio between two colors, 1–21. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
export const isDark = (s: Pick<Scheme, "background">) =>
  luminance(s.background) < 0.3
/** Black or white, whichever reads better on `color`. */
const on = (color: string) =>
  contrast(color, "#000000") >= contrast(color, "#ffffff")
    ? "#000000"
    : "#ffffff"
/**
 * `color` nudged toward `toward` until it stands out from `background` by at
 * least `ratio`. Used so a scheme's own dim colors stay legible.
 */
function readable(
  color: string,
  background: string,
  toward: string,
  ratio: number
) {
  let result = color
  for (let i = 0; i < 12 && contrast(result, background) < ratio; i++)
    result = mix(result, toward, 0.8)
  return result
}

/**
 * The CSS custom properties a scheme sets on the page: the site's design
 * tokens (app/globals.css) and the terminal's own (`--scheme-*`, picked up by
 * components/alpha/shell-terminal.module.css).
 */
export function schemeTokens(s: Scheme): Record<string, string> {
  const dark = isDark(s)
  const { background: bg, foreground: fg } = s
  // A scheme's own text sets the ceiling: nothing derived from it is pushed
  // to stand out more than the text itself (Solarized is soft on purpose).
  const most = contrast(fg, bg)
  const tone = (color: string) => readable(color, bg, fg, Math.min(3, most))
  const accent = tone(s.accent)
  const raised = mix(fg, bg, dark ? 0.06 : 0.035)
  const quiet = mix(fg, bg, dark ? 0.13 : 0.08)
  const dim = readable(mix(fg, bg, 0.62), bg, fg, Math.min(4.5, most * 0.8))
  const danger = tone(dark ? s.brightRed : s.red)
  return {
    "--background": bg,
    "--foreground": fg,
    "--card": raised,
    "--card-foreground": fg,
    "--popover": raised,
    "--popover-foreground": fg,
    "--primary": accent,
    "--primary-foreground": on(accent),
    "--secondary": quiet,
    "--secondary-foreground": fg,
    "--muted": quiet,
    "--muted-foreground": dim,
    "--accent": mix(fg, bg, dark ? 0.2 : 0.13),
    "--accent-foreground": fg,
    "--destructive": danger,
    "--border": mix(fg, bg, dark ? 0.2 : 0.18),
    "--input": mix(fg, bg, dark ? 0.26 : 0.24),
    "--ring": mix(fg, bg, 0.5),
    "--chart-1": tone(s.green),
    "--chart-2": tone(s.cyan),
    "--chart-3": tone(s.blue),
    "--chart-4": tone(s.purple),
    "--chart-5": tone(s.yellow),
    "--sidebar": raised,
    "--sidebar-foreground": fg,
    "--sidebar-primary": accent,
    "--sidebar-primary-foreground": on(accent),
    "--sidebar-accent": quiet,
    "--sidebar-accent-foreground": fg,
    "--sidebar-border": mix(fg, bg, dark ? 0.2 : 0.18),
    "--sidebar-ring": mix(fg, bg, 0.5),
    // The landing page's picture stays dark with light detail in every
    // scheme, so the text over it keeps reading.
    "--scheme-hero-low": dark ? bg : luminance(s.black) < luminance(fg) ? s.black : fg,
    "--scheme-hero-high": dark ? fg : bg,
    "--scheme-bg": bg,
    "--scheme-fg": fg,
    "--scheme-dim": dim,
    "--scheme-bar": mix(fg, bg, dark ? 0.1 : 0.08),
    "--scheme-bar-fg": fg,
    "--scheme-select": s.selection ?? mix(accent, bg, 0.4),
    "--scheme-error": danger,
    "--scheme-user": tone(dark ? s.brightGreen : s.green),
    "--scheme-path": tone(dark ? s.brightBlue : s.blue),
    "--scheme-command": tone(dark ? s.brightYellow : s.yellow),
    "--scheme-string": tone(dark ? s.brightCyan : s.cyan),
  }
}

/** Storage keys shared by lib/theme-client.ts and the script in app/layout.tsx. */
export const SCHEME_STORAGE = "iterations:scheme"

/**
 * Runs before the page paints so a saved scheme never flashes the default
 * colors first. Kept as source text because it is inlined into the document.
 */
export const SCHEME_SCRIPT = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SCHEME_STORAGE)})||"null");if(s&&s.id&&s.tokens){var r=document.documentElement;r.dataset.scheme=s.id;for(var k in s.tokens)r.style.setProperty(k,s.tokens[k])}}catch(e){}`

/** The lines `theme list` prints. */
export function schemeList(current: string) {
  const mark = (id: string) => (id === current ? "*" : " ")
  return [
    `${mark(DEFAULT_SCHEME)} default${" ".repeat(16)}the site's own look`,
    ...SCHEMES.map(
      (s) =>
        `${mark(s.id)} ${s.id.padEnd(22)} ${isDark(s) ? "dark " : "light"}  ${s.name}`
    ),
  ].join("\n")
}
