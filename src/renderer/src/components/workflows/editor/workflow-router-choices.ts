/**
 * A `Handle` id must be unique within a React Flow node and, for a Router choice, equal to the
 * `Edge.fromPort` it routes (data-model.md §1 RouterNode). Two unedited "Add choice" rows are
 * both `''`, and a user can retype a choice to match another — `RouterNode.tsx` and
 * `RouterNodeFields.tsx` both need to know which choices collide, so that logic lives here once.
 */

/** The index of each choice that gets its own port on the canvas: the first occurrence of each
 *  non-empty text. A later row with the same (or blank) text renders no `Handle` of its own —
 *  duplicating a `Handle` id breaks which edge Handle React Flow resolves it to. */
export function routableChoiceIndices(choices: readonly string[]): ReadonlySet<number> {
  const seen = new Set<string>()
  const indices = new Set<number>()
  choices.forEach((choice, index) => {
    if (choice === '' || seen.has(choice)) {
      return
    }
    seen.add(choice)
    indices.add(index)
  })
  return indices
}

/** Every index whose text is blank, or repeats another choice's text — flagged in
 *  `RouterNodeFields` so the user fixes the collision before it silently drops a port. */
export function invalidChoiceIndices(choices: readonly string[]): ReadonlySet<number> {
  const counts = new Map<string, number[]>()
  choices.forEach((choice, index) => {
    if (choice === '') {
      return
    }
    const indices = counts.get(choice) ?? []
    indices.push(index)
    counts.set(choice, indices)
  })
  const invalid = new Set<number>()
  choices.forEach((choice, index) => {
    if (choice === '') {
      invalid.add(index)
    }
  })
  for (const indices of counts.values()) {
    if (indices.length > 1) {
      indices.forEach((index) => invalid.add(index))
    }
  }
  return invalid
}

/** Names reserved for Loop ports (`Edge.fromPort` 'body' | 'exit', data-model.md §1 Edge). A
 *  Router choice or Approval option with one of these names passes the blank/duplicate check
 *  above but is still rejected by graph validation (`graph_option_reserved_name`,
 *  workflow-graph-structural-rules.ts) — flagged separately here so a field can point it out
 *  inline before the user ever runs validation. */
const RESERVED_PORT_NAMES: ReadonlySet<string> = new Set(['exit', 'body'])

export function reservedChoiceIndices(choices: readonly string[]): ReadonlySet<number> {
  const indices = new Set<number>()
  choices.forEach((choice, index) => {
    if (RESERVED_PORT_NAMES.has(choice)) {
      indices.add(index)
    }
  })
  return indices
}
