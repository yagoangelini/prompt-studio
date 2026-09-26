// History of the "Testes" panel (table test_runs, created in electron/database/init.ts)
import type { Database } from 'sqlite3'
import type { ApiProvider, ApiTestResponse, TestRun, TestRunSource } from '../../src/types'
import type { PreparedApiTest } from '../api-test'

// Newest runs kept; older ones are removed after each insert
export const TEST_RUNS_KEEP = 500
export const TEST_RUNS_DEFAULT_LIMIT = 200
// Text saved in `error` for a run canceled by the user (the UI shows it as "Cancelado")
export const CANCELED_RUN_ERROR = 'Teste cancelado'

const run = (db: Database, sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (this: { lastID: number; changes: number }, err: Error | null) {
      if (err) reject(err)
      else resolve({ lastID: this.lastID, changes: this.changes })
    })
  })

const all = <T>(db: Database, sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))

export interface NewTestRun {
  readonly promptId: number | null
  readonly promptText: string
  readonly provider: ApiProvider
  readonly model: string
  readonly endpoint: string
  readonly temperature: number | null
  readonly maxTokens: number | null
  readonly response: string | null
  readonly error: string | null
  readonly responseTimeMs: number | null
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly source: TestRunSource
}

const positiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

// What gets saved for one executed test: the values actually sent (never the API key) and the outcome
export const buildTestRun = (
  test: PreparedApiTest,
  response: ApiTestResponse,
  promptId: unknown,
  source: TestRunSource = 'test'
): NewTestRun => {
  const error = response.success
    ? null
    : response.canceled
      ? CANCELED_RUN_ERROR
      : [response.error || 'Falha no teste', response.errorDetail].filter(Boolean).join(': ')
  return {
    promptId: positiveInteger(promptId),
    promptText: test.prompt,
    provider: test.provider,
    model: test.model,
    endpoint: test.endpoint.toString(),
    temperature: test.temperature,
    maxTokens: test.maxTokens,
    response: response.success ? response.response ?? '' : null,
    error,
    responseTimeMs: finiteOrNull(response.responseTime),
    inputTokens: finiteOrNull(response.usage?.prompt_tokens),
    outputTokens: finiteOrNull(response.usage?.completion_tokens),
    source,
  }
}

export const insertTestRun = async (db: Database, testRun: NewTestRun): Promise<number> => {
  // A prompt id that no longer exists is saved as null (the FOREIGN KEY would refuse it)
  const { lastID } = await run(
    db,
    `INSERT INTO test_runs (prompt_id, prompt_text, provider, model, endpoint, temperature, max_tokens,
                            response, error, response_time_ms, input_tokens, output_tokens, source)
     VALUES ((SELECT id FROM prompts WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      testRun.promptId, testRun.promptText, testRun.provider, testRun.model, testRun.endpoint, testRun.temperature,
      testRun.maxTokens, testRun.response, testRun.error, testRun.responseTimeMs, testRun.inputTokens, testRun.outputTokens,
      testRun.source === 'compare' ? 'compare' : 'test',
    ]
  )
  await run(db, 'DELETE FROM test_runs WHERE id NOT IN (SELECT id FROM test_runs ORDER BY id DESC LIMIT ?)', [TEST_RUNS_KEEP])
  return lastID
}

const toTestRun = (row: Record<string, unknown>): TestRun => ({
  id: Number(row.id),
  prompt_id: positiveInteger(row.prompt_id),
  prompt_text: String(row.prompt_text ?? ''),
  provider: row.provider === 'anthropic' ? 'anthropic' : 'openai',
  model: String(row.model ?? ''),
  endpoint: String(row.endpoint ?? ''),
  temperature: finiteOrNull(row.temperature),
  max_tokens: finiteOrNull(row.max_tokens),
  response: typeof row.response === 'string' ? row.response : null,
  error: typeof row.error === 'string' ? row.error : null,
  response_time_ms: finiteOrNull(row.response_time_ms),
  input_tokens: finiteOrNull(row.input_tokens),
  output_tokens: finiteOrNull(row.output_tokens),
  source: row.source === 'compare' ? 'compare' : 'test',
  created_at: String(row.created_at ?? ''),
})

// Newest first
export const listTestRuns = async (db: Database, options?: unknown): Promise<TestRun[]> => {
  const record = options && typeof options === 'object' ? (options as Record<string, unknown>) : {}
  const requestedLimit = positiveInteger(record.limit)
  const limit = Math.min(requestedLimit ?? TEST_RUNS_DEFAULT_LIMIT, TEST_RUNS_KEEP)
  const promptId = positiveInteger(record.promptId)
  const rows = promptId === null
    ? await all<Record<string, unknown>>(db, 'SELECT * FROM test_runs ORDER BY id DESC LIMIT ?', [limit])
    : await all<Record<string, unknown>>(db, 'SELECT * FROM test_runs WHERE prompt_id = ? ORDER BY id DESC LIMIT ?', [promptId, limit])
  return rows.map(toTestRun)
}

export const deleteTestRun = async (db: Database, id: unknown): Promise<{ success: boolean }> => {
  const runId = positiveInteger(id)
  if (runId === null) return { success: false }
  const { changes } = await run(db, 'DELETE FROM test_runs WHERE id = ?', [runId])
  return { success: changes > 0 }
}

export const clearTestRuns = async (db: Database): Promise<{ success: boolean; deleted: number }> => {
  const { changes } = await run(db, 'DELETE FROM test_runs')
  return { success: true, deleted: changes }
}
