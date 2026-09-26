// Line diff: the longest common subsequence of lines, found with Myers' O(ND) algorithm in its
// linear-space form (bisection on the "middle snake", as in diff-match-patch). Lines are mapped to
// integers first, so comparing two lines is an integer comparison. Cost grows with the size of the
// change, not with the size of the texts: two versions of 5,000 lines with a few edits take a few
// milliseconds. A time budget protects the UI from pathological inputs.

export type DiffLineType = 'equal' | 'added' | 'removed'

export interface DiffLine {
  readonly type: DiffLineType
  readonly text: string
  // 1-based line numbers: in the old text (equal/removed) and in the new text (equal/added)
  readonly oldNumber: number | null
  readonly newNumber: number | null
}

export interface LineDiff {
  readonly lines: DiffLine[]
  readonly added: number
  readonly removed: number
  // True when the time budget ran out: the unresolved part is shown as fully replaced, which is still
  // a correct diff, only not the smallest one
  readonly approximate: boolean
}

export interface DiffOptions {
  // Time budget in milliseconds (default 1500)
  readonly timeoutMs?: number
}

export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/\r\n|\r|\n/)
}

const EQUAL = 0
const REMOVED = 1
const ADDED = 2
type Op = typeof EQUAL | typeof REMOVED | typeof ADDED

// Runs of the same operation, in order
interface Script {
  ops: Op[]
  counts: number[]
}

interface Budget {
  readonly deadline: number
  timedOut: boolean
}

const push = (script: Script, op: Op, count: number) => {
  if (count <= 0) return
  const last = script.ops.length - 1
  if (last >= 0 && script.ops[last] === op) {
    script.counts[last] = (script.counts[last] ?? 0) + count
  } else {
    script.ops.push(op)
    script.counts.push(count)
  }
}

// Typed array read (in range by construction; the fallback only satisfies noUncheckedIndexedAccess)
const at = (array: Int32Array, index: number): number => array[index] ?? -1

// Finds the middle snake of a[a0..a1) × b[b0..b1) and returns the split point, or null when the budget
// ran out (or, in theory, when there is nothing in common)
function bisect(
  a: Int32Array, a0: number, a1: number,
  b: Int32Array, b0: number, b1: number,
  budget: Budget
): { x: number; y: number } | null {
  const n = a1 - a0
  const m = b1 - b0
  const maxD = Math.ceil((n + m) / 2)
  const vOffset = maxD
  const vLength = 2 * maxD
  const v1 = new Int32Array(vLength + 2).fill(-1)
  const v2 = new Int32Array(vLength + 2).fill(-1)
  v1[vOffset + 1] = 0
  v2[vOffset + 1] = 0
  const delta = n - m
  // With an odd delta the forward path meets the reverse one; with an even delta, the other way round
  const front = delta % 2 !== 0
  let k1start = 0
  let k1end = 0
  let k2start = 0
  let k2end = 0

  for (let d = 0; d < maxD; d++) {
    if (Date.now() > budget.deadline) {
      budget.timedOut = true
      return null
    }

    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1
      let x1 = k1 === -d || (k1 !== d && at(v1, k1Offset - 1) < at(v1, k1Offset + 1))
        ? at(v1, k1Offset + 1)
        : at(v1, k1Offset - 1) + 1
      let y1 = x1 - k1
      while (x1 < n && y1 < m && a[a0 + x1] === b[b0 + y1]) {
        x1++
        y1++
      }
      v1[k1Offset] = x1
      if (x1 > n) {
        k1end += 2
      } else if (y1 > m) {
        k1start += 2
      } else if (front) {
        const k2Offset = vOffset + delta - k1
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          if (x1 >= n - at(v2, k2Offset)) return { x: a0 + x1, y: b0 + y1 }
        }
      }
    }

    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2
      let x2 = k2 === -d || (k2 !== d && at(v2, k2Offset - 1) < at(v2, k2Offset + 1))
        ? at(v2, k2Offset + 1)
        : at(v2, k2Offset - 1) + 1
      let y2 = x2 - k2
      while (x2 < n && y2 < m && a[a1 - x2 - 1] === b[b1 - y2 - 1]) {
        x2++
        y2++
      }
      v2[k2Offset] = x2
      if (x2 > n) {
        k2end += 2
      } else if (y2 > m) {
        k2start += 2
      } else if (!front) {
        const k1Offset = vOffset + delta - k2
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = at(v1, k1Offset)
          const y1 = vOffset + x1 - k1Offset
          if (x1 >= n - x2) return { x: a0 + x1, y: b0 + y1 }
        }
      }
    }
  }
  return null
}

