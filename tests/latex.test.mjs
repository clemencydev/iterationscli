import test from "node:test"
import assert from "node:assert/strict"
import {
  FONTS,
  PACKAGES,
  TEMPLATES,
  addPackage,
  analyze,
  bibEntries,
  completions,
  currentFont,
  findMainFile,
  maskSource,
  needsRerun,
  outline,
  parseLog,
  plainText,
  removePackage,
  setFont,
  texEscape,
  wordCount,
} from "../lib/latex.ts"

const PREAMBLE = String.raw`% Draft of the quarterly report
% \documentclass{book} is not the class
\documentclass[11pt, a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,
  graphicx}
\usepackage[colorlinks=true, linkcolor={red!50!black}]{hyperref}
`

/** A document that exercises comments, verbatim and odd heading forms. */
const DOCUMENT =
  PREAMBLE +
  String.raw`\begin{document}
\section{Introduction}\label{sec:intro}
% \section{Commented out}
Costs rose 5\% % \section{Also a comment}
\section*{Acknowledgements}
\subsection[Short]{A \textbf{bold} start with $x^2$ and {nested {braces}}}
\label{sec:bold}
\begin{verbatim}
\section{Inside verbatim}
\end{verbatim}
\verb|\section{inline verbatim}|
\paragraph{Spanning
  two lines}
\chapter{The \LaTeX{} way}
\end{document}
`

test("the outline skips comments and verbatim and reads every heading form", () => {
  const entries = outline(DOCUMENT)
  assert.deepEqual(
    entries.map((e) => [e.kind, e.level, e.title, e.line, e.starred, e.label]),
    [
      ["section", 2, "Introduction", 9, false, "sec:intro"],
      ["section", 2, "Acknowledgements", 12, true, undefined],
      [
        "subsection",
        3,
        "A bold start with $x^2$ and nested braces",
        13,
        false,
        "sec:bold",
      ],
      ["paragraph", 5, "Spanning two lines", 19, false, undefined],
      ["chapter", 1, "The LaTeX way", 21, false, undefined],
    ]
  )
  assert.equal(
    entries.find((e) => e.title === "Introduction").label,
    "sec:intro"
  )
})

test("line numbers stay right with CRLF line endings", () => {
  const crlf = DOCUMENT.replace(/\n/g, "\r\n")
  assert.deepEqual(
    outline(crlf).map((e) => [e.title, e.line, e.label]),
    outline(DOCUMENT).map((e) => [e.title, e.line, e.label])
  )
  assert.equal(analyze(crlf).documentClass.line, 3)
  assert.equal(maskSource(crlf).length, crlf.length)
})

test("heading text loses formatting but keeps maths", () => {
  assert.equal(plainText(String.raw`\textbf{Intro} to $x$`), "Intro to $x$")
  assert.equal(
    plainText(String.raw`R\&D~costs\footnote{In 2024.}`),
    "R&D costs"
  )
  assert.equal(
    plainText(String.raw`Cost of \$5 \emph{per} unit`),
    "Cost of $5 per unit"
  )
})

test("analysis reads the class, packages, inputs, graphics and bibliography", () => {
  const source =
    PREAMBLE +
    String.raw`\RequirePackage{etoolbox}
\usepackage[backend=biber,style=apa]{biblatex}
\addbibresource{refs}
\begin{document}
\input{sections/intro}
\input chapter2
\include{appendix.tex}
\subfile{parts/extra}
\import{figures/}{diagram}
\includegraphics[width=\linewidth]{img/plot.pdf}
% \includegraphics{ignored.png}
\end{document}
`
  const a = analyze(source)
  assert.deepEqual(a.documentClass, {
    name: "article",
    options: ["11pt", "a4paper"],
    line: 3,
  })
  assert.deepEqual(
    a.packages.map((p) => p.name),
    [
      "fontenc",
      "amsmath",
      "amssymb",
      "graphicx",
      "hyperref",
      "etoolbox",
      "biblatex",
    ]
  )
  assert.deepEqual(a.packages[1], { name: "amsmath", options: [], line: 5 })
  assert.deepEqual(a.packages[4].options, [
    "colorlinks=true",
    "linkcolor={red!50!black}",
  ])
  assert.deepEqual(a.inputs, [
    "sections/intro.tex",
    "chapter2.tex",
    "appendix.tex",
    "parts/extra.tex",
    "figures/diagram.tex",
  ])
  assert.deepEqual(a.graphics, ["img/plot.pdf"])
  assert.deepEqual(a.bibliographies, ["refs.bib"])
  assert.equal(a.bibTool, "biber")
  assert.equal(a.standalone, true)
  assert.equal(a.engine, undefined)
})

