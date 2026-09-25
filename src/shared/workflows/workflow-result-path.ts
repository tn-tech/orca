/** Dot-path lookup shared by condition evaluation and brief reference resolution. */
export function getResultPath(value: unknown, path: string): unknown {
  if (path === '') {
    return value
  }
  return path.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }
    return Object.hasOwn(current, segment) ? Reflect.get(current, segment) : undefined
  }, value)
}
