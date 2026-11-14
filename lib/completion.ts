// Command-line completion for the terminals. Pure and registry-driven: it walks
// the same `Command` records the terminals describe themselves with (see
// contexts/TerminalContext/commands.ts), so a new command completes for free.

export type CompletionArg = {
  name: string
  /** Shown as a hint while the argument is empty. (Spelling matches the registry.) */
  descriprion?: string
  /** Fixed choices for this argument. */
  values?: string[]
  /** Name of a live value list supplied by the caller, e.g. "task" or "column". */
  source?: string
}
export type CompletionCommand = {
  name: string
  usage?: string
  args?: CompletionArg[]
  sub_commands?: Record<string, CompletionCommand>
}
export type Candidate = { value: string; description?: string }
export type Sources = Record<string, (Candidate | string)[]>
export type Completion = {
  /** Index in the input where the word being completed starts. */
  start: number
  /** The word being completed, without its opening quote. */
  partial: string
  candidates: Candidate[]
  /** Placeholder for the expected argument when nothing can be listed. */
  hint: string
}

/** Splits a command line into finished words and the word under the caret (end of input). */
export function splitInput(input: string): {
  done: string[]
  start: number
  partial: string
} {
  const done: string[] = []
  let word = "",
    start = 0,
    quote = "",
    open = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quote) {
      if (c === quote) quote = ""
      else word += c
    } else if (c === '"' || c === "'") {
      if (!open) start = i
      open = true
      quote = c
    } else if (/\s/.test(c)) {
      if (open) done.push(word)
      word = ""
      open = false
    } else {
      if (!open) start = i
      open = true
      word += c
    }
  }
  return open
    ? { done, start, partial: word }
    : { done, start: input.length, partial: "" }
}

const quoted = (value: string) =>
  /\s/.test(value) || !value ? `"${value}"` : value

export function complete(
  input: string,
  registry: Record<string, CompletionCommand>,
  sources: Sources = {}
): Completion {
  const { done, start, partial } = splitInput(input)
  const result = (
    items: (Candidate | string)[],
    hint = ""
  ): Completion => {
    const needle = partial.toLowerCase()
    const seen = new Set<string>()
    const candidates = items
      .map((item) => (typeof item === "string" ? { value: item } : item))
      .filter((item) => {
        if (!item.value.toLowerCase().startsWith(needle)) return false
        if (seen.has(item.value)) return false
        seen.add(item.value)
        return true
      })
    return { start, partial, candidates, hint }
  }
  const describe = (commands: Record<string, CompletionCommand>) =>
    Object.entries(commands).map(([value, command]) => ({
      value,
      description: command.usage,
    }))

  if (!done.length) return result(describe(registry))
  let command: CompletionCommand | undefined = Object.hasOwn(
    registry,
    done[0].toLowerCase()
  )
    ? registry[done[0].toLowerCase()]
    : undefined
  let used = 1
  while (command?.sub_commands && used < done.length) {
    const key = done[used].toLowerCase()
    command = Object.hasOwn(command.sub_commands, key)
      ? command.sub_commands[key]
      : undefined
    used++
  }
  if (!command) return result([])
  if (command.sub_commands) return result(describe(command.sub_commands))
  const arg = command.args?.[done.length - used]
  if (!arg) return result([])
  return result(
    arg.values ?? (arg.source ? (sources[arg.source] ?? []) : []),
    arg.descriprion || `<${arg.name}>`
  )
}

/** The input with the word under the caret replaced by `value`. */
export function applyCompletion(
  input: string,
  completion: Completion,
  value: string
) {
  return `${input.slice(0, completion.start)}${quoted(value)} `
}

/**
 * Text to show dimmed after the caret: the rest of the best candidate, or the
 * argument placeholder when a new word is starting. Empty when the candidate
 * cannot be shown as a plain continuation of what was typed.
 */
export function ghostText(input: string, completion: Completion) {
  const best = completion.candidates[0]
  if (!best) return !completion.partial && input ? completion.hint : ""
  if (!input) return ""
  const full = applyCompletion(input, completion, best.value).trimEnd()
  return full.toLowerCase().startsWith(input.toLowerCase())
    ? full.slice(input.length)
    : ""
}

/** Longest prefix shared by every candidate (case-insensitive), in the first candidate's casing. */
export function commonPrefix(candidates: Candidate[]) {
  if (!candidates.length) return ""
  let prefix = candidates[0].value
  for (const { value } of candidates) {
    let i = 0
    while (
      i < prefix.length &&
      i < value.length &&
      prefix[i].toLowerCase() === value[i].toLowerCase()
    )
      i++
    prefix = prefix.slice(0, i)
  }
  return prefix
}

export type TabResult = { input: string; index: number }
/**
 * One press of Tab. A single match is completed outright; several matches first
 * extend to their shared prefix, then cycle with repeated presses
 * (`index` is the candidate shown; pass it back in, with the completion the cycle started from).
 */
export function tabComplete(
  input: string,
  completion: Completion,
  cycle: number | null = null,
  backwards = false
): TabResult | null {
  const { candidates } = completion
  if (!candidates.length) return null
  if (candidates.length === 1)
    return { input: applyCompletion(input, completion, candidates[0].value), index: 0 }
  if (cycle === null) {
    const prefix = commonPrefix(candidates)
    if (prefix.length > completion.partial.length && !/\s/.test(prefix))
      return { input: input.slice(0, completion.start) + prefix, index: -1 }
  }
  const count = candidates.length
  const index =
    cycle === null || cycle < 0
      ? backwards
        ? count - 1
        : 0
      : (cycle + (backwards ? -1 : 1) + count) % count
  return {
    input: applyCompletion(input, completion, candidates[index].value).trimEnd(),
    index,
  }
}