test("the engine, bibliography tool and root come from comments and packages", () => {
  const bibtex = analyze(String.raw`\documentclass{article}
\begin{document}\cite{x}\bibliography{refs,more.bib}\end{document}`)
  assert.equal(bibtex.bibTool, "bibtex")
  assert.deepEqual(bibtex.bibliographies, ["refs.bib", "more.bib"])
  assert.equal(
    analyze("\\usepackage[backend=bibtex]{biblatex}").bibTool,
    "bibtex"
  )
  assert.equal(analyze("\\documentclass{article}").bibTool, "none")
  assert.equal(
    analyze("% !TEX program = lualatex\n\\documentclass{article}").engine,
    "lualatex"
  )
  assert.equal(analyze("%!TeX TS-program = XeLaTeX\n").engine, "xelatex")
  assert.equal(analyze("\\usepackage{fontspec}").engine, "xelatex")
  assert.equal(analyze("% \\usepackage{fontspec}").engine, undefined)
  const part = analyze("% !TEX root = ../main.tex\n\\section{Intro}")
  assert.equal(part.root, "../main.tex")
  assert.equal(part.standalone, false)
})

test("the main file is the one with a class, preferring main.tex and !TEX root", () => {
  const doc =
    "\\documentclass{article}\n\\begin{document}\n\\input{intro}\n\\end{document}\n"
  assert.equal(
    findMainFile([
      { name: "intro.tex", text: "\\section{Intro}" },
      { name: "thesis.tex", text: doc },
      { name: "notes.md", text: "\\documentclass{article}" },
    ]),
    "thesis.tex"
  )
  assert.equal(
    findMainFile([
      { name: "draft.tex", text: doc },
      { name: "main.tex", text: doc },
    ]),
    "main.tex"
  )
  // A subfile compiles alone but is not the document.
  assert.equal(
    findMainFile([
      {
        name: "chapters/one.tex",
        text: "\\documentclass[../book.tex]{subfiles}\n\\begin{document}\nx\n\\end{document}",
      },
      { name: "book.tex", text: doc },
    ]),
    "book.tex"
  )
  // A root comment wins over the name.
  assert.equal(
    findMainFile([
      { name: "main.tex", text: doc },
      { name: "src/report.tex", text: doc },
      {
        name: "src/parts/a.tex",
        text: "% !TEX root = ../report.tex\n\\section{A}",
      },
    ]),
    "src/report.tex"
  )
  assert.equal(
    findMainFile([{ name: "a.tex", text: "\\section{A}" }]),
    undefined
  )
  assert.equal(findMainFile([]), undefined)
})

test("adding a package puts it after the others but before hyperref", () => {
  const added = addPackage(DOCUMENT, "booktabs")
  const lines = added.split("\n")
  assert.equal(lines[6], "\\usepackage{booktabs}")
  assert.match(lines[7], /hyperref/)
  assert.equal(addPackage(DOCUMENT, "graphicx", ["draft"]), DOCUMENT)
  assert.equal(addPackage(DOCUMENT, "amssymb"), DOCUMENT)
  const cleveref = addPackage(DOCUMENT, "cleveref", ["capitalise"]).split("\n")
  assert.equal(cleveref[7], "\\usepackage[capitalise]{cleveref}")
  // With no packages yet it goes straight after the class.
  const bare =
    "\\documentclass{article}\r\n\\begin{document}\r\nHi\r\n\\end{document}\r\n"
  assert.equal(
    addPackage(bare, "xcolor"),
    "\\documentclass{article}\r\n\\usepackage{xcolor}\r\n\\begin{document}\r\nHi\r\n\\end{document}\r\n"
  )
  // A package mentioned only in a comment is not loaded.
  assert.match(
    addPackage("\\documentclass{article}\n% \\usepackage{xcolor}\n", "xcolor"),
    /^\\usepackage\{xcolor\}$/m
  )
})

test("removing a package edits lists and drops lines it empties", () => {
  const withoutAmssymb = removePackage(DOCUMENT, "amssymb")
  assert.match(withoutAmssymb, /\\usepackage\{amsmath,graphicx\}/)
  const withoutFontenc = removePackage(DOCUMENT, "fontenc")
  assert.equal(withoutFontenc.includes("fontenc"), false)
  assert.equal(
    withoutFontenc.split("\n").length,
    DOCUMENT.split("\n").length - 1
  )
  assert.equal(removePackage(DOCUMENT, "tikz"), DOCUMENT)
  assert.equal(
    removePackage(addPackage(DOCUMENT, "booktabs"), "booktabs"),
    DOCUMENT
  )
})

