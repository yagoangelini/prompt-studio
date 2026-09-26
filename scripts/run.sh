#!/bin/bash

# Prompt Studio Development Runner (Unix/macOS/Linux)
# This script checks dependencies, installs them if needed, and starts the app

set -e  # Exit on any error

# Global variables
PACKAGE_MANAGER=""

echo "🚀 Prompt Studio - Modo de desenvolvimento"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCESSO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERRO]${NC} $1"
}

# Check if Node.js is installed
check_node() {
    print_status "Verificando a instalação do Node.js..."
    
    if ! command -v node &> /dev/null; then
        print_error "O Node.js não está instalado!"
        print_status "Instale o Node.js em https://nodejs.org/"
        print_status "Versão recomendada: 18.x ou superior"
        exit 1
    fi
    
    NODE_VERSION=$(node --version)
    print_success "Node.js encontrado: $NODE_VERSION"
    
    # Check Node version (require v16+)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    if [ "$NODE_MAJOR" -lt 16 ]; then
        print_warning "A versão do Node.js é anterior à recomendada (v16+)"
        print_status "Sua versão: $NODE_VERSION"
        print_status "Considere atualizar para garantir a melhor compatibilidade"
    fi
}

# Check package manager (prefer pnpm, fallback to npm)
check_package_manager() {
    print_status "Verificando o gerenciador de pacotes..."
    
    # Check for pnpm first (project preference)
    if command -v pnpm &> /dev/null; then
        PACKAGE_MANAGER="pnpm"
        PNPM_VERSION=$(pnpm --version)
        print_success "pnpm encontrado: v$PNPM_VERSION"
        return
    fi
    
    # Fallback to npm
    if command -v npm &> /dev/null; then
        PACKAGE_MANAGER="npm"
        NPM_VERSION=$(npm --version)
        print_success "npm encontrado: v$NPM_VERSION"
        return
    fi
    
    print_error "Nenhum gerenciador de pacotes encontrado!"
    print_status "Instale o pnpm (recomendado) ou o npm"
    print_status "pnpm: npm install -g pnpm"
    print_status "npm: normalmente já vem com a instalação do Node.js"
    exit 1
}

# Check if we're in the correct directory
check_directory() {
    print_status "Verificando o diretório do projeto..."
    
    if [ ! -f "package.json" ]; then
        print_error "package.json não encontrado!"
        print_status "Execute este script a partir do diretório raiz do projeto"
        exit 1
    fi
    
    # Check for TypeScript Electron project structure
    if [ ! -f "electron/main.ts" ] && [ ! -f "dist-electron/main.js" ]; then
        print_error "Arquivo principal do Electron não encontrado!"
        print_status "Arquivos procurados: electron/main.ts ou dist-electron/main.js"
        print_status "A estrutura do projeto parece incompleta"
        exit 1
    fi
    
    if [ ! -f "vite.config.ts" ]; then
        print_error "vite.config.ts não encontrado!"
        print_status "Este não parece ser um projeto Electron baseado em Vite"
        exit 1
    fi
    
    print_success "A estrutura do projeto está correta"
}

# Install dependencies
install_dependencies() {
    print_status "Verificando as dependências..."
    
    if [ ! -d "node_modules" ]; then
        print_status "Instalando as dependências... (isso pode levar alguns minutos)"
        
        # Use the detected package manager
        if $PACKAGE_MANAGER install; then
            print_success "Dependências instaladas com sucesso"
        else
            print_error "Não foi possível instalar as dependências"
            print_status "Tente executar: $PACKAGE_MANAGER install"
            print_status "Ou exclua a pasta node_modules e os arquivos de lock e tente novamente"
            exit 1
        fi
    else
        print_success "As dependências já estão instaladas"
        
        # Check if we need to update (only for npm, pnpm has different syntax)
        if [ "$PACKAGE_MANAGER" = "npm" ] && npm outdated --parseable 2>/dev/null | grep -q .; then
            print_warning "Algumas dependências podem estar desatualizadas"
            print_status "Execute '$PACKAGE_MANAGER update' para atualizá-las"
        fi
    fi
}

