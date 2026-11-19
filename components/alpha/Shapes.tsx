"use client"

// Draws an image annotation (lib/annotations.ts) two ways: as an SVG layer
// over the picture, and flattened into a PNG for download.
import type { CSSProperties, ReactNode } from "react"
import type { Pin, Point, Shape } from "@/lib/annotations"
import { fileKind, type FileEntry } from "@/lib/files"
import { useBlobUrl } from "@/lib/file-store"
import styles from "./files.module.css"

/** Shapes are drawn on a canvas 1000 units wide, whatever the picture's size. */
const UNIT = 1000
const PIN_RADIUS = 15
const PIN_COLOR = "#f59e0b"

const arrowHead = (from: [number, number], to: [number, number], size: number) => {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  const wing = (turn: number): [number, number] => [
    to[0] - size * Math.cos(angle + turn),
    to[1] - size * Math.sin(angle + turn),
  ]
  return [wing(0.45), to, wing(-0.45)]
}

export function ShapeLayer({
  shapes = [],
  pins = [],
  aspect,
  draft,
  onShape,
  onPin,
  activePin,
  image,
  fit,
  children,
  className,
  style,
}: {
  shapes?: Shape[]
  pins?: Pin[]
  /** Height of the picture divided by its width. */
  aspect: number
  /** A shape still being drawn. */
  draft?: Shape | null
  /** Makes shapes clickable (the eraser). */
  onShape?: (id: string) => void
  onPin?: (id: string) => void
  activePin?: string | null
  /** The picture itself, drawn under the shapes. */
  image?: string
  /** Keep the picture's proportions inside whatever box the layer is given. */
  fit?: boolean
  children?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const height = UNIT * aspect
  const at = ([x, y]: Point): [number, number] => [x * UNIT, y * height]
  const draw = (shape: Shape) => {
    const hit = onShape
      ? {
          onPointerDown: (event: { stopPropagation: () => void }) => {
            event.stopPropagation()
            onShape(shape.id)
          },
          style: { cursor: "pointer", pointerEvents: "stroke" } as CSSProperties,
        }
      : { style: { pointerEvents: "none" } as CSSProperties }
    const stroke = {
      fill: "none",
      stroke: shape.color,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
    }
    if (shape.kind === "pen")
      return (
        <polyline
          key={shape.id}
          points={shape.points.map((p) => at(p).join(",")).join(" ")}
          strokeWidth={shape.width}
          {...stroke}
          {...hit}
        />
      )
    if (shape.kind === "text") {
      const [x, y] = at(shape.at)
      return (
        <text
          key={shape.id}
          x={x}
          y={y}
          fill={shape.color}
          fontSize={shape.size}
          fontWeight={600}
          dominantBaseline="hanging"
          paintOrder="stroke"
          stroke="#00000099"
          strokeWidth={shape.size / 9}
          {...(onShape
            ? {
                onPointerDown: hit.onPointerDown,
                style: { cursor: "pointer" },
              }
            : { style: { pointerEvents: "none" } })}
        >
          {shape.text}
        </text>
      )
    }
    const [x1, y1] = at(shape.from)
    const [x2, y2] = at(shape.to)
    if (shape.kind === "rect")
      return (
        <rect
          key={shape.id}
          x={Math.min(x1, x2)}
          y={Math.min(y1, y2)}
          width={Math.abs(x2 - x1)}
          height={Math.abs(y2 - y1)}
          strokeWidth={shape.width}
          {...stroke}
          {...hit}
        />
      )
    if (shape.kind === "ellipse")
      return (
        <ellipse
          key={shape.id}
          cx={(x1 + x2) / 2}
          cy={(y1 + y2) / 2}
          rx={Math.abs(x2 - x1) / 2}
          ry={Math.abs(y2 - y1) / 2}
          strokeWidth={shape.width}
          {...stroke}
          {...hit}
        />
      )
    return (
      <g key={shape.id} {...hit}>
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          strokeWidth={shape.width}
          {...stroke}
        />
        {shape.kind === "arrow" && (
          <polyline
            points={arrowHead([x1, y1], [x2, y2], 10 + shape.width * 3)
              .map((p) => p.join(","))
              .join(" ")}
            strokeWidth={shape.width}
            {...stroke}
          />
        )}
      </g>
    )
  }
  return (
    <svg
      className={className}
      style={style}
      viewBox={`0 0 ${UNIT} ${height}`}
      preserveAspectRatio={fit ? "xMidYMid meet" : "none"}
    >
      {image && (
        <image
          href={image}
          width={UNIT}
          height={height}
          preserveAspectRatio="none"
        />
      )}
      {shapes.map(draw)}
      {draft && draw(draft)}
      {pins.map((pin, i) => {
        const [x, y] = at(pin.at)
        return (
          <g
            key={pin.id}
            style={{ cursor: onPin ? "pointer" : undefined }}
            onPointerDown={
              onPin
                ? (event) => {
                    event.stopPropagation()
                    onPin(pin.id)
                  }
                : undefined
            }
          >
            <circle
              cx={x}
              cy={y}
              r={PIN_RADIUS}
              fill={PIN_COLOR}
              stroke={activePin === pin.id ? "#ffffff" : "#00000088"}
              strokeWidth={activePin === pin.id ? 4 : 2}
            />
            <text
              x={x}
              y={y}
              fill="#000000"
              fontSize={17}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ pointerEvents: "none" }}
            >
              {i + 1}
            </text>
          </g>
        )
      })}
      {children}
    </svg>
  )
}

