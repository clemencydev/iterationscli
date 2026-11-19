import test from "node:test"
import assert from "node:assert/strict"
import {
  clock,
  cutRanges,
  describeAnnotation,
  editsCsv,
  editsEdl,
  editsSrt,
  keptSegments,
  marksCsv,
  parseClock,
  recordRanges,
  srtTime,
  tidyEdits,
  timecode,
  toRecord,
} from "../lib/annotations.ts"

const cut = (start, end) => ({ id: `c${start}`, kind: "cut", start, end })
const split = (at) => ({ id: `s${at}`, kind: "split", at })
const text = (start, end, value) => ({
  id: `t${start}`,
  kind: "text",
  start,
  end,
  text: value,
  x: 0.5,
  y: 0.85,
})

test("times read and print the way people write them", () => {
  assert.equal(clock(65.34), "1:05.3")
  assert.equal(clock(3725), "1:02:05.0")
  assert.equal(parseClock("1:05.3"), 65.3)
  assert.equal(parseClock("65.3"), 65.3)
  assert.equal(parseClock("1:02:05"), 3725)
  assert.equal(parseClock("soon"), undefined)
  assert.equal(timecode(0), "00:00:00:00")
  assert.equal(timecode(61.5, 30), "00:01:01:15")
  assert.equal(timecode(2, 24, 1), "01:00:02:00")
  assert.equal(srtTime(3661.25), "01:01:01,250")
})

test("edits are tidied: clamped to the clip, the right way round, in order", () => {
  const tidy = tidyEdits([cut(8, 4), split(0), split(20), split(3), cut(9, 30)], 10)
  assert.deepEqual(
    tidy.map((e) => (e.kind === "split" ? [e.kind, e.at] : [e.kind, e.start, e.end])),
    [
      ["split", 3],
      ["cut", 4, 8],
      ["cut", 9, 10],
    ]
  )
})

test("what is kept is everything outside the cuts, broken at each split", () => {
  assert.deepEqual(keptSegments([], 10), [{ start: 0, end: 10 }])
  assert.deepEqual(keptSegments([cut(2, 4), cut(3, 5)], 10), [
    { start: 0, end: 2 },
    { start: 5, end: 10 },
  ])
  assert.deepEqual(cutRanges([cut(2, 4), cut(3, 5)], 10), [{ start: 2, end: 5 }])
  assert.deepEqual(keptSegments([cut(2, 4), split(7), split(3)], 10), [
    { start: 0, end: 2 },
    { start: 4, end: 7 },
    { start: 7, end: 10 },
  ])
  assert.deepEqual(keptSegments([cut(0, 10)], 10), [])
})

test("source times map onto the edited clip", () => {
  const segments = keptSegments([cut(2, 4)], 10)
  assert.equal(toRecord(1, segments), 1)
  assert.equal(toRecord(3, segments), null)
  assert.equal(toRecord(6, segments), 4)
  // Text that runs across cuts or a split is still one caption: what is left
  // of it plays back to back once the cuts are made.
  assert.deepEqual(recordRanges({ start: 1, end: 5 }, segments), [{ start: 1, end: 3 }])
  assert.deepEqual(
    recordRanges({ start: 1, end: 5 }, keptSegments([cut(2, 3), cut(3.5, 4)], 10)),
    [{ start: 1, end: 3.5 }]
  )
  assert.deepEqual(recordRanges({ start: 2.2, end: 3.8 }, segments), [])
  assert.deepEqual(recordRanges({ start: 1, end: 5 }, keptSegments([split(3)], 10)), [
    { start: 1, end: 5 },
  ])
})

test("the CSV lists the clips to keep, then every change, with timecodes", () => {
  const csv = editsCsv({
    name: 'my "best" clip.mp4',
    duration: 10,
    fps: 30,
    edits: [cut(2, 4), split(7), text(5, 6, "Hello, world")],
    marks: [{ id: "m", at: 8.5, text: "Tighten this" }],
  })
  const rows = csv.trim().split("\r\n")
  assert.equal(
    rows[0],
    "type,source_in,source_out,record_in,record_out,source_in_seconds,source_out_seconds,text,x_percent,y_percent,file,fps"
  )
  assert.deepEqual(
    rows.slice(1).map((row) => row.split(",")[0]),
    ["clip", "clip", "clip", "cut", "text", "split", "comment"]
  )
  // The second clip starts at 4s in the source and at 2s once the cut is made.
  assert.match(rows[2], /^clip,00:00:04:00,00:00:07:00,00:00:02:00,00:00:05:00,4,7,/)
  assert.match(rows[4], /^cut,00:00:02:00,00:00:04:00,,,2,4,/)
  assert.match(rows[5], /^text,00:00:05:00,00:00:06:00,00:00:03:00,00:00:04:00,5,6,"Hello, world",50,85,/)
  assert.match(rows[7], /^comment,.*,Tighten this,/)
  assert.ok(rows[1].includes('"my ""best"" clip.mp4"'))
})

test("the EDL is one event per kept clip on a timeline starting at 01:00:00:00", () => {
  const edl = editsEdl({ name: "teaser.mp4", duration: 10, fps: 24, edits: [cut(2, 4)] })
  const lines = edl.split("\r\n")
  assert.equal(lines[0], "TITLE: teaser")
  assert.equal(lines[1], "FCM: NON-DROP FRAME")
  assert.equal(lines[3], "001 AX       V     C        00:00:00:00 00:00:02:00 01:00:00:00 01:00:02:00")
  assert.equal(lines[4], "* FROM CLIP NAME: teaser.mp4")
  assert.equal(lines[6], "002 AX       V     C        00:00:04:00 00:00:10:00 01:00:02:00 01:00:08:00")
})

test("the SRT times on-screen text against the edited clip", () => {
  const srt = editsSrt({
    name: "teaser.mp4",
    duration: 10,
    edits: [cut(2, 4), text(5, 6, "Second"), text(0.5, 1.5, "First"), text(2.5, 3, "Gone")],
  })
  assert.equal(
    srt,
    "1\r\n00:00:00,500 --> 00:00:01,500\r\nFirst\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nSecond\r\n"
  )
  assert.equal(editsSrt({ name: "x", duration: 10, edits: [] }), "")
})

test("audio comments export in order, and annotations describe themselves", () => {
  const csv = marksCsv("take.mp3", [
    { id: "b", at: 61, text: "Chorus, louder" },
    { id: "a", at: 3.2, text: "Count-in" },
  ])
  assert.equal(
    csv,
    'time,seconds,comment,file\r\n0:03.2,3.2,Count-in,take.mp3\r\n1:01.0,61,"Chorus, louder",take.mp3\r\n'
  )
  assert.equal(
    describeAnnotation({
      shapes: [{}, {}],
      pins: [{}],
      notes: ["x"],
      edits: [cut(1, 2)],
    }),
    "2 drawings · 1 edit · 2 comments"
  )
  assert.equal(describeAnnotation(undefined), "")
})
