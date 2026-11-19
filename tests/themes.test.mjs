import test from "node:test"
import assert from "node:assert/strict"
import { execute, initialWorkspace } from "../lib/alpha.ts"
import {
  contrast,
  DEFAULT_SCHEME,
  findScheme,
  isDark,
  isDefaultScheme,
  mix,
  SCHEME_SCRIPT,
  SCHEME_STORAGE,
  schemeList,
  SCHEMES,
  schemeTokens,
} from "../lib/themes.ts"

test("the schemes are the ones a terminal ships with, each complete", () => {
  const names = SCHEMES.map((s) => s.name)
  for (const expected of [
    "Campbell",
    "Campbell Powershell",
    "Vintage",
    "One Half Dark",
    "One Half Light",
    "Solarized Dark",
    "Solarized Light",
    "Tango Dark",
    "Tango Light",
    "Dark+",
    "CGA",
    "IBM 5153",
    "Ubuntu",
  ])
    assert.ok(names.includes(expected), expected)
  assert.equal(new Set(SCHEMES.map((s) => s.id)).size, SCHEMES.length)
  for (const s of SCHEMES)
    for (const [key, value] of Object.entries(s))
      if (!["id", "name", "selection"].includes(key))
        assert.match(value, /^#[\da-f]{6}$/, `${s.id}.${key}`)
  const powershell = findScheme("campbell-powershell")
  assert.equal(powershell.background, "#012456")
  assert.equal(powershell.brightYellow, "#f9f1a5")
  assert.equal(findScheme("ibm-5153").yellow, "#c47e00")
})

test("schemes are found by id or by name, however it is typed", () => {
  assert.equal(findScheme("Campbell Powershell").id, "campbell-powershell")
  assert.equal(findScheme("ONE HALF DARK").id, "one-half-dark")
  assert.equal(findScheme("Dark+").id, "dark-plus")
  assert.equal(findScheme("solarized_light").id, "solarized-light")
  assert.equal(findScheme("nope"), undefined)
  assert.equal(findScheme(undefined), undefined)
  assert.ok(isDefaultScheme("Default"))
  assert.ok(isDefaultScheme("original"))
  assert.ok(!isDefaultScheme("campbell"))
})

test("every scheme gives the whole site legible colors", () => {
  for (const s of SCHEMES) {
    const t = schemeTokens(s)
    assert.equal(t["--background"], s.background)
    assert.equal(t["--foreground"], s.foreground)
    assert.equal(t["--scheme-bg"], s.background)
    const readable = (name, ratio) =>
      assert.ok(
        contrast(t[name], s.background) >= ratio,
        `${s.id} ${name} ${t[name]} on ${s.background}: ${contrast(t[name], s.background).toFixed(2)}`
      )
    // The scheme's own text is kept as it is; Solarized Light's is the softest.
    readable("--foreground", 4)
    readable("--muted-foreground", 3.3)
    assert.ok(
      contrast(t["--muted-foreground"], s.background) <=
        contrast(s.foreground, s.background),
      `${s.id}: secondary text is quieter than the text`
    )
    readable("--primary", 3)
    readable("--destructive", 3)
    readable("--scheme-command", 3)
    readable("--scheme-path", 3)
    assert.ok(
      contrast(t["--primary-foreground"], t["--primary"]) >= 4.5,
      `${s.id} button text`
    )
    assert.ok(Object.values(t).every((value) => /^#[\da-f]{6}$/.test(value)), s.id)
  }
  assert.ok(isDark(findScheme("campbell")))
  assert.ok(!isDark(findScheme("solarized-light")))
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080")
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21)
})

test("the theme command switches the site theme and leaves accents to themselves", () => {
  const w = initialWorkspace()
  const campbell = execute(w, "theme campbell-powershell")
  assert.equal(campbell.scheme, "campbell-powershell")
  assert.equal(campbell.workspace, w)
  assert.equal(execute(w, 'theme "One Half Dark"').scheme, "one-half-dark")
  assert.equal(execute(w, "theme one half dark").scheme, "one-half-dark")
  const accent = execute(w, "theme amber")
  assert.equal(accent.scheme, undefined)
  assert.equal(accent.workspace.accent, "#ffbf69")
  const back = execute(accent.workspace, "theme default")
  assert.equal(back.scheme, DEFAULT_SCHEME)
  assert.equal(back.workspace.theme, "original")
  assert.equal(execute(w, "theme original").scheme, DEFAULT_SCHEME)
  assert.throws(() => execute(w, "theme missing"), /Unknown theme/)
})

test("theme list marks the theme in use on this device", () => {
  const listed = execute(initialWorkspace(), "theme list", undefined, {
    scheme: "ubuntu",
  }).output
  assert.match(listed, /^\* ubuntu\s+dark {3}Ubuntu$/m)
  assert.match(listed, /^ {2}default/m)
  assert.match(schemeList(DEFAULT_SCHEME), /^\* default/m)
  assert.match(schemeList("x"), /solarized-light\s+light {2}Solarized Light/)
})

test("the script that applies a saved theme before paint is self-contained", () => {
  assert.ok(SCHEME_SCRIPT.includes(JSON.stringify(SCHEME_STORAGE)))
  const set = {}
  const dataset = {}
  const saved = { id: "campbell", tokens: { "--background": "#0c0c0c" } }
  new Function("localStorage", "document", SCHEME_SCRIPT)(
    { getItem: () => JSON.stringify(saved) },
    {
      documentElement: {
        dataset,
        style: { setProperty: (name, value) => (set[name] = value) },
      },
    }
  )
  assert.deepEqual(set, { "--background": "#0c0c0c" })
  assert.equal(dataset.scheme, "campbell")
  // Nothing saved, or junk saved: it does nothing and never throws.
  new Function("localStorage", "document", SCHEME_SCRIPT)(
    { getItem: () => "{not json" },
    {}
  )
})
