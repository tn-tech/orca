function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Dot-path lookup shared by condition evaluation and brief reference resolution. */
export function getResultPath(value: unknown, path: string): unknown {
  if (path === '') {
    return value
  }
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined
    }
    return Object.hasOwn(current, segment) ? current[segment] : undefined
  }, value)
}