test("setFont writes one block in the preamble and can take it out again", () => {
  const once = setFont(DOCUMENT, "palatino")
  assert.equal(setFont(once, "palatino"), once)
  assert.equal(currentFont(once), "palatino")
  const lines = once.split("\n")
  const start = lines.findIndex((l) => l.startsWith("%% font: palatino"))
  const begin = lines.indexOf("\\begin{document}")
  assert.ok(start > 2 && start < begin)
  assert.equal(lines[begin - 1], "%% end font")
  assert.ok(lines.includes("\\usepackage{newpxtext}"))
  // Changing the font replaces the block where it is.
  const twice = setFont(once, "fira-sans")
  assert.equal(currentFont(twice), "fira-sans")
  assert.equal(twice.includes("newpxtext"), false)
  assert.equal(setFont(twice, "default"), DOCUMENT)
  assert.equal(currentFont(DOCUMENT), undefined)
  assert.equal(currentFont("%% font: lato\n\\usepackage{lato}\n"), undefined)
  assert.throws(
    () => setFont(DOCUMENT, "comic-sans"),
    /no font called "comic-sans"/
  )
  assert.throws(() => setFont("\\section{A}", "lato"), /no \\documentclass/)
  // A package added later never lands inside the block.
  const withPackage = addPackage(
    setFont(
      "\\documentclass{article}\n\\begin{document}\n\\end{document}\n",
      "times"
    ),
    "xcolor"
  )
  assert.equal(currentFont(withPackage), "times")
  assert.equal(
    setFont(withPackage, "default"),
    "\\documentclass{article}\n\\usepackage{xcolor}\n\\begin{document}\n\\end{document}\n"
  )
  // CRLF files keep their line endings.
  const crlf = setFont(DOCUMENT.replace(/\n/g, "\r\n"), "lato")
  assert.equal(crlf.replace(/\r\n/g, "").includes("\n"), false)
})

/** Breaks lines at 79 characters, as pdfTeX writes its log. */
function texWrap(text) {
  return text
    .split("\n")
    .flatMap((line) => {
      const parts = []
      for (let i = 0; i < line.length; i += 79)
        parts.push(line.slice(i, i + 79))
      // A line that exactly fills its last row is followed by an empty one.
      if (line.length % 79 === 0) parts.push("")
      return parts
    })
    .join("\n")
}

const TL = "/usr/local/texlive/2024/texmf-dist/tex/latex"
// TeX quotes names as `name'.
const Q = "`"
const LOG =
  texWrap(String.raw`This is pdfTeX, Version 3.141592653-2.6-1.40.26 (TeX Live 2024) (preloaded format=pdflatex 2024.11.2)  18 NOV 2026 10:04
entering extended mode
 restricted \write18 enabled.
 %&-line parsing enabled.
**main.tex
(./main.tex
LaTeX2e <2024-11-01>
L3 programming layer <2024-10-09>
(${TL}/base/article.cls
Document Class: article 2024/06/29 v1.4n Standard LaTeX document class
(${TL}/base/size11.clo
File: size11.clo 2024/06/29 v1.4n Standard LaTeX file (size option)
)
\c@part=\count192
) (${TL}/babel/babel.sty
Package: babel 2024/10/14 v24.12 The Babel package
! Package babel Error: Unknown option ${Q}englsh'. Either you misspelled it
(babel)                or the language definition file englsh.ldf was not found.

See the babel package documentation for explanation.
Type  H <return>  for immediate help.
 ...

l.4434 \ProcessOptions*

) (${TL}/hyperref/hyperref.sty
Package: hyperref 2024-11-05 v7.01l Hypertext links for LaTeX
) (./main.aux)

LaTeX Warning: Citation ${Q}okafor2021' on page 1 undefined on input line 18.

[1{/usr/local/texlive/2024/texmf-var/fonts/map/pdftex/updmap/pdftex.map}] (./sections/introduction-and-background.tex
! Undefined control sequence.
l.7 Our results are \textbff
                            {significant}.
The control sequence at the end of the top line
of your error message was never \def'ed. If you have
misspelled it (e.g., '\hobx'), type 'I' and the correct
spelling (e.g., 'I\hbox'). Otherwise just continue,
and I'll forget about whatever was undefined.

Overfull \hbox (12.34pt too wide) in paragraph at lines 10--12
[]\T1/lmr/m/n/10.95 The pipeline (see the figure on the next page for an overview of
 []

Package hyperref Warning: Token not allowed in a PDF string (Unicode):
(hyperref)                removing 'math shift' on input line 14.

) (./sections/results.tex
! Extra alignment tab has been changed to \cr.
<template> \endtemplate

l.22   Baseline & 0.81 & 0.77 &
                                0.12 \\
You have given more \span or & marks than there were
in the preamble to the \halign or \valign now in progress.

! Missing $ inserted.
<inserted text>
                $
l.30 where x_
             i is the input
I've inserted a begin-math/end-math symbol since I think
you left one out. Proceed, with fingers crossed.

! Missing $ inserted.
<inserted text>
                $
l.30 where x_
             i is the input

LaTeX Warning: Reference ${Q}fig:pipeline' on page 2 undefined on input line 35.


Underfull \hbox (badness 10000) in paragraph at lines 40--41

 []

)
! LaTeX Error: Environment itemze undefined.

See the LaTeX manual or LaTeX Companion for explanation.
Type  H <return>  for immediate help.
 ...

l.52 \begin{itemze}

Your command was ignored.

[2] (./main.aux)

LaTeX Warning: There were undefined references.


LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.

 )
(see the transcript file for additional information)
Output written on main.pdf (2 pages, 81234 bytes).
Transcript written on main.log.
`)