function diffRange(
  a: Int32Array, a0: number, a1: number,
  b: Int32Array, b0: number, b1: number,
  script: Script,
  budget: Budget
): void {
  let prefix = 0
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) {
    a0++
    b0++
    prefix++
  }
  let suffix = 0
  while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) {
    a1--
    b1--
    suffix++
  }
  push(script, EQUAL, prefix)

  if (a0 === a1) {
    push(script, ADDED, b1 - b0)
  } else if (b0 === b1) {
    push(script, REMOVED, a1 - a0)
  } else {
    const split = budget.timedOut ? null : bisect(a, a0, a1, b, b0, b1, budget)
    if (split) {
      diffRange(a, a0, split.x, b, b0, split.y, script, budget)
      diffRange(a, split.x, a1, b, split.y, b1, script, budget)
    } else {
      push(script, REMOVED, a1 - a0)
      push(script, ADDED, b1 - b0)
    }
  }

  push(script, EQUAL, suffix)
}

export function diffLines(oldText: string, newText: string, options: DiffOptions = {}): LineDiff {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)

  // Same text -> same integer
  const ids = new Map<string, number>()
  const encode = (lines: readonly string[]) => {
    const encoded = new Int32Array(lines.length)
    lines.forEach((line, index) => {
      let id = ids.get(line)
      if (id === undefined) {
        id = ids.size
        ids.set(line, id)
      }
      encoded[index] = id
    })
    return encoded
  }
  const a = encode(oldLines)
  const b = encode(newLines)

  const budget: Budget = { deadline: Date.now() + (options.timeoutMs ?? 1500), timedOut: false }
  const script: Script = { ops: [], counts: [] }
  // Texts without a single line in common (a full rewrite): nothing to search for
  const inOld = new Uint8Array(ids.size)
  a.forEach((id) => { inOld[id] = 1 })
  if (b.some((id) => inOld[id] === 1)) {
    diffRange(a, 0, a.length, b, 0, b.length, script, budget)
  } else {
    push(script, REMOVED, a.length)
    push(script, ADDED, b.length)
  }

  const lines: DiffLine[] = []
  let oldIndex = 0
  let newIndex = 0
  let added = 0
  let removed = 0
  script.ops.forEach((op, runIndex) => {
    const count = script.counts[runIndex] ?? 0
    for (let i = 0; i < count; i++) {
      if (op === EQUAL) {
        lines.push({ type: 'equal', text: oldLines[oldIndex] ?? '', oldNumber: oldIndex + 1, newNumber: newIndex + 1 })
        oldIndex++
        newIndex++
      } else if (op === REMOVED) {
        lines.push({ type: 'removed', text: oldLines[oldIndex] ?? '', oldNumber: oldIndex + 1, newNumber: null })
        oldIndex++
        removed++
      } else {
        lines.push({ type: 'added', text: newLines[newIndex] ?? '', oldNumber: null, newNumber: newIndex + 1 })
        newIndex++
        added++
      }
    }
  })

  return { lines, added, removed, approximate: budget.timedOut }
}

export type DiffViewItem =
  | { readonly kind: 'line'; readonly line: DiffLine }
  // Unchanged lines hidden between changes (the UI can expand them)
  | { readonly kind: 'hidden'; readonly id: number; readonly lines: readonly DiffLine[] }

// Keeps `context` unchanged lines around each change and folds longer unchanged stretches.
// Stretches shorter than `minHidden` stay visible (folding 1 or 2 lines is not worth a click).
export function foldUnchangedLines(lines: readonly DiffLine[], context = 3, minHidden = 4): DiffViewItem[] {
  const items: DiffViewItem[] = []
  const pushLines = (from: number, to: number) => {
    lines.slice(from, to).forEach((line) => items.push({ kind: 'line', line }))
  }
  let index = 0
  let hiddenId = 0
  while (index < lines.length) {
    if (lines[index]?.type !== 'equal') {
      pushLines(index, index + 1)
      index++
      continue
    }
    let end = index
    while (end < lines.length && lines[end]?.type === 'equal') end++
    const keepBefore = index === 0 ? 0 : context
    const keepAfter = end === lines.length ? 0 : context
    const hiddenCount = end - index - keepBefore - keepAfter
    if (hiddenCount < minHidden) {
      pushLines(index, end)
    } else {
      pushLines(index, index + keepBefore)
      items.push({ kind: 'hidden', id: hiddenId++, lines: lines.slice(index + keepBefore, end - keepAfter) })
      pushLines(end - keepAfter, end)
    }
    index = end
  }
  return items
}
