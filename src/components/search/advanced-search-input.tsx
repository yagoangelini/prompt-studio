import { useState, useEffect, useMemo, useRef } from 'react'
import { Search, X, Tag, Hash, Star, FileText, Palette } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  parseSearchQuery,
  getSearchSuggestions,
  getFilterRegex,
  parseTagList,
  formatTagFilter,
  normalizeSearchText
} from '@/lib/search-parser'
import { usePromptStore } from '@/stores/usePromptStore'

interface AdvancedSearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

// Number of tags offered as quick filters (the most used ones)
const QUICK_FILTER_TAGS = 3

const tagCollator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

function RemoveFilterButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="ml-1 -mr-1 h-4 w-4 p-0 hover:bg-transparent"
      aria-label={`Remover filtro ${label}`}
      title="Remover filtro"
    >
      <X className="h-3 w-3" />
    </Button>
  )
}

export function AdvancedSearchInput({
  value,
  onChange,
  placeholder = "Buscar prompts (ex.: tag:IA)",
  className
}: AdvancedSearchInputProps) {
  const { tags, categories, prompts } = usePromptStore()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const parsedQuery = parseSearchQuery(value)

  // Most used tags first (ties in alphabetical order); tags that differ only in case/accents count as one
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const prompt of prompts) {
      for (const tag of new Set(prompt.tags.map(normalizeSearchText))) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    const seen = new Set<string>()
    return tags
      .filter(tag => {
        const key = normalizeSearchText(tag)
        if (seen.has(key) || !counts.get(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) =>
        (counts.get(normalizeSearchText(b)) ?? 0) - (counts.get(normalizeSearchText(a)) ?? 0) ||
        tagCollator.compare(a, b)
      )
      .slice(0, QUICK_FILTER_TAGS)
  }, [tags, prompts])

  useEffect(() => {
    if (value.trim()) {
      const categoryNames = categories.map(c => c.name)
      const newSuggestions = getSearchSuggestions(value, [...tags], categoryNames)
      setSuggestions(newSuggestions)
      setSelectedSuggestion(-1)
    } else {
      setSuggestions([])
      setShowSuggestions(false)
    }
  }, [value, tags, categories])

  // Suggestions open while typing only: focusing the field again (Ctrl+K closed, Tab) must not
  // cover the controls below it
  const handleInputChange = (newValue: string) => {
    onChange(newValue)
    setShowSuggestions(newValue.trim().length > 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedSuggestion(prev =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedSuggestion(prev =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        )
        break
      case 'Enter': {
        const suggestion = suggestions[selectedSuggestion]
        if (selectedSuggestion >= 0 && suggestion !== undefined) {
          e.preventDefault()
          onChange(suggestion)
          setShowSuggestions(false)
        }
        break
      }
      case 'Escape':
        setShowSuggestions(false)
        setSelectedSuggestion(-1)
        break
    }
  }

  const handleSuggestionClick = (suggestion: string) => {
    onChange(suggestion)
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  const handleClear = () => {
    onChange('')
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  const addQuickFilter = (filter: string) => {
    const newValue = value ? `${value} ${filter}` : filter
    onChange(newValue)
    inputRef.current?.focus()
  }

  const removeFilter = (filterType: 'tag' | 'title' | 'content' | 'category' | 'favorite', filterValue?: string) => {
    let newValue = value

    switch (filterType) {
      case 'tag':
        if (filterValue !== undefined) {
          // Remove one tag from every tag list, keeping the others (quoted or not)
          newValue = newValue.replace(getFilterRegex('tag'), (match) => {
            const tagList = match.slice(match.indexOf(':') + 1)
            const remainingTags = parseTagList(tagList).filter(t => t !== filterValue)
            return remainingTags.length === 0 ? '' : formatTagFilter(remainingTags)
          })
        } else {
          newValue = newValue.replace(getFilterRegex('tag'), '')
        }
        break
      case 'title':
        // Handle both quoted and unquoted title values (titulo:/título:/title:)
        newValue = newValue.replace(getFilterRegex('title'), '')
        break
      case 'content':
        // Handle both quoted and unquoted content values (conteudo:/conteúdo:/content:)
        newValue = newValue.replace(getFilterRegex('content'), '')
        break
      case 'category':
        // Handle both quoted and unquoted category values (categoria:/category:)
        newValue = newValue.replace(getFilterRegex('category'), '')
        break
      case 'favorite':
        // favorito:sim / favorito:nao / is:favorite / is:not-favorite
        newValue = newValue.replace(getFilterRegex('favorite'), '')
        break
    }

    onChange(newValue.replace(/\s+/g, ' ').trim())
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          aria-label="Buscar prompts"
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          className={cn("pl-9 pr-10", className)}
          data-search-input
        />
        {value && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 hover:bg-muted"
            aria-label="Limpar busca"
            title="Limpar busca"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Active Filters Display */}
      {(parsedQuery.tags.length > 0 || parsedQuery.title || parsedQuery.content || parsedQuery.category || parsedQuery.isFavorite !== undefined) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {parsedQuery.tags.map((tag, index) => (
            <Badge key={`${index}-${tag}`} variant="secondary" className="text-xs max-w-full">
              <Hash className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">{tag}</span>
              <RemoveFilterButton label={`tag ${tag}`} onClick={() => removeFilter('tag', tag)} />
            </Badge>
          ))}
          {parsedQuery.title && (
            <Badge variant="secondary" className="text-xs max-w-full">
              <FileText className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">titulo:{parsedQuery.title}</span>
              <RemoveFilterButton label="de título" onClick={() => removeFilter('title')} />
            </Badge>
          )}
          {parsedQuery.content && (
            <Badge variant="secondary" className="text-xs max-w-full">
              <Search className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">conteudo:{parsedQuery.content}</span>
              <RemoveFilterButton label="de conteúdo" onClick={() => removeFilter('content')} />
            </Badge>
          )}
          {parsedQuery.category && (
            <Badge variant="secondary" className="text-xs max-w-full">
              <Palette className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">categoria:{parsedQuery.category}</span>
              <RemoveFilterButton label="de categoria" onClick={() => removeFilter('category')} />
            </Badge>
          )}
          {parsedQuery.isFavorite === true && (
            <Badge variant="secondary" className="text-xs">
              <Star className="h-3 w-3 mr-1 fill-current" />
              favorito
              <RemoveFilterButton label="de favoritos" onClick={() => removeFilter('favorite')} />
            </Badge>
          )}
          {parsedQuery.isFavorite === false && (
            <Badge variant="secondary" className="text-xs">
              <Star className="h-3 w-3 mr-1" />
              não favorito
              <RemoveFilterButton label="de não favoritos" onClick={() => removeFilter('favorite')} />
            </Badge>
          )}
        </div>
      )}

      {/* Search Suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-md shadow-md">
          <ScrollArea className="max-h-64">
            <div className="p-1">
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent hover:text-accent-foreground",
                    selectedSuggestion === index && "bg-accent text-accent-foreground"
                  )}
                >
                  <Search className="inline h-3 w-3 mr-2" />
                  {suggestion}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Quick Filters */}
      {!value && (
        <div className="flex flex-wrap gap-1 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => addQuickFilter('favorito:sim')}
            className="text-xs"
          >
            <Star className="h-3 w-3 mr-1" />
            Favoritos
          </Button>
          {popularTags.map((tag) => (
            <Button
              key={tag}
              variant="outline"
              size="sm"
              onClick={() => addQuickFilter(formatTagFilter([tag]))}
              className="text-xs max-w-[12rem]"
              title={`Filtrar pela tag ${tag}`}
            >
              <Tag className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">{tag}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