test("a multi-file pdfTeX log becomes problems with files, lines and hints", () => {
  assert.ok(
    LOG.split("\n").some((line) => line.length === 79),
    "the fixture is wrapped"
  )
  const problems = parseLog(LOG, "main.tex")
  const brief = problems.map((p) => [p.severity, p.file, p.line, p.message])
  const intro = "sections/introduction-and-background.tex"
  assert.deepEqual(brief, [
    [
      "error",
      "main.tex",
      undefined,
      "Package babel: Unknown option 'englsh'. Either you misspelled it or the language definition file englsh.ldf was not found.",
    ],
    [
      "warning",
      "main.tex",
      18,
      "Citation 'okafor2021' on page 1 undefined on input line 18.",
    ],
    ["error", intro, 7, "Undefined control sequence."],
    [
      "info",
      intro,
      10,
      "Overfull \\hbox (12.34pt too wide) in paragraph at lines 10--12",
    ],
    [
      "warning",
      intro,
      14,
      "Package hyperref: Token not allowed in a PDF string (Unicode): removing 'math shift' on input line 14.",
    ],
    [
      "error",
      "sections/results.tex",
      22,
      "Extra alignment tab has been changed to \\cr.",
    ],
    ["error", "sections/results.tex", 30, "Missing $ inserted."],
    [
      "warning",
      "sections/results.tex",
      35,
      "Reference 'fig:pipeline' on page 2 undefined on input line 35.",
    ],
    [
      "info",
      "sections/results.tex",
      40,
      "Underfull \\hbox (badness 10000) in paragraph at lines 40--41",
    ],
    ["error", "main.tex", 52, "Environment itemze undefined."],
    ["warning", "main.tex", undefined, "There were undefined references."],
    [
      "warning",
      "main.tex",
      undefined,
      "Label(s) may have changed. Rerun to get cross-references right.",
    ],
  ])
  const [
    babel,
    citation,
    undefinedCs,
    overfull,
    token,
    tab,
    math,
    reference,
    ,
    env,
  ] = problems
  assert.match(babel.hint, /englsh is not an option/)
  assert.match(citation.hint, /okafor2021/)
  assert.match(
    undefinedCs.detail,
    /^l\.7 Our results are \\textbff\n\s+\{significant\}\.$/
  )
  assert.equal(
    undefinedCs.hint,
    "\\textbff is not a command LaTeX knows. Did you mean \\textbf? If not, load the package that defines it."
  )
  assert.match(overfull.hint, /12\.34pt into the margin/)
  assert.match(token.hint, /\\texorpdfstring/)
  assert.match(tab.hint, /more & separators/)
  assert.match(tab.detail, /l\.22 {3}Baseline/)
  assert.match(math.hint, /outside a formula/)
  assert.match(reference.hint, /\\label\{fig:pipeline\}/)
  assert.match(env.hint, /Did you mean itemize\?/)
  assert.ok(problems.every((p) => !/texmf/.test(p.file ?? "")))
})

