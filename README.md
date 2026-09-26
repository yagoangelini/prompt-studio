# Prompt Studio

Um aplicativo desktop poderoso para gerenciar, organizar e testar prompts de IA com eficiência. Desenvolvido com Electron e SQLite, o Prompt Studio oferece o modo desktop e o modo barra de menus para você gerenciar seus prompts sem complicação.

## 📸 Capturas de tela

### Modo desktop
![Prompt Studio no modo desktop](assets/screenshot.png)

### Modo barra de menus
![Prompt Studio no modo barra de menus](assets/screenshot-menubar.png)

## ✨ Recursos

### 🎯 Funcionalidades principais
- **Dois modos de operação**: alterne entre o aplicativo desktop completo e o modo barra de menus compacto
- **Organização inteligente**: categorias e subcategorias, tags, favoritos e prompts fixados no topo
- **Sequências passo a passo**: transforme uma categoria em um fluxo ordenado (arraste para reordenar) e use "Copiar próximo passo"
- **Ações em massa**: selecione vários prompts para mover, marcar, expor no servidor MCP, exportar ou excluir de uma vez
- **Histórico de versões**: acompanhe as alterações com versionamento automático, compare duas versões lado a lado e restaure qualquer uma
- **Sistema de templates**: crie templates reutilizáveis com substituição de variáveis
- **Busca e filtros**: busca poderosa em todos os prompts, com várias opções de filtro (veja a [sintaxe de busca](#sintaxe-de-busca))

### ⚡ Produtividade
- **Colar rápido (como o Windows+V)**: um atalho global (padrão `Ctrl+Shift+Espaço`) abre a lista de prompts por cima de qualquer programa; Enter ou clique cola o prompt onde está o cursor (veja [Colar rápido](#colar-rápido))
- **Preencher variáveis ao copiar**: prompts com `{{variáveis}}` pedem os valores antes de copiar ou colar
- **Paleta de comandos**: `Ctrl/Cmd + K` busca prompts e executa ações só pelo teclado
- **Mais usados**: o app conta quantas vezes cada prompt foi usado e ordena por uso
- **Editor aprimorado**: destaque das variáveis, pré-visualização em Markdown e estimativa de tokens

### 🚀 Teste de prompts
- **OpenAI e Anthropic (Claude)**: teste prompts na API da OpenAI, em endpoints compatíveis ou na API da Anthropic
- **Histórico e comparação**: cada teste fica salvo; compare duas execuções ou dois modelos lado a lado
- **Análise de respostas**: uso de tokens e tempo de resposta
- **Copiar e compartilhar**: integração simples com a área de transferência

### 🔌 Servidor MCP
- **Seus prompts no Claude Code e no Claude Desktop**: exponha prompts escolhidos por um servidor MCP local (Streamable HTTP), com as variáveis `{{...}}` como argumentos (veja [Servidor MCP](#servidor-mcp))
- **API REST simples**: os mesmos prompts também ficam disponíveis por HTTP, protegidos por chave de API

### 🎨 Experiência do usuário
- **Temas claro e escuro**: troca de tema suave, com detecção da preferência do sistema
- **Design responsivo**: otimizado para diferentes tamanhos e orientações de tela
- **Atalhos de teclado**: atalhos para usuários avançados em todas as ações principais
- **Integração com a bandeja do sistema**: acesso rápido pela bandeja do sistema/barra de menus
- **Recuperação de falhas**: relatório de falhas integrado, com rastreamento de pilha (stack trace) detalhado e opção de reiniciar o app

### 📁 Gerenciamento de dados
- **Importar/Exportar**: suporte aos formatos JSON e texto simples
- **Comandos do Claude Code**: exporte prompts como comandos (`/nome-do-prompt`) para a pasta `.claude/commands` de um projeto (veja [Exportar para o Claude Code](#exportar-para-o-claude-code))
- **Backup automático**: cópia diária do banco de dados numa pasta que você escolher, com restauração em um clique (veja [Backup automático](#backup-automático))
- **Persistência de dados**: armazenamento seguro em SQLite no seu diretório de dados do usuário
- **Multiplataforma**: funciona no Windows, macOS e Linux

## 📋 Requisitos

- **Node.js**: versão 16.x ou superior (18.x+ recomendada)
- **Gerenciador de pacotes**:
  - **pnpm**: versão 8.x ou superior (recomendado)
  - **npm**: versão 8.x ou superior (alternativa)
- **Sistema operacional**:
  - macOS 10.14 (Mojave) ou posterior
  - Windows 10 ou posterior
  - Linux (Ubuntu 18.04+ ou equivalente)
- **Arquitetura**: x64, arm64 (Apple Silicon) ou ia32

## 🚀 Início rápido

### Opção 1: usando o script de execução (recomendado)

**Unix/macOS/Linux:**
```bash
# Torne o script executável (apenas na primeira vez)
chmod +x scripts/run.sh

# Execute o aplicativo
./scripts/run.sh
```

**Windows:**
```cmd
# Execute pelo Prompt de Comando
scripts\run.bat

# Ou pelo PowerShell
.\scripts\run.bat
```

Os scripts de execução vão automaticamente:
- Verificar a instalação do Node.js e do npm
- Instalar as dependências, se necessário
- Recompilar os módulos nativos
- Iniciar o aplicativo em modo de desenvolvimento

### Opção 2: configuração manual

1. **Clone ou baixe o projeto**
   ```bash
   git clone <url-do-repositorio>
   cd prompt-studio
   ```

2. **Instale as dependências**
   ```bash
   # Usando pnpm (recomendado)
   pnpm install
   
   # Ou usando npm
   npm install
   ```

3. **Inicie o aplicativo**
   ```bash
   # Modo de desenvolvimento com hot reload
   pnpm run dev
   # ou
   npm run dev
   
   # Inicie o app Electron em modo de desenvolvimento
   pnpm run electron:dev
   # ou
   npm run electron:dev
   ```

## 🏗️ Build de produção

### Usando os scripts de build (recomendado)

**Unix/macOS/Linux:**
```bash
# Torne o script executável (apenas na primeira vez)
chmod +x scripts/build.sh

# Gera o build para a plataforma atual, com detecção de arquitetura
./scripts/build.sh

# Opções adicionais
./scripts/build.sh --clean         # Reinstala as dependências do zero
./scripts/build.sh --skip-tests    # Pula a execução dos testes
./scripts/build.sh --force         # Força o build mesmo com falhas nos testes
./scripts/build.sh --help          # Mostra todas as opções
```

**Windows (PowerShell):**
```powershell
# Gera o build para Windows
.\scripts\build.ps1

# Opções adicionais
.\scripts\build.ps1 -Clean         # Reinstala as dependências do zero
.\scripts\build.ps1 -SkipTests     # Pula a execução dos testes
.\scripts\build.ps1 -Force         # Força o build mesmo com falhas nos testes
.\scripts\build.ps1 -Help          # Mostra todas as opções
```

### Build manual

**Para a plataforma atual:**
```bash
# Usando pnpm (recomendado)
pnpm run build

# Usando npm
npm run build
```

**Para plataformas específicas:**
```bash
# Builds para macOS (Universal: Intel + Apple Silicon)
pnpm run build:mac      # Instalador DMG e arquivo ZIP
npm run build:mac

# Builds para Windows
pnpm run build:win      # Instalador NSIS e exe portátil
npm run build:win

# Builds para Linux
pnpm run build:linux    # AppImage e pacote DEB
npm run build:linux
```

### Recursos avançados de build

Os scripts de build oferecem recursos adicionais:

- **Detecção de arquitetura**: gera o build automaticamente para a sua arquitetura atual
- **Assinatura de código**: assinatura de código no macOS (defina a variável de ambiente `CODESIGN_IDENTITY`)
- **Notarização**: notarização no macOS (defina `APPLE_ID`, `APPLE_ID_PASS` e `TEAM_ID`)
- **Geração de ícones**: conversão automática de PNG para os formatos específicos de cada plataforma
- **Recompilação de módulos nativos**: garante que o sqlite3 e os demais módulos nativos funcionem corretamente
- **Builds limpos**: opção para limpar os caches e recompilar tudo do zero

Os aplicativos gerados ficam disponíveis no diretório `dist/`.

## 📖 Guia de uso

### Primeiros passos

1. **Primeira execução**: o app inicia no modo desktop e cria um banco de dados local
2. **Crie categorias**: organize seus prompts com categorias identificadas por cores
3. **Adicione templates**: configure templates reutilizáveis com espaços reservados para variáveis
4. **Crie prompts**: comece a montar sua biblioteca de prompts

### Recursos do modo desktop

- **Interface completa**: acesse todos os recursos em uma janela ampla
- **Editor de prompts**: experiência de edição completa, com realce de sintaxe
- **Painel de teste**: testes em tempo real, com configurações de API ajustáveis
- **Operações em lote**: importe/exporte vários prompts de uma só vez

### Recursos do modo barra de menus

- **Acesso rápido**: interface compacta, acessível pela bandeja do sistema
- **Prompts recentes**: acesso rápido aos prompts usados recentemente
- **Favoritos**: acesso com um clique aos prompts marcados como favoritos
- **Criação rápida**: crie prompts rapidamente, só com os campos essenciais

### Colar rápido

Funciona como a área de transferência do Windows (`Windows + V`), mas com os seus prompts:

1. Em qualquer programa (terminal com o Claude Code, navegador, editor), pressione `Ctrl + Shift + Espaço`
2. Digite para filtrar (sem se preocupar com acentos) ou use as setas
3. Pressione **Enter** ou **clique** no prompt: ele é colado onde estava o cursor. Se o prompt tiver `{{variáveis}}`, o app pede os valores antes
4. `Ctrl + Enter` só copia; `Esc` fecha

O atalho, a opção de colar automaticamente e o liga/desliga ficam em **Configurações > Geral > Colar rápido**. Se o atalho já for usado por outro programa (por exemplo, o VS Code usa `Ctrl + Shift + Espaço`), escolha outra combinação ali.

> ⚠️ No Windows, programas executados como administrador não aceitam a colagem simulada: nesse caso o prompt fica copiado e basta colar com `Ctrl + V`. No macOS é preciso permitir o Prompt Studio em **Acessibilidade**; no Linux, ter o `xdotool` instalado.

### Sequências passo a passo

Marque uma categoria como **sequência** (no formulário da categoria) para tratar os prompts dela como etapas de um fluxo, como "Crie um plano" → "Revise a segurança" → "Analise o plano":

- Ao filtrar pela categoria, os passos aparecem numerados; reordene arrastando, pelos botões ↑/↓ ou com `Alt + ↑/↓`
- **Copiar próximo passo** copia a próxima etapa e avança; **Recomeçar** volta ao primeiro passo
- Não é preciso numerar os títulos: a ordem fica guardada no app

### Exportar para o Claude Code

Em **Configurações > Dados > Exportar para o Claude Code** (ou nas ações em massa), escolha a pasta do projeto. O app grava um arquivo por prompt em `.claude/commands/<categoria>/<prompt>.md`, que o Claude Code mostra como comando (`/<prompt>`). As variáveis `{{...}}` viram argumentos do comando. Arquivos que você mesmo criou nessa pasta nunca são sobrescritos.

### Backup automático

Em **Configurações > Dados > Backup automático**, ative o backup e escolha uma pasta (de preferência sincronizada, como OneDrive ou Google Drive). O app faz uma cópia completa do banco de dados por dia e guarda as mais recentes (10 por padrão). Para voltar a um backup, clique em **Restaurar**: antes de substituir os dados, o app faz um backup de segurança do estado atual e depois reinicia.

### Sintaxe de busca

Além do texto livre (que procura no título, no conteúdo e na descrição dos prompts), o campo de busca aceita operadores para refinar os resultados. Você pode combinar vários operadores na mesma busca.

| Operador | O que faz | Exemplo |
|----------|-----------|---------|
| `tag:` | Filtra por tag. Separe várias tags com vírgula: basta o prompt ter uma delas | `tag:IA,Escrita` |
| `titulo:` | Procura somente no título | `titulo:resumo` |
| `conteudo:` | Procura somente no conteúdo | `conteudo:"passo a passo"` |
| `categoria:` | Filtra por categoria (inclui as subcategorias) | `categoria:Marketing` |
| `favorito:sim` | Mostra somente os favoritos | `favorito:sim` |
| `favorito:nao` | Mostra somente os prompts que não são favoritos | `favorito:nao` |

- Os operadores são escritos sem acento: `titulo:`, `conteudo:` e `favorito:nao`.
- Use aspas para valores com espaços, como em `categoria:"Atendimento ao cliente"`.
- Exemplo combinado: `e-mail tag:Escrita favorito:sim` encontra prompts favoritos com a tag "Escrita" que mencionam "e-mail".

> 💡 Os operadores em inglês continuam funcionando: `title:`, `content:`, `category:`, `is:favorite` e `is:not-favorite` (o `tag:` é igual nos dois idiomas).

### Atalhos de teclado

| Ação | Atalho |
|------|--------|
| Colar rápido (em qualquer programa) | `Ctrl/Cmd + Shift + Espaço` (configurável) |
| Paleta de comandos | `Ctrl/Cmd + K` |
| Novo prompt | `Ctrl/Cmd + N` |
| Buscar | `Ctrl/Cmd + F` |
| Salvar prompt | `Ctrl/Cmd + S` |
| Alternar tema | `Ctrl/Cmd + T` |
| Alternar para o modo desktop | `Ctrl/Cmd + O` (no modo barra de menus) |
| Selecionar os prompts filtrados | `Ctrl/Cmd + A` (fora de campos de texto) |
| Mover um passo da sequência | `Alt + ↑/↓` |

## 🔧 Configuração

### Configuração da API

1. Abra a aba **Testes** e depois **Configuração**
2. Informe sua **chave de API** (ela fica só na memória enquanto o app está aberto e é enviada apenas ao endpoint configurado)
3. Escolha ou digite o **modelo** de sua preferência
4. Escolha o **provedor**: "OpenAI e compatíveis" (formato `/v1/chat/completions`, também para endpoints personalizados) ou "Anthropic (Claude)" (Messages API, `/v1/messages`)
5. Se quiser, configure um **endpoint da API** personalizado

### Servidor MCP

O Prompt Studio pode disponibilizar os prompts que você escolher para clientes MCP (Model Context Protocol), como o Claude Code e o Claude Desktop. O servidor roda dentro do app e aceita conexões **apenas deste computador** (`127.0.0.1`).

1. Na aba **Servidor MCP > Prompts expostos**, ative os prompts que deseja disponibilizar
2. Em **Configuração**, clique em **Gerar** para criar uma chave de API (com a autenticação ativada, o servidor não inicia sem chave)
3. Em **Visão geral**, clique em **Iniciar servidor**
4. Conecte seu cliente MCP ao endereço `http://127.0.0.1:PORTA/mcp` (a porta padrão é `3000`)

**Claude Code** (no terminal):

```bash
claude mcp add --transport http prompt-studio http://127.0.0.1:3000/mcp --header "Authorization: Bearer SUA_CHAVE_DE_API"
```

**Claude Desktop** (arquivo `claude_desktop_config.json`; requer Node.js, pois o [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) faz a ponte até o servidor):

```json
{
  "mcpServers": {
    "prompt-studio": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3000/mcp", "--allow-http", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer SUA_CHAVE_DE_API" }
    }
  }
}
```

A aba **Documentação** do painel mostra esses exemplos já com a sua porta, e os botões de copiar incluem a sua chave.

**O que o cliente recebe**
- **Prompts** (`prompts/list`, `prompts/get`): cada prompt exposto, com as variáveis `{{...}}` do conteúdo como argumentos. No Claude Code, eles aparecem como `/mcp__prompt-studio__nome-do-prompt`.
- **Ferramenta `obter_prompt`**: recebe `nome` (ou `hash`) e `variaveis` e devolve o texto do prompt com as variáveis preenchidas.

A substituição das variáveis é literal: o valor enviado entra no texto exatamente como foi escrito.

**API REST**

| Rota | Descrição |
|------|-----------|
| `GET /health` | Verifica se o servidor está no ar (sem autenticação). Resposta: `{"status":"ok"}` |
| `GET /prompts` | Lista os prompts expostos, com o hash, as variáveis e o endpoint de cada um |
| `GET /prompts/:hash` | Obtém um prompt exposto pelo hash do endpoint |
| `POST /prompts/:hash/execute` | Devolve o prompt com as variáveis substituídas. Corpo: `{"variables": {"nome": "valor"}}` |

Com a autenticação ativada, envie o cabeçalho `Authorization: Bearer SUA_CHAVE_DE_API` em todas as rotas, exceto `/health`. Exemplo:

```bash
curl -X POST http://127.0.0.1:3000/prompts/HASH/execute \
  -H "Authorization: Bearer SUA_CHAVE_DE_API" -H "Content-Type: application/json" \
  -d '{"variables": {"tema": "vendas"}}'
```

**Segurança**
- O servidor escuta só em `127.0.0.1`; outros computadores da rede não conseguem acessá-lo
- A chave é comparada em tempo constante; requisições sem a chave correta recebem `401`
- Corpo das requisições limitado a 1 MB (`413`), limite de requisições por minuto (`429` com `Retry-After`) e de conexões simultâneas
- O CORS (acesso por páginas web de outras origens) só funciona com a autenticação ativada
- **Exportar configuração** não inclui a chave de API

### Configurações de tema

- **Automático**: o app segue a preferência de tema do sistema
- **Manual**: alterne entre os modos claro e escuro pelo botão de tema
- **Persistência**: o tema escolhido é salvo e restaurado quando o app é reiniciado

### Local dos dados

Os dados dos seus prompts ficam armazenados com segurança em:
- **macOS**: `~/Library/Application Support/prompt-studio/`
- **Windows**: `%APPDATA%/prompt-studio/`
- **Linux**: `~/.config/prompt-studio/`

## 🛠️ Desenvolvimento

### Estrutura do projeto

```
prompt-studio/
├── package.json           # Dependências e scripts
├── vite.config.ts         # Configuração de build do Vite
├── tailwind.config.js     # Configuração do Tailwind CSS
├── tsconfig.json          # Configuração do TypeScript
├── assets/                # Ícones e recursos do app
│   ├── icon.png          # Ícone base do aplicativo
│   ├── icon.icns         # Ícone no formato do macOS
│   └── tray-icon.png     # Ícone da bandeja do sistema
├── scripts/               # Scripts de build e execução
│   ├── run.sh/.bat       # Execução em desenvolvimento
│   └── build.sh/.ps1     # Scripts de build de produção
├── electron/              # Processo principal do Electron (TypeScript)
│   ├── main.ts           # Processo principal do Electron
│   ├── preload.ts        # Script de preload para segurança
│   └── database/         # Camada de banco de dados
│       ├── init.ts       # Inicialização do banco de dados
│       ├── queries.ts    # Operações no banco de dados
│       └── sample-data.ts # Dados de exemplo para a primeira execução
└── src/                   # Frontend React (TypeScript + Tailwind)
    ├── App.tsx           # Componente principal do aplicativo
    ├── main.tsx          # Ponto de entrada do React
    ├── index.css         # Estilos globais
    ├── components/       # Componentes React
    │   ├── crash-handler.tsx    # Sistema de relatório de falhas
    │   ├── ui/           # Componentes de UI reutilizáveis
    │   ├── forms/        # Componentes de formulário
    │   ├── layout/       # Componentes de layout
    │   ├── prompts/      # Componentes específicos de prompts
    │   ├── settings/     # Componentes de configurações
    │   ├── templates/    # Componentes de templates
    │   ├── testing/      # Componentes de teste da API
    │   └── theme/        # Componentes de tema
    ├── contexts/         # Contextos React
    ├── hooks/            # Hooks React personalizados
    ├── stores/           # Gerenciamento de estado com Zustand
    ├── types/            # Definições de tipos TypeScript
    └── lib/              # Funções utilitárias
```

### Adicionando recursos

1. **Alterações no banco de dados**: atualize `electron/database/init.ts` para mudanças no esquema
2. **Componentes de UI**: crie componentes React em `src/components/`
3. **Gerenciamento de estado**: use as stores do Zustand em `src/stores/`
4. **Definições de tipos**: adicione os tipos TypeScript em `src/types/index.ts`
5. **Comunicação IPC**: adicione os handlers em `electron/main.ts` e `electron/preload.ts`

### Tecnologias

- **Frontend**: React 18 + TypeScript + Tailwind CSS + Vite
- **Backend**: Electron + Node.js + SQLite3
- **Gerenciamento de estado**: Zustand
- **Componentes de UI**: primitivos do Radix UI
- **Sistema de build**: Vite + Electron Builder
- **Qualidade de código**: ESLint + Prettier + TypeScript

### Testes

```bash
# Executar em modo de desenvolvimento
pnpm run dev

# Iniciar o Electron com as ferramentas de desenvolvimento
pnpm run electron:dev

# Verificação de tipos
pnpm run typecheck

# Lint
pnpm run lint

# Formatar o código
pnpm run format

# Gerar e testar a versão de produção
pnpm run build
```

## 🚨 Solução de problemas

### Problemas comuns

**As dependências não são instaladas:**
```bash
# Limpe o cache e reinstale (pnpm)
pnpm store prune
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Limpe o cache e reinstale (npm)
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

**Erros de compilação do SQLite:**
```bash
# Recompile os módulos nativos
pnpm rebuild sqlite3
# ou
npm rebuild sqlite3

# Force a reinstalação do sqlite3
pnpm remove sqlite3 && pnpm add sqlite3
# ou
npm uninstall sqlite3 && npm install sqlite3
```

**Erros de TypeScript:**
```bash
# Verifique os tipos
pnpm run typecheck

# Limpe o cache do TypeScript
rm -rf dist-electron/
pnpm run typecheck
```

**O aplicativo apresenta falhas:**
- O app inclui um relatório de falhas integrado, com rastreamento de pilha (stack trace) detalhado
- Confira a janela de falha que aparece quando ocorre um erro
- Copie o stack trace para depurar ou relatar o problema
- Use o botão de reiniciar na janela de falha para recuperar o app

**O app não inicia:**
- Confirme que a versão do Node.js é 16 ou superior com `node --version`
- Verifique se todas as dependências foram instaladas com `pnpm list` ou `npm list`
- Procure mensagens de erro específicas na saída do console
- Tente executar `pnpm run electron:dev` para depurar em modo de desenvolvimento

**O modo barra de menus não aparece:**
- Procure o ícone do app na bandeja do sistema
- Clique com o botão direito no ícone da bandeja para abrir o menu de contexto
- Alterne para o modo desktop se a barra de menus não estiver visível
- Verifique se o app está sendo executado em segundo plano (Monitor de Atividade/Gerenciador de Tarefas)

### Como obter ajuda

1. **Confira o console**: procure mensagens de erro no terminal
2. **Confira os logs**: os logs do aplicativo ficam salvos no seu diretório de dados
3. **Redefina o banco de dados**: exclua o arquivo do banco de dados para começar do zero (os dados serão perdidos!)
4. **Reinstale**: remova a pasta `node_modules` e execute a configuração novamente

### Dicas de desempenho

- **Tamanho do banco de dados**: bibliotecas grandes (mais de 1.000 prompts) podem deixar a busca mais lenta
- **Uso de memória**: feche o app por completo para liberar memória (não basta minimizar)
- **Limites da API**: fique atento aos limites de requisições (rate limits) da API ao testar prompts com frequência

## 🔒 Segurança e privacidade

- **Armazenamento local**: todos os dados ficam armazenados localmente na sua máquina
- **Chaves de API**: nunca são transmitidas nem gravadas em logs
- **Sem telemetria**: nenhum dado de uso é coletado ou transmitido
- **Código aberto**: código-fonte completo disponível para auditoria de segurança

## 🤝 Como contribuir

Contribuições são muito bem-vindas! Veja como começar:

1. **Faça um fork do repositório**: crie sua própria cópia do projeto
2. **Crie uma branch**: `git checkout -b feature/nome-do-recurso`
3. **Faça as alterações**: implemente seu recurso ou sua correção
4. **Teste com cuidado**: garanta que tudo funciona como esperado
5. **Envie um pull request**: descreva suas alterações e por que elas são necessárias

### Diretrizes de desenvolvimento

- Siga o estilo de código e as convenções existentes
- Teste em várias plataformas, se possível
- Atualize a documentação ao adicionar novos recursos
- Mantenha os commits focados e descritivos

## 📄 Licença

Este projeto está licenciado sob a Licença MIT. Consulte o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🎯 Roadmap

### Atualizações recentes
- [x] **Português do Brasil**: pt-BR como idioma oficial da interface e da documentação, com operadores de busca em português
- [x] **Sistema de recuperação de falhas**: relatório de falhas integrado, com stack traces detalhados
- [x] **Arquitetura moderna**: migração para React + TypeScript + Vite
- [x] **Sistema de build aprimorado**: builds específicos para cada arquitetura, com suporte a assinatura de código
- [x] **Melhorias na interface**: componentes Radix UI com melhor acessibilidade
- [x] **Sistema de temas**: alternância aprimorada entre os modos claro e escuro

### Próximos recursos
- [ ] Sincronização na nuvem
- [ ] Compartilhamento colaborativo de prompts
- [ ] Análises e insights avançados
- [ ] Sistema de plugins para integrações personalizadas
- [ ] App complementar para celular
- [ ] Variáveis e funções avançadas para templates
- [ ] Suporte a vários idiomas
- [ ] Busca avançada com filtros
- [ ] Análise de desempenho dos prompts

### Limitações conhecidas
- Ainda não há colaboração em tempo real
- Limitado a cenários com um único usuário
- Sem backup na nuvem (apenas armazenamento local)
- Testes de API limitados a endpoints compatíveis com a OpenAI
- Sem versão para celular (apenas desktop)

## 📞 Suporte

- **Issues**: relate bugs e sugira novos recursos no nosso rastreador de issues
- **Discussões**: participe das discussões da comunidade para trocar dicas e truques
- **Documentação**: consulte este README e os comentários no código
- **Atualizações**: acompanhe as releases para conhecer novos recursos e correções de bugs

## ☕ Apoie o projeto

Contamos com o seu apoio para manter o Prompt Studio **gratuito e incrível!** 🎉 

Suas contribuições nos ajudam a:
- 🚀 **Adicionar novos recursos** e melhorar os existentes
- 🐛 **Corrigir bugs** e aumentar a estabilidade
- 📚 **Melhorar a documentação** e os tutoriais
- 🌟 **Manter o projeto** ativo e atualizado

**Pague um café para a gente e ajude a abastecer nossas sessões de programação!** ☕️

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-☕-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/zaagan)

Toda contribuição, por menor que seja, faz uma enorme diferença! 🙌

**Outras formas de apoiar:**
- ⭐ **Dê uma estrela neste repositório** para mostrar seu apoio
- 📢 **Compartilhe o Prompt Studio** com outros entusiastas de IA
- 🐛 **Relate bugs** e sugira melhorias
- 💡 **Contribua com código** ou documentação

---

**Feito com ❤️ para a comunidade de IA**

*Prompt Studio - Sua solução para gerenciar prompts de IA*
