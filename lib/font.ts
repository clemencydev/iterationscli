// Site font preference: a Google Fonts family or an uploaded font file,
// remembered in this browser and applied to the whole site.

export const FONT_STORAGE = "iterationscli.font.v1"
export const MAX_FONT_BYTES = 1_500_000
export type SavedFont = {
  family: string
  source: "google" | "file"
  /** Google Fonts stylesheet. */
  href?: string
  /** Uploaded font as a data: URL. */
  data?: string
}

const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/

/** Accepts a family name ("Fira Code") or a fonts.google.com / fonts.googleapis.com URL. */
export function parseGoogleFont(input: string): { family: string; href: string } {
  let family = input.trim()
  if (/^https?:\/\//i.test(family)) {
    let url: URL
    try {
      url = new URL(family)
    } catch {
      throw new Error("That link is not a valid URL.")
    }
    if (url.hostname === "fonts.googleapis.com")
      family = (url.searchParams.get("family") ?? "").split(/[:|]/)[0]
    else if (url.hostname === "fonts.google.com")
      family = decodeURIComponent(
        url.pathname.match(/^\/(?:specimen|noto\/specimen)\/([^/]+)/)?.[1] ?? ""
      )
    else throw new Error("Use a Google Fonts link, or type the font's name.")
  }
  family = family.replace(/\+/g, " ").replace(/\s+/g, " ").trim()
  if (!FAMILY.test(family))
    throw new Error('Enter a Google Fonts name such as "Fira Code", or its link.')
  return {
    family,
    href: `https://fonts.googleapis.com/css?family=${family.replace(/ /g, "+")}:400,500,600,700&display=swap`,
  }
}

/** A CSS family name for an uploaded file, e.g. "MyFont-Regular.woff2" -> "MyFont Regular". */
export function familyFromFile(name: string) {
  const family = name
    .replace(/\.(woff2?|ttf|otf)$/i, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .slice(0, 60)
  return family || "Custom font"
}

export const isFontFile = (name: string) => /\.(woff2?|ttf|otf)$/i.test(name)

export function fontStack(family: string) {
  return `"${family.replace(/[^A-Za-z0-9 ]/g, "")}", ui-monospace, "Cascadia Mono", Consolas, monospace`
}

export function isSavedFont(value: unknown): value is SavedFont {
  const font = value as SavedFont | null
  return (
    !!font &&
    typeof font === "object" &&
    typeof font.family === "string" &&
    FAMILY.test(font.family) &&
    ((font.source === "google" &&
      typeof font.href === "string" &&
      font.href.startsWith("https://fonts.googleapis.com/")) ||
      (font.source === "file" &&
        typeof font.data === "string" &&
        font.data.startsWith("data:")))
  )
}