test("a missing package takes its line from the emergency stop that follows", () => {
  const log = String.raw`(./resume.tex
LaTeX2e <2024-11-01>
(/usr/local/texlive/2024/texmf-dist/tex/latex/base/article.cls
Document Class: article 2024/06/29 v1.4n Standard LaTeX document class
)
! LaTeX Error: File ${"`"}moderncvstyle.sty' not found.

Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: sty)

Enter file name:
! Emergency stop.
<read *>

l.5 \usepackage
               {moderncvstyle}^^M
*** (cannot \read from terminal in nonstop modes)
`
  const problems = parseLog(log)
  assert.equal(problems.length, 1)
  const [missing] = problems
  assert.equal(missing.message, "File 'moderncvstyle.sty' not found.")
  assert.equal(missing.file, "resume.tex")
  assert.equal(missing.line, 5)
  assert.match(missing.hint, /add moderncvstyle\.sty to the project/)
  assert.match(missing.detail, /l\.5 \\usepackage/)
})

test("common errors get plain hints", () => {
  const hint = (log) => parseLog(log)[0]?.hint ?? ""
  const error = (message, line = "l.9 x") =>
    `(./main.tex\n! ${message}\n${line}\n\n)`
  assert.match(
    hint(error("Undefined control sequence.", "l.9 \\href")),
    /hyperref package.*\\usepackage\{hyperref\}/
  )
  assert.match(
    hint(error("Undefined control sequence.", "l.9 \\rowcolor")),
    /\\usepackage\[table\]\{xcolor\}/
  )
  assert.match(
    hint(error("Undefined control sequence.", "l.9 \\qwertyuiop")),
    /^\\qwertyuiop is not a command LaTeX knows\. Check the spelling/
  )
  assert.match(
    hint(error("LaTeX Error: Environment align undefined.")),
    /amsmath/
  )
  assert.match(hint(error("Missing } inserted.")), /brace is missing/)
  assert.match(
    hint(error("File ended while scanning use of \\textbf.")),
    /\\textbf was still reading/
  )
  assert.match(
    hint(error("Paragraph ended before \\emph was complete.")),
    /blank line .* \\emph/
  )
  assert.match(
    hint(error("TeX capacity exceeded, sorry [main memory size=5000000].")),
    /calls itself/
  )
  assert.match(
    hint(
      error("LaTeX Error: Unknown option 'colorlink' for package 'hyperref'.")
    ),
    /hyperref has no option called colorlink/
  )
  assert.match(
    hint(
      error(
        "Font \\T1/foo/m/n/10=foo at 10pt not loadable: Metric (TFM) file not found."
      )
    ),
    /font menu/
  )
  assert.match(
    hint(error("LaTeX Error: Unicode character \u2192 (U+2192)")),
    /U\+2192/
  )
  assert.match(
    hint(
      error(
        "LaTeX Error: \\begin{itemize} on input line 4 ended by \\end{document}."
      )
    ),
    /Add \\end\{itemize\}/
  )
  assert.match(hint(error("Misplaced alignment tab character &.")), /write \\&/)
  assert.match(
    hint(
      "(./main.tex\nLaTeX Font Warning: Font shape `T1/lmr/bx/sc' undefined\n(Font)              using `T1/lmr/bx/n' instead on input line 3.\n)"
    ),
    /closest one/
  )
  const runaway = parseLog(
    "(./cv.tex\nRunaway argument?\n{Senior engineer at Bluefin \n! Paragraph ended before \\textbf was complete.\n<to be read again> \n                   \\par \nl.12 \n     \n)"
  )
  assert.equal(runaway.length, 1)
  assert.equal(runaway[0].line, 12)
  assert.match(runaway[0].detail, /^Runaway argument\? \{Senior engineer/)
  const fatal = parseLog(
    "(./main.tex\n! Emergency stop.\n<*> main.tex\n             \n*** (job aborted, no legal \\end found)\n\n!  ==> Fatal error occurred, no output PDF file produced!\n)"
  )
  assert.equal(fatal.length, 1)
  assert.match(fatal[0].hint, /\\end\{document\}/)
})

test("BibTeX and class warnings are read too", () => {
  const blg = String.raw`This is BibTeX, Version 0.99d (TeX Live 2024)
The top-level auxiliary file: main.aux
The style file: plain.bst
Database file #1: references.bib
Warning--I didn't find a database entry for "smith2020"
I was expecting a ${"`"},' or a ${"`"}}'---line 14 of file references.bib
(There were 1 error messages)
`
  const problems = parseLog(blg)
  assert.deepEqual(
    problems.map((p) => [p.severity, p.file, p.line]),
    [
      ["warning", undefined, undefined],
      ["error", "references.bib", 14],
    ]
  )
  assert.match(problems[0].hint, /smith2020/)
  const cls = parseLog(
    "(./main.tex\nClass beamer Warning: Ignoring frame 'x'\n(beamer)              on input line 8.\n)"
  )
  assert.equal(
    cls[0].message,
    "Class beamer: Ignoring frame 'x' on input line 8."
  )
  assert.equal(cls[0].line, 8)
})

