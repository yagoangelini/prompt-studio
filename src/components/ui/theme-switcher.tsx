import { useState } from 'react'
import { Monitor, Moon, Sun, Palette, Droplets, Trees, Apple, Circle, Sparkles, Sunset, Snowflake, Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme, type Theme } from '@/contexts/theme-context'
import { cn } from '@/lib/utils'

interface ThemeOption {
  value: Theme
  label: string
  icon: React.ElementType
  description: string
  preview?: string
}

const themeOptions: ThemeOption[] = [
  {
    value: 'system',
    label: 'Sistema',
    icon: Monitor,
    description: 'Segue a preferência do sistema',
    preview: 'Auto'
  },
  {
    value: 'light',
    label: 'Claro',
    icon: Sun,
    description: 'Tema claro',
    preview: '🌕'
  },
  {
    value: 'dark',
    label: 'Escuro',
    icon: Moon,
    description: 'Tema escuro',
    preview: '🌑'
  },
  {
    value: 'matte',
    label: 'Preto fosco',
    icon: Circle,
    description: 'Preto puro com acabamento fosco',
    preview: '⚫'
  },
  {
    value: 'midnight',
    label: 'Meia-noite',
    icon: Moon,
    description: 'Escuro intenso com detalhes em verde',
    preview: '🌌'
  },
  {
    value: 'ocean',
    label: 'Oceano',
    icon: Droplets,
    description: 'Tema em azul profundo',
    preview: '🌊'
  },
  {
    value: 'forest',
    label: 'Floresta',
    icon: Trees,
    description: 'Tema verde inspirado na natureza',
    preview: '🌲'
  },
  {
    value: 'cosmic',
    label: 'Roxo cósmico',
    icon: Sparkles,
    description: 'Tema cósmico em tons de roxo',
    preview: '🔮'
  },
  {
    value: 'sunset',
    label: 'Pôr do sol',
    icon: Sunset,
    description: 'Tons quentes de âmbar do pôr do sol',
    preview: '🌅'
  },
  {
    value: 'arctic',
    label: 'Ártico',
    icon: Snowflake,
    description: 'Tema em tons frios de azul-gelo',
    preview: '❄️'
  },
  {
    value: 'rose',
    label: 'Rosa',
    icon: Heart,
    description: 'Tema rosa elegante',
    preview: '🌹'
  },
  {
    value: 'macos',
    label: 'macOS',
    icon: Apple,
    description: 'Tema escuro no estilo do macOS',
    preview: '🍎'
  }
]

interface ThemeSwitcherProps {
  collapsed?: boolean
}

// Shared by both triggers. Wide enough for each description to fit in one line, so the 12 options
// fit in a 800 px tall window; in smaller windows the list scrolls inside the menu.
function ThemeMenuContent({ theme, onSelect }: { theme: Theme; onSelect: (theme: Theme) => void }) {
  return (
    <DropdownMenuContent side="right" align="end" collisionPadding={8} className="w-96 max-w-[calc(100vw-16px)]">
      {themeOptions.map((option) => {
        const Icon = option.icon
        const isCurrent = theme === option.value
        return (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onSelect(option.value)}
            className={cn(
              "flex items-center gap-3 px-3 py-1.5",
              isCurrent && "bg-secondary"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{option.label}</div>
              <div className="truncate text-xs text-muted-foreground">{option.description}</div>
              {isCurrent && <span className="sr-only">(tema atual)</span>}
            </div>
            {option.preview && (
              <span className="shrink-0 text-sm" aria-hidden="true">{option.preview}</span>
            )}
            {isCurrent && (
              <div className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            )}
          </DropdownMenuItem>
        )
      })}
    </DropdownMenuContent>
  )
}

export function ThemeSwitcher({ collapsed = false }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme()
  const currentTheme = themeOptions.find(option => option.value === theme)

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
  }

  if (collapsed) {
    return (
      <TooltipProvider>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Alterar tema (atual: ${currentTheme?.label || 'Desconhecido'})`}
                >
                  {currentTheme ? (
                    <currentTheme.icon className="h-4 w-4" />
                  ) : (
                    <Palette className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Alterar tema ({currentTheme?.label || 'Desconhecido'})</p>
            </TooltipContent>
          </Tooltip>
          <ThemeMenuContent theme={theme} onSelect={handleThemeChange} />
        </DropdownMenu>
      </TooltipProvider>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start h-8 text-xs"
          aria-label={`Alterar tema (atual: ${currentTheme?.label || 'Desconhecido'})`}
        >
          {currentTheme ? (
            <currentTheme.icon className="h-4 w-4 mr-2" />
          ) : (
            <Palette className="h-4 w-4 mr-2" />
          )}
          <span className="flex-1 text-left">
            {currentTheme?.label || 'Tema'}
          </span>
          {currentTheme?.preview && (
            <span className="ml-auto text-sm">{currentTheme.preview}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <ThemeMenuContent theme={theme} onSelect={handleThemeChange} />
    </DropdownMenu>
  )
}