# Check for native dependencies (sqlite3)
check_native_deps() {
    print_status "Verificando as dependências nativas..."
    
    if [ ! -d "node_modules/sqlite3" ]; then
        print_warning "sqlite3 não encontrado em node_modules"
        print_status "Isso pode causar problemas. Reinstalando as dependências..."
        rm -rf node_modules
        if [ -f "pnpm-lock.yaml" ]; then
            rm -f pnpm-lock.yaml
        fi
        if [ -f "package-lock.json" ]; then
            rm -f package-lock.json
        fi
        $PACKAGE_MANAGER install
        return
    fi
    
    # Check if sqlite3 binary exists for current platform
    PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    # Map architecture names
    case "$ARCH" in
        x86_64) ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
    esac
    
    SQLITE_BINDING="node_modules/sqlite3/lib/binding/napi-v6-${PLATFORM}-${ARCH}/node_sqlite3.node"
    
    if [ ! -f "$SQLITE_BINDING" ]; then
        print_warning "Binário do sqlite3 não encontrado para $PLATFORM-$ARCH. Recompilando..."
        $PACKAGE_MANAGER rebuild sqlite3
    fi
    
    print_success "Verificação das dependências nativas concluída"
}

# Create necessary directories
create_directories() {
    print_status "Criando os diretórios necessários..."
    
    mkdir -p assets
    mkdir -p src/database
    mkdir -p src/renderer
    mkdir -p scripts
    
    print_success "Diretórios criados"
}

# Set environment variables for development
set_dev_env() {
    print_status "Configurando o ambiente de desenvolvimento..."
    
    # Set NODE_ENV if not already set
    if [ -z "$NODE_ENV" ]; then
        export NODE_ENV=development
    fi
    
    # Enable Electron debugging if requested
    if [ "$1" = "--debug" ]; then
        export ELECTRON_ENABLE_LOGGING=1
        export ELECTRON_ENABLE_STACK_DUMPING=1
        export ENABLE_DEV_TOOLS=true
        print_status "Modo de depuração ativado - o DevTools abrirá automaticamente"
    else
        print_status "DevTools desativado por padrão - use Ctrl+Shift+I ou F12 para abrir/fechar"
    fi
    
    print_success "Ambiente configurado"
}

# Start the application
start_app() {
    print_status "Iniciando o Prompt Studio..."
    print_status "Isso vai iniciar o servidor de desenvolvimento do Vite e o Electron"
    print_status "Pressione Ctrl+C para encerrar o aplicativo"
    echo ""
    
    # Use the correct development command for Electron + Vite
    $PACKAGE_MANAGER run electron:dev
}

# Main execution
main() {
    echo ""
    print_status "Iniciando as verificações preliminares..."
    
    check_node
    check_package_manager
    check_directory
    create_directories
    install_dependencies
    check_native_deps
    set_dev_env "$1"
    
    echo ""
    print_success "Todas as verificações passaram! 🎉"
    echo ""
    
    start_app
}

# Handle script arguments
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Prompt Studio - Modo de desenvolvimento"
    echo ""
    echo "Uso: $0 [opções]"
    echo ""
    echo "Opções:"
    echo "  --help, -h    Mostra esta mensagem de ajuda"
    echo "  --debug       Ativa o modo de depuração com logs adicionais"
    echo ""
    echo "Este script vai:"
    echo "  1. Verificar a instalação do Node.js e do gerenciador de pacotes (pnpm é o preferido)"
    echo "  2. Verificar a estrutura do projeto TypeScript + Electron + Vite"
    echo "  3. Instalar as dependências, se necessário"
    echo "  4. Verificar as dependências nativas (sqlite3)"
    echo "  5. Iniciar o aplicativo em modo de desenvolvimento (Vite + Electron)"
    echo ""
    exit 0
fi

# Trap Ctrl+C and cleanup
trap 'print_status "Encerrando..."; exit 0' INT

# Run main function
main "$1"