test("logs without problems, empty logs and cut-off logs never throw", () => {
  const clean = String.raw`This is pdfTeX, Version 3.141592653-2.6-1.40.26 (TeX Live 2024)
(./main.tex
LaTeX2e <2024-11-01>
(/usr/local/texlive/2024/texmf-dist/tex/latex/base/article.cls
Document Class: article 2024/06/29 v1.4n Standard LaTeX document class
) (./main.aux) [1] (./main.aux) )
Output written on main.pdf (1 page, 18232 bytes).
`
  assert.deepEqual(parseLog(clean), [])
  assert.deepEqual(parseLog(""), [])
  assert.deepEqual(
    parseLog(")))(((\n!\n! \nl.\n"),
    parseLog(")))(((\n!\n! \nl.\n")
  )
  for (let cut = 0; cut < LOG.length; cut += 97) {
    const problems = parseLog(LOG.slice(0, cut), "main.tex")
    assert.ok(Array.isArray(problems))
  }
  assert.deepEqual(parseLog(undefined), [])
  assert.equal(needsRerun(undefined), false)
})

test("the log says when another pass is needed", () => {
  assert.equal(needsRerun(LOG), true)
  assert.equal(needsRerun("(./main.tex\nNo file main.toc.\n)"), true)
  assert.equal(
    needsRerun(
      "Package rerunfilecheck Warning: File `main.out' has changed.\n(rerunfilecheck)                Rerun to get outlines right\n"
    ),
    true
  )
  assert.equal(
    needsRerun(
      "Package longtable Warning: Table widths have changed. Rerun LaTeX."
    ),
    true
  )
  assert.equal(
    needsRerun(
      "Package biblatex Warning: Please (re)run Biber on the file:\n(biblatex)                main"
    ),
    false
  )
  assert.equal(
    needsRerun(
      "(./main.tex\nLaTeX Warning: There were undefined references.\n)"
    ),
    false
  )
  assert.equal(needsRerun(""), false)
})

test("completions cover the catalog and what the document defines", () => {
  const source = String.raw`\documentclass{article}
\newcommand{\R}{\mathbb{R}}
\newcommand\norm[1]{\lVert #1\rVert}
\NewDocumentCommand{\pair}{mm}{(#1, #2)}
\newtheorem{lemma}{Lemma}
\begin{document}
\section{A}\label{sec:a}
\begin{figure}\caption{x}\label{fig:plot}\end{figure}
% \label{commented}
\end{document}`
  const bib =
    "@article{okafor2021,\n  author = {Okafor, Ada and Lind, Bo},\n  title = {Rivers},\n  year = 2021\n}"
  const all = completions(source, {
    bib: [bib, "loose-key"],
    files: ["img/plot.png"],
  })
  const find = (kind, label) =>
    all.find((c) => c.kind === kind && c.label === label)
  assert.ok(all.filter((c) => c.kind === "command").length > 300)
  assert.equal(find("command", "\\frac").apply, "\\frac{${1:num}}{${2:den}}")
  assert.equal(find("command", "\\alpha").apply, undefined)
  assert.equal(
    find("command", "\\includegraphics").apply,
    "\\includegraphics[${1:width=\\linewidth}]{${2:file}}"
  )
  assert.equal(
    find("environment", "itemize").apply,
    "\\begin{itemize}\n\t\\item ${1}\n\\end{itemize}"
  )
  assert.match(
    find("environment", "tabular").apply,
    /^\\begin\{tabular\}\{\$\{1:ll\}\}\n\t\$\{2\} \\\\\n\\end\{tabular\}$/
  )
  assert.equal(
    find("package", "geometry").detail,
    PACKAGES.find((p) => p.name === "geometry").summary
  )
  assert.ok(find("class", "beamer"))
  assert.deepEqual(
    all.filter((c) => c.kind === "reference").map((c) => c.label),
    ["sec:a", "fig:plot"]
  )
  assert.equal(find("command", "\\R").apply, undefined)
  assert.equal(find("command", "\\norm").apply, "\\norm{${1}}")
  assert.equal(find("command", "\\pair").apply, "\\pair{${1}}{${2}}")
  assert.match(find("environment", "lemma").detail, /theorem/)
  assert.equal(
    find("citation", "okafor2021").detail,
    "Okafor and Lind, 2021, Rivers"
  )
  assert.ok(find("citation", "loose-key"))
  assert.ok(find("file", "img/plot.png"))
  const keys = all.map((c) => `${c.kind} ${c.label}`)
  assert.equal(new Set(keys).size, keys.length)
})

