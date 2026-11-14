"use client"

import { useEffect, useRef, useState } from "react"
import {
  completionSeries,
  countTicks,
  dayTicks,
  RANGES,
  type Range,
} from "@/lib/stats"
import type { Task } from "@/lib/alpha"
import styles from "./workspace.module.css"

const HEIGHT = 240
const PAD = { top: 14, right: 16, bottom: 28, left: 36 }

/** Line chart of tasks completed per day over a selectable period. */
export default function TrendChart({ tasks }: { tasks: Task[] }) {
  const [range, setRange] = useState<Range>(30)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!frame.current) return
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(240, entries[0].contentRect.width))
    )
    observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])

  const series = completionSeries(tasks, range)
  const total = series.reduce((sum, d) => sum + d.count, 0)
  const peak = series.reduce((best, d) => (d.count > best.count ? d : best), series[0])
  const yTicks = countTicks(peak.count)
  const yMax = yTicks.at(-1)!
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (i / (series.length - 1)) * plotW
  const y = (value: number) => PAD.top + plotH * (1 - value / yMax)
  const line = series.map((d, i) => `${x(i)},${y(d.count)}`).join(" ")
  const xTicks = dayTicks(series.length, Math.floor(plotW / 70))
  const day = (iso: string, long = false) =>
    new Date(iso).toLocaleDateString(
      undefined,
      long
        ? { weekday: "short", month: "short", day: "numeric" }
        : range === 7
          ? { weekday: "short" }
          : { month: "short", day: "numeric" }
    )
  const active = hover !== null && hover < series.length ? hover : null
  const point = active !== null ? series[active] : null

  return (
    <div className={styles.panel}>
      <div className={styles.chartHead}>
        <div>
          <h2>Tasks completed per day</h2>
          <p className={styles.muted}>
            {total
              ? `${total} completed in the last ${range} days · busiest: ${day(peak.date, true)} (${peak.count})`
              : `Last ${range} days, by completion date.`}
          </p>
        </div>
        <div className={styles.segmented} role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button
              key={r}
              aria-pressed={range === r}
              onClick={() => {
                setRange(r)
                setHover(null)
              }}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>
      <div className={styles.trend} ref={frame}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          tabIndex={0}
          aria-label={`Line chart: tasks completed per day over the last ${range} days. ${total} in total. Use the arrow keys to read each day.`}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = (e.clientX - rect.left - PAD.left) / plotW
            setHover(
              Math.max(0, Math.min(series.length - 1, Math.round(ratio * (series.length - 1))))
            )
          }}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
            if (e.key === "Escape") setHover(null)
            if (!step) return
            e.preventDefault()
            setHover((i) =>
              Math.max(0, Math.min(series.length - 1, (i ?? series.length - 1 - step) + step))
            )
          }}
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                className={tick ? styles.trendGrid : styles.trendAxis}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className={styles.trendLabel} x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {tick}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text
              key={i}
              className={styles.trendLabel}
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor={i === series.length - 1 ? "end" : "middle"}
            >
              {day(series[i].date)}
            </text>
          ))}
          {total > 0 && (
            <>
              <polygon
                className={styles.trendArea}
                points={`${x(0)},${y(0)} ${line} ${x(series.length - 1)},${y(0)}`}
              />
              <polyline className={styles.trendLine} points={line} />
            </>
          )}
          {point && active !== null && (
            <>
              <line
                className={styles.trendCrosshair}
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={y(0)}
              />
              <circle className={styles.trendDot} cx={x(active)} cy={y(point.count)} r="5" />
            </>
          )}
        </svg>
        {!total && (
          <div className={styles.trendEmpty}>
            No tasks completed in the last {range} days.
            <span>Complete a task and it will be plotted here.</span>
          </div>
        )}
        {point && active !== null && (
          <div
            className={styles.trendTip}
            role="status"
            style={{
              top: Math.max(0, y(point.count) - 54),
              ...(x(active) > width / 2
                ? { right: width - x(active) + 10 }
                : { left: x(active) + 10 }),
            }}
          >
            <span>{day(point.date, true)}</span>
            <strong>{point.count}</strong> completed
          </div>
        )}
      </div>
      <table className={styles.srOnly}>
        <caption>Tasks completed per day, last {range} days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Completed</th>
          </tr>
        </thead>
        <tbody>
          {series.map((d) => (
            <tr key={d.date}>
              <th scope="row">{day(d.date, true)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
