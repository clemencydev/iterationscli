// Time series for the Statistics view. Pure, so it can be tested with a fixed "now".

export const RANGES = [7, 30, 90] as const
export type Range = (typeof RANGES)[number]
export type DayPoint = {
  /** Local midnight of the day, as an ISO string. */
  date: string
  /** Tasks completed on that day. */
  count: number
}

/** Completed tasks per local day for the last `days` days, oldest first, today last. */
export function completionSeries(
  tasks: { done: boolean; completed?: string }[],
  days: number,
  now = new Date()
): DayPoint[] {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (!task.done || !task.completed) continue
    const key = new Date(task.completed).toDateString()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - i))
    return { date: day.toISOString(), count: counts.get(day.toDateString()) ?? 0 }
  })
}

/** Whole-number axis ticks from 0 to a rounded maximum (at most five steps). */
export function countTicks(max: number): number[] {
  const top = Math.max(1, Math.ceil(max))
  const rough = top / 4
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find((s) => s >= rough) ?? Math.ceil(rough)
  const ticks: number[] = []
  for (let value = 0; value < top + step; value += step) {
    ticks.push(value)
    if (value >= top) break
  }
  return ticks
}

/** Indexes to label on the time axis: evenly spaced, always ending on today. */
export function dayTicks(length: number, maxLabels: number): number[] {
  if (length <= 0) return []
  const step = Math.max(1, Math.ceil(length / Math.max(2, maxLabels)))
  const ticks: number[] = []
  for (let i = length - 1; i >= 0; i -= step) ticks.unshift(i)
  return ticks
}
