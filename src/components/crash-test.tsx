import React from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

export function CrashTest() {
  const [shouldCrash, setShouldCrash] = React.useState(false)

  // Trigger a React error boundary crash
  const triggerReactCrash = () => {
    setShouldCrash(true)
  }

  // Trigger an unhandled promise rejection
  const triggerPromiseRejection = () => {
    Promise.resolve().then(() => {
      throw new Error('Teste de rejeição de promise não tratada')
    })
  }

  // Trigger a runtime error
  const triggerRuntimeError = () => {
    setTimeout(() => {
      // @ts-ignore - intentionally cause runtime error
      window.nonExistentFunction()
    }, 100)
  }

  // Trigger a custom error with detailed stack trace
  const triggerCustomError = () => {
    const createNestedError = () => {
      const deepError = () => {
        throw new Error('Erro personalizado profundamente aninhado, com rastreamento de pilha detalhado')
      }
      deepError()
    }
    createNestedError()
  }

  if (shouldCrash) {
    throw new Error('Teste do Error Boundary do React - o componente falhou intencionalmente')
  }

  return (
    <Card className="w-full max-w-2xl mx-auto mt-8">
      <CardHeader>
        <CardTitle className="text-destructive">🧪 Teste de falhas</CardTitle>
        <CardDescription>
          Teste diferentes tipos de falha do aplicativo para verificar o funcionamento da caixa de diálogo de falha.
          <strong className="block mt-2 text-destructive">
            ⚠️ Aviso: estes botões realmente provocam falhas em partes do aplicativo!
          </strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Button
            variant="destructive"
            onClick={triggerReactCrash}
            className="w-full"
          >
            Error Boundary do React
          </Button>

          <Button
            variant="destructive"
            onClick={triggerPromiseRejection}
            className="w-full"
          >
            Rejeição de promise
          </Button>

          <Button
            variant="destructive"
            onClick={triggerRuntimeError}
            className="w-full"
          >
            Erro em tempo de execução
          </Button>

          <Button
            variant="destructive"
            onClick={triggerCustomError}
            className="w-full"
          >
            Erro personalizado
          </Button>
        </div>

        <div className="text-xs text-muted-foreground mt-4 p-3 bg-muted rounded">
          <strong>Instruções de teste:</strong>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li><strong>Error Boundary do React:</strong> deve exibir a caixa de diálogo de falha imediatamente</li>
            <li><strong>Rejeição de promise:</strong> verifique no console do navegador o registro do handler global</li>
            <li><strong>Erro em tempo de execução:</strong> verifique no console do navegador o registro do handler global</li>
            <li><strong>Erro personalizado:</strong> deve exibir a caixa de diálogo de falha com o rastreamento de pilha detalhado</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}