test("word count reads text and headings, not commands, comments or maths", () => {
  const source = String.raw`\documentclass{article}
\title{Not counted in the preamble}
\begin{document}
\section{Two words}
Hello \textbf{bold} world, see Figure~\ref{fig:x} and \cite[p.~4]{key}. % not this
Inline $a+b$ and \(c\) maths, then
\[ x = 1 \]
\begin{align}
  y &= 2
\end{align}
\begin{tabular}{ll}
  Cell one & Cell two \\
\end{tabular}
\begin{itemize}[noitemsep]
  \item[Term] described here\footnote{A footnote is not text.}
\end{itemize}
\verb|verbatim words| R\&D costs \$5\\[4pt]
\end{document}
ignored after the end`
  assert.deepEqual(wordCount(source), {
    words: 22,
    headings: 1,
    mathInline: 2,
    mathDisplay: 2,
  })
  assert.deepEqual(wordCount(""), {
    words: 0,
    headings: 0,
    mathInline: 0,
    mathDisplay: 0,
  })
  assert.equal(wordCount("Just a fragment with no preamble.").words, 6)
})

test("BibTeX entries give keys and short descriptions", () => {
  const bib = String.raw`@string{jur = "Journal of Urban Research"}
@comment{ @article{fake, title = {No} } }
@article{marsh2023,
  author = {Marsh, Elena and Raman, Priya and Kowal, Tomasz},
  title = {Low-cost {Sensor} networks},
  journal = jur,
  year = {2023}
}
@book(knuth1984,
  author = "Donald E. Knuth",
  title = "The {\TeX}book",
  date = {1984-01-01}
)
@misc{who2020, author = {{World Health Organization}}, title = {Report # 4}}
@inproceedings{m{\"u}ller, author = {M{\"u}ller, Jan}}
`
  assert.deepEqual(bibEntries(bib), [
    {
      key: "marsh2023",
      type: "article",
      description: "Marsh et al., 2023, Low-cost Sensor networks",
    },
    { key: "knuth1984", type: "book", description: "Knuth, 1984, The TeXbook" },
    {
      key: "who2020",
      type: "misc",
      description: "World Health Organization, Report # 4",
    },
  ])
  assert.deepEqual(bibEntries(""), [])
})

test("text is escaped for LaTeX", () => {
  assert.equal(
    texEscape("R&D: 50% of $10 #1 a_b {x} ~ ^ \\"),
    "R\\&D: 50\\% of \\$10 \\#1 a\\_b \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}"
  )
  assert.equal(texEscape("plain"), "plain")
})

