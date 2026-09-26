import { useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeftRight, Clock, GitCompare, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseDbDate } from '@/lib/utils'
import { VersionDiff } from './version-diff'
import type { Prompt, PromptVersion } from '@/types'

interface PromptVersionHistoryProps {
  prompt: Prompt
  // Newest first; null while loading
  versions: readonly PromptVersion[] | null
  error: string | null
  // Text currently in the editor (may have unsaved changes)
  currentContent: string
  onRestore: (version: PromptVersion) => void
}

// Value of the "text in the editor" option in the comparison selects
export const EDITOR_TEXT = 'editor'
const EDITOR_TEXT_LABEL = 'Texto no editor'

const versionValue = (version: PromptVersion) => `version-${version.id}`

const formatRelative = (dateString: string) => {
  try {
    return formatDistanceToNow(parseDbDate(dateString), { addSuffix: true, locale: ptBR })
  } catch {
    return 'data desconhecida'
  }
}

export function PromptVersionHistory({ prompt, versions, error, currentContent, onRestore }: PromptVersionHistoryProps) {
  // null = default choice: the version before the last one (or the only one) against the editor text
  const [compareFrom, setCompareFrom] = useState<string | null>(null)
  const [compareTo, setCompareTo] = useState<string>(EDITOR_TEXT)
  const compareRef = useRef<HTMLDivElement>(null)

  const latestVersionNumber = versions?.[0]?.version_number
  const versionLabel = (version: PromptVersion) =>
    `Versão ${version.version_number}${version.version_number === latestVersionNumber ? ' (atual)' : ''}`

  const options = [
    { value: EDITOR_TEXT, label: EDITOR_TEXT_LABEL, content: currentContent },
    ...(versions ?? []).map((version) => ({ value: versionValue(version), label: versionLabel(version), content: version.content }))
  ]
  const findOption = (value: string | null) => options.find((option) => option.value === value)

  const defaultVersion = versions && versions.length > 0 ? versions[1] ?? versions[0] : undefined
  const from = findOption(compareFrom) ?? (defaultVersion ? findOption(versionValue(defaultVersion)) : undefined)
  const to = findOption(compareTo) ?? findOption(EDITOR_TEXT)

  const compareWithEditor = (version: PromptVersion) => {
    setCompareFrom(versionValue(version))
    setCompareTo(EDITOR_TEXT)
    compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const swap = () => {
    if (!from || !to) return
    setCompareFrom(to.value)
    setCompareTo(from.value)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center space-x-2">
          <Clock className="h-4 w-4" />
          <span>Histórico de versões</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span>Criado:</span>
            <span>{formatRelative(prompt.created_at)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>Última modificação:</span>
            <span>{formatRelative(prompt.updated_at)}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Uma nova versão é salva sempre que o conteúdo muda. Restaurar coloca o conteúdo da versão no formulário; salve para mantê-lo.
        </p>

        {versions === null ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma versão salva ainda.</p>
        ) : (
          <>
            {/* Comparison between two versions (or a version and the text in the editor) */}
            <section ref={compareRef} aria-labelledby="version-compare-title" className="space-y-3 rounded-lg border p-3 scroll-mt-4">
              <h3 id="version-compare-title" className="flex items-center gap-2 text-sm font-medium">
                <GitCompare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Comparar versões
              </h3>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[9rem] flex-1 space-y-1">
                  <Label htmlFor="compare-from" className="text-xs">De</Label>
                  <Select value={from?.value} onValueChange={setCompareFrom}>
                    <SelectTrigger id="compare-from" className="h-8 text-xs">
                      <SelectValue placeholder="Escolha..." />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={swap}
                  aria-label="Inverter a comparação"
                  title="Inverter"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>
                <div className="min-w-[9rem] flex-1 space-y-1">
                  <Label htmlFor="compare-to" className="text-xs">Para</Label>
                  <Select value={to?.value} onValueChange={setCompareTo}>
                    <SelectTrigger id="compare-to" className="h-8 text-xs">
                      <SelectValue placeholder="Escolha..." />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {from && to && (
                <VersionDiff oldText={from.content} newText={to.content} oldLabel={from.label} newLabel={to.label} />
              )}
            </section>

            <ul className="space-y-3" aria-label="Versões do prompt">
              {versions.map((version) => {
                const inForm = version.content === currentContent
                return (
                  <li key={version.id} className="rounded-lg border p-3 space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium">Versão {version.version_number}</span>
                        {version.version_number === latestVersionNumber && (
                          <Badge variant="outline" className="text-[10px]">Atual</Badge>
                        )}
                        <span className="text-xs text-muted-foreground truncate">
                          {formatRelative(version.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => compareWithEditor(version)}
                          aria-label={`Comparar a versão ${version.version_number} com o texto no editor`}
                          title="Comparar com o texto no editor"
                        >
                          <GitCompare className="h-3.5 w-3.5 mr-1" />
                          Comparar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onRestore(version)}
                          disabled={inForm}
                          title={inForm ? 'Este conteúdo já está no formulário' : undefined}
                          aria-label={`Restaurar a versão ${version.version_number}`}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          Restaurar
                        </Button>
                      </div>
                    </div>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono line-clamp-4">
                      {version.content}
                    </pre>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