/** The picture with its annotation drawn in, as a PNG at the picture's own size. */
export async function flattenImage(
  url: string,
  shapes: Shape[] = [],
  pins: Pin[] = []
): Promise<Blob> {
  const image = new Image()
  image.src = url
  await image.decode()
  const width = image.naturalWidth || 1200
  const height = image.naturalHeight || 800
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const c = canvas.getContext("2d")
  if (!c) throw new Error("This browser cannot draw the picture.")
  c.drawImage(image, 0, 0, width, height)
  const k = width / UNIT
  const at = ([x, y]: Point): [number, number] => [x * width, y * height]
  c.lineCap = "round"
  c.lineJoin = "round"
  for (const shape of shapes) {
    c.strokeStyle = shape.color
    c.fillStyle = shape.color
    if (shape.kind === "text") {
      const [x, y] = at(shape.at)
      c.font = `600 ${shape.size * k}px ui-monospace, monospace`
      c.textBaseline = "top"
      c.lineWidth = (shape.size * k) / 9
      c.strokeStyle = "#00000099"
      c.strokeText(shape.text, x, y)
      c.fillText(shape.text, x, y)
      continue
    }
    c.lineWidth = shape.width * k
    c.beginPath()
    if (shape.kind === "pen") {
      shape.points.forEach((p, i) => {
        const [x, y] = at(p)
        if (i) c.lineTo(x, y)
        else c.moveTo(x, y)
      })
    } else {
      const [x1, y1] = at(shape.from)
      const [x2, y2] = at(shape.to)
      if (shape.kind === "rect") c.rect(x1, y1, x2 - x1, y2 - y1)
      else if (shape.kind === "ellipse")
        c.ellipse(
          (x1 + x2) / 2,
          (y1 + y2) / 2,
          Math.abs(x2 - x1) / 2,
          Math.abs(y2 - y1) / 2,
          0,
          0,
          Math.PI * 2
        )
      else {
        c.moveTo(x1, y1)
        c.lineTo(x2, y2)
        if (shape.kind === "arrow") {
          const [a, tip, b] = arrowHead(
            [x1, y1],
            [x2, y2],
            (10 + shape.width * 3) * k
          )
          c.moveTo(a[0], a[1])
          c.lineTo(tip[0], tip[1])
          c.lineTo(b[0], b[1])
        }
      }
    }
    c.stroke()
  }
  pins.forEach((pin, i) => {
    const [x, y] = at(pin.at)
    c.beginPath()
    c.arc(x, y, PIN_RADIUS * k, 0, Math.PI * 2)
    c.fillStyle = PIN_COLOR
    c.fill()
    c.lineWidth = 2 * k
    c.strokeStyle = "#00000088"
    c.stroke()
    c.fillStyle = "#000000"
    c.font = `700 ${17 * k}px ui-monospace, monospace`
    c.textAlign = "center"
    c.textBaseline = "middle"
    c.fillText(String(i + 1), x, y)
    c.textAlign = "start"
  })
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The picture could not be saved.")),
      "image/png"
    )
  )
}

export const KIND_GLYPH: Record<ReturnType<typeof fileKind>, string> = {
  image: "▣",
  video: "▶",
  audio: "♪",
  text: "≡",
  pdf: "▤",
  other: "◇",
}

/**
 * A small picture of a file: the image itself with its annotation drawn over
 * it, or a glyph for everything else.
 */
export function FileThumb({
  file,
  className = "",
}: {
  file: FileEntry
  className?: string
}) {
  const kind = fileKind(file.mime, file.name)
  const url = useBlobUrl(kind === "image" ? file.blob : undefined)
  if (kind === "image" && url)
    return (
      <span className={`${styles.thumb} ${className}`}>
        {file.width && file.height ? (
          <ShapeLayer
            image={url}
            fit
            shapes={file.annotation?.shapes}
            pins={file.annotation?.pins}
            aspect={file.height / file.width}
          />
        ) : (
          // A blob URL from this device's file store, not a remote image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" draggable={false} />
        )}
      </span>
    )
  return (
    <span
      className={`${styles.thumb} ${styles.glyph} ${className}`}
      data-kind={kind}
      aria-hidden="true"
    >
      {KIND_GLYPH[kind]}
    </span>
  )
}
