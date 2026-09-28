/** `undefined` while still running (elapsed-so-far isn't "the duration" yet — would confuse an
 *  in-progress run's growing number with a settled one). Raw unit letters, not translated,
 *  matches StatsPane's existing duration formatting. */
export function formatRunDuration(
  startedAt: string | undefined,
  finishedAt: string | undefined
): string | undefined {
  if (!startedAt || !finishedAt) {
    return undefined
  }
  const start = new Date(startedAt).getTime()
  const end = new Date(finishedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return undefined
  }
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `${seconds}s`
  }
  const hours = Math.floor(minutes / 60)
  if (hours === 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${hours}h ${minutes % 60}m`
}