test("the package and font catalogs are well formed", () => {
  const names = PACKAGES.map((p) => p.name)
  assert.equal(new Set(names).size, names.length)
  assert.ok(PACKAGES.length >= 80 && PACKAGES.length <= 130)
  assert.ok(new Set(PACKAGES.map((p) => p.category)).size >= 12)
  assert.ok(
    PACKAGES.every((p) => p.summary.endsWith(".") && p.summary.length < 110)
  )
  const ids = FONTS.map((f) => f.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(new Set(FONTS.map((f) => f.name)).size, FONTS.length)
  assert.ok(FONTS.length >= 20 && FONTS.length <= 32)
  for (const f of FONTS) {
    if (f.engine === "pdflatex" && f.kind !== "math" && f.id !== "cmbright")
      assert.match(f.preamble, /\\usepackage\[T1\]\{fontenc\}/, f.id)
    if (f.engine === "xelatex")
      assert.match(f.preamble, /fontspec|unicode-math/, f.id)
    assert.ok(!f.preamble.includes("fontspec") || f.engine === "xelatex", f.id)
  }
})

// Packages the templates load that the catalog need not list.
const TEMPLATE_PACKAGE_ALLOW = new Set([])

/** Source with comments and \verb blanked and escaped braces removed. */
const code = (text) => maskSource(text).replace(/\\[{}%$&#_\\]/g, "  ")

test("every template is complete and balanced", () => {
  const ids = TEMPLATES.map((t) => t.id)
  assert.deepEqual(ids, [
    "resume-classic",
    "resume-modern",
    "cv-academic",
    "cover-letter",
    "letter",
    "article",
    "report",
    "slides",
    "notes",
    "blank",
  ])
  assert.equal(new Set(TEMPLATES.map((t) => t.name)).size, TEMPLATES.length)
  const catalog = new Set(PACKAGES.map((p) => p.name))
  for (const t of TEMPLATES) {
    const names = t.files.map((f) => f.name)
    assert.ok(names.includes(t.main), `${t.id} has its main file`)
    assert.equal(findMainFile(t.files), t.main, t.id)
    const main = analyze(t.files.find((f) => f.name === t.main).text)
    assert.ok(main.standalone, `${t.id} compiles alone`)
    for (const file of [
      ...main.inputs,
      ...main.bibliographies,
      ...main.graphics,
    ])
      assert.ok(names.includes(file), `${t.id} includes ${file}`)
    assert.equal(
      main.bibTool,
      main.bibliographies.length ? "bibtex" : "none",
      t.id
    )
    for (const file of t.files.filter((f) => f.name.endsWith(".tex"))) {
      const text = code(file.text)
      const opens = (text.match(/\{/g) ?? []).length
      const closes = (text.match(/\}/g) ?? []).length
      assert.equal(opens, closes, `braces balance in ${t.id}/${file.name}`)
      const stack = []
      for (const m of text.matchAll(/\\(begin|end)\s*\{([^}]*)\}/g)) {
        if (m[1] === "begin") stack.push(m[2])
        else
          assert.equal(
            stack.pop(),
            m[2],
            `\\end{${m[2]}} in ${t.id}/${file.name}`
          )
      }
      assert.deepEqual(stack, [], `environments close in ${t.id}/${file.name}`)
      assert.equal(
        analyze(file.text).engine,
        undefined,
        `${t.id} runs on pdfLaTeX`
      )
      for (const p of analyze(file.text).packages)
        assert.ok(
          catalog.has(p.name) || TEMPLATE_PACKAGE_ALLOW.has(p.name),
          `${t.id} loads ${p.name}`
        )
      assert.ok(
        !/[^\x00-\x7f]/.test(file.text),
        `${t.id}/${file.name} is plain ASCII`
      )
    }
  }
})

test("every font survives setFont and currentFont on every template", () => {
  for (const t of TEMPLATES) {
    const text = t.files.find((f) => f.name === t.main).text
    const outlineBefore = outline(text)
    for (const f of FONTS) {
      const set = setFont(text, f.id)
      assert.equal(currentFont(set), f.id, `${t.id} with ${f.id}`)
      assert.equal(setFont(set, f.id), set)
      assert.equal(setFont(set, "default"), text)
      assert.ok(analyze(set).standalone)
      assert.equal(outline(set).length, outlineBefore.length)
    }
  }
})

test("errors written as file:line: by the in-browser engine read like plain ones", () => {
  const log = [
    "This is pdfTeX, Version 3.141592653-2.6-1.40.29 (TeX Live 2026_busytexwasm)",
    "**/main.tex",
    "(/main.tex",
    "LaTeX2e <2026-06-01>",
    "(/texlive/texmf-dist/tex/latex/base/article.cls",
    "Document Class: article 2025/01/22 v1.4n Standard LaTeX document class",
    ")",
    "",
    "/main.tex:114: Undefined control sequence.",
    "l.114 \\textbff",
    "              {oops}",
    "The control sequence at the end of the top line",
    "of your error message was never \\def'ed.",
    "",
    "(./sections/intro.tex",
    "./sections/intro.tex:7: Missing $ inserted.",
    "<inserted text> ",
    "                $",
    "l.7 a_",
    "      b",
    ")",
    "/main.tex:120: LaTeX Error: Environment itemise undefined.",
    "",
    "l.120 \\begin{itemise}",
    "",
  ].join("\n")
  const found = parseLog(log, "main.tex")
  assert.deepEqual(
    found.map((d) => [d.severity, d.file, d.line, d.message]),
    [
      ["error", "/main.tex", 114, "Undefined control sequence."],
      ["error", "sections/intro.tex", 7, "Missing $ inserted."],
      ["error", "/main.tex", 120, "Environment itemise undefined."],
    ]
  )
  assert.match(found[0].hint, /textbff/)
  // A path with a colon and digits in running text is not taken for an error.
  assert.deepEqual(parseLog("Loading main.tex:12 is fine\n(./main.tex)\n"), [])
})

test("the installation's duplicate font-map notices are not reported", () => {
  const noise = Array.from(
    { length: 40 },
    (_, i) =>
      `pdfTeX warning: /bin/busytex (file /texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map): fontmap entry for \`f${i}' already exists, duplicates ignored`
  )
  const log = [
    "(/main.tex",
    ...noise,
    "pdfTeX warning: /bin/busytex (file /texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map): invalid entry for `pbkdo8r': SlantFont/ExtendFont can be used only with embedded Type1 fonts",
    "LaTeX Warning: Reference `fig:one' on page 1 undefined on input line 12.",
    ")",
  ].join("\n")
  assert.deepEqual(
    parseLog(log, "main.tex").map((d) => [d.severity, d.line, d.message]),
    [["warning", 12, "Reference 'fig:one' on page 1 undefined on input line 12."]]
  )
})
