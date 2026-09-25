import type { Condition } from './workflow-definition-types'
import { getResultPath } from './workflow-result-path'

/** Structural equality for JSON-shaped operands (Condition.value); not a general deep-equal. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    if (Array.isArray(a) || Array.isArray(b)) {
      return false
    }
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    return (
      aKeys.length === bKeys.length &&
      aKeys.every(
        (key) => Object.hasOwn(b, key) && deepEqual(Reflect.get(a, key), Reflect.get(b, key))
      )
    )
  }
  return false
}

function compareNumeric(
  resolved: unknown,
  target: unknown,
  compare: (a: number, b: number) => boolean
): boolean {
  return typeof resolved === 'number' && typeof target === 'number' && compare(resolved, target)
}

function evaluateLeaf(condition: Extract<Condition, { path: string }>, value: unknown): boolean {
  const resolved = getResultPath(value, condition.path)
  const target = condition.value
  switch (condition.op) {
    case 'eq':
      return deepEqual(resolved, target)
    case 'neq':
      return !deepEqual(resolved, target)
    case 'gt':
      return compareNumeric(resolved, target, (a, b) => a > b)
    case 'gte':
      return compareNumeric(resolved, target, (a, b) => a >= b)
    case 'lt':
      return compareNumeric(resolved, target, (a, b) => a < b)
    case 'lte':
      return compareNumeric(resolved, target, (a, b) => a <= b)
    case 'truthy':
      return Boolean(resolved)
    case 'falsy':
      return !resolved
    case 'contains':
      if (Array.isArray(resolved)) {
        return resolved.some((item) => deepEqual(item, target))
      }
      if (typeof resolved === 'string' && typeof target === 'string') {
        return resolved.includes(target)
      }
      return false
    case 'lengthGt':
      if (typeof target !== 'number') {
        return false
      }
      if (typeof resolved === 'string' || Array.isArray(resolved)) {
        return resolved.length > target
      }
      return false
  }
}

/** Evaluated only against the source node's structured result (FR-027); no expression language. */
export function evaluateCondition(condition: Condition, value: unknown): boolean {
  if ('all' in condition) {
    return condition.all.every((nested) => evaluateCondition(nested, value))
  }
  if ('any' in condition) {
    return condition.any.some((nested) => evaluateCondition(nested, value))
  }
  if ('not' in condition) {
    return !evaluateCondition(condition.not, value)
  }
  return evaluateLeaf(condition, value)
}
