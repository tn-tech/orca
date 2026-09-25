// Wraps z.fromJSONSchema (zod ~4.5, "semi-experimental" per its own docs) behind a tiny
// interface so the JSON Schema validator backing result.json checks is swappable (research.md).
import { z } from 'zod'
import type { ResultContract } from '../../../shared/workflows/workflow-definition-types'

export type ResultSchemaValidation = { ok: true; value: unknown } | { ok: false; issues: string[] }

export type ResultSchemaValidator = {
  validate(value: unknown): ResultSchemaValidation
}

export function createResultSchemaValidator(contract: ResultContract): ResultSchemaValidator {
  const schema = z.fromJSONSchema(contract)
  return {
    validate(value) {
      const parsed = schema.safeParse(value)
      if (parsed.success) {
        return { ok: true, value: parsed.data }
      }
      return { ok: false, issues: parsed.error.issues.map((issue) => issue.message) }
    }
  }
}
