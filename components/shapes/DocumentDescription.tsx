import { describeDocument } from "@/lib/document"

/** One-line summary shown under a document: length and reading time. */
export default function DocumentDescription({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const { words, characters, minutes } = describeDocument(text)
  return (
    <div className={className}>
      {words
        ? `${words} ${words === 1 ? "word" : "words"} · ${characters} ${characters === 1 ? "character" : "characters"} · ${minutes} min read`
        : "Empty document"}
    </div>
  )
}
