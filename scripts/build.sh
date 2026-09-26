#!/bin/bash

# Prompt Studio Production Build Script (Unix/macOS/Linux)
# This script creates optimized, architecture-specific distributable packages

set -e  # Exit on any error

echo "📦 Prompt Studio - Build de produção"
echo "===================================="

# Global variables
PACKAGE_MANAGER=""
PLATFORM=""
ARCH=""
OS=""
BUILD_TARGET=""
ELECTRON_ARCH=""

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

# Detect platform and architecture with enhanced support
detect_platform() {
    print_status "Detectando a plataforma e a arquitetura..."
    
    PLATFORM=$(uname -s)
    ARCH=$(uname -m)
    
    # Normalize architecture names
    case "$ARCH" in
        x86_64|amd64) 
            ARCH="x64"
            ELECTRON_ARCH="x64"
            ;;
        aarch64|arm64) 
            ARCH="arm64"
            ELECTRON_ARCH="arm64"
            ;;
        i386|i686) 
            ARCH="ia32"
            ELECTRON_ARCH="ia32"
            ;;
        armv7l) 
            ARCH="armv7l"
            ELECTRON_ARCH="armv7l"
            ;;
        *)
            print_warning "Arquitetura desconhecida: $ARCH. Usando x64 como padrão"
            ARCH="x64"
            ELECTRON_ARCH="x64"
            ;;
    esac
    
    case $PLATFORM in
        Darwin)
            OS="macOS"
            BUILD_TARGET="mac"
            print_success "Plataforma: macOS ($ARCH)"
            ;;
        Linux)
            OS="Linux"
            BUILD_TARGET="linux"
            print_success "Plataforma: Linux ($ARCH)"
            ;;
        CYGWIN*|MINGW*|MSYS*)
            OS="Windows"
            BUILD_TARGET="win"
            print_success "Plataforma: Windows ($ARCH)"
            print_warning "Considere usar o build.ps1 para um suporte melhor ao Windows"
            ;;
        *)
            print_error "Plataforma não suportada: $PLATFORM"
            exit 1
            ;;
    esac
}

# Check prerequisites with enhanced package manager detection
check_prerequisites() {
    print_status "Verificando os pré-requisitos..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "O Node.js não está instalado!"
        print_status "Instale o Node.js em https://nodejs.org/"
        print_status "Versão recomendada: 18.x ou superior"
        exit 1
    fi
    
    NODE_VERSION=$(node --version)
    print_success "Node.js: $NODE_VERSION"
    
    # Check Node version (require v16+)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    if [ "$NODE_MAJOR" -lt 16 ]; then
        print_warning "A versão do Node.js é anterior à recomendada (v16+)"
        print_status "Sua versão: $NODE_VERSION"
        print_status "Considere atualizar para garantir a melhor compatibilidade"
    fi
    
    # Check package manager (prefer pnpm, fallback to npm)
    print_status "Detectando o gerenciador de pacotes..."
    if command -v pnpm &> /dev/null; then
        PACKAGE_MANAGER="pnpm"
        PKG_VERSION=$(pnpm --version)
        print_success "pnpm encontrado: v$PKG_VERSION"
    elif command -v npm &> /dev/null; then
        PACKAGE_MANAGER="npm"
        PKG_VERSION=$(npm --version)
        print_success "npm encontrado: v$PKG_VERSION"
    else
        print_error "Nenhum gerenciador de pacotes encontrado!"
        print_status "Instale o pnpm (recomendado) ou o npm"
        print_status "pnpm: npm install -g pnpm"
        print_status "npm: normalmente já vem com a instalação do Node.js"
        exit 1
    fi
    
    # Check project structure
    if [ ! -f "package.json" ]; then
        print_error "package.json não encontrado! Execute a partir da raiz do projeto."
        exit 1
    fi
    
    # Check for TypeScript Electron project structure
    if [ ! -f "electron/main.ts" ]; then
        print_error "electron/main.ts não encontrado! A estrutura do projeto TypeScript + Electron está incompleta."
        exit 1
    fi
    
    if [ ! -f "vite.config.ts" ]; then
        print_error "vite.config.ts não encontrado! Este não parece ser um projeto baseado em Vite."
        exit 1
    fi
    
    print_success "Pré-requisitos verificados com sucesso"
}

# Clean previous builds and electron cache
clean_build() {
    print_status "Limpando os builds anteriores e o cache do Electron..."
    
    # Remove build directories
    if [ -d "dist" ]; then
        rm -rf dist
        print_status "Diretório dist antigo removido"
    fi
    
    if [ -d "build" ]; then
        rm -rf build
        print_status "Diretório build antigo removido"
    fi
    
    if [ -d "dist-electron" ]; then
        rm -rf dist-electron
        print_status "Diretório dist-electron antigo removido"
    fi
    
    # Clean electron cache for architecture consistency
    print_status "Limpando o cache do Electron para manter a consistência da arquitetura..."
    
    # Clean npm/pnpm cache for electron
    if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
        pnpm store prune || true
        print_status "Store do pnpm limpa"
    else
        npm cache clean --force || true
        print_status "Cache do npm limpo"
    fi
    
    # Clean electron cache directories
    ELECTRON_CACHE_DIRS=(
        "$HOME/.cache/electron"
        "$HOME/.electron"
        "$HOME/Library/Caches/electron" # macOS
        "$HOME/AppData/Local/electron/Cache" # Windows
    )
    
    for cache_dir in "${ELECTRON_CACHE_DIRS[@]}"; do
        if [ -d "$cache_dir" ]; then
            rm -rf "$cache_dir"
            print_status "Cache do Electron limpo: $cache_dir"
        fi
    done
    
    print_success "Diretórios de build e caches limpos"
}

# Install/update dependencies with architecture awareness
install_dependencies() {
    print_status "Instalando/atualizando as dependências..."
    
    # Clean install for production if requested
    if [ "$1" = "--clean" ]; then
        print_status "Fazendo uma instalação limpa..."
        rm -rf node_modules
        if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
            rm -f pnpm-lock.yaml
        else
            rm -f package-lock.json
        fi
    fi
    
    # Install all dependencies (production and dev needed for building)
    if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
        pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    else
        npm ci 2>/dev/null || npm install
    fi
    
    print_success "Dependências instaladas"
    
    # Check for outdated packages
    if [ "$PACKAGE_MANAGER" = "npm" ] && npm outdated --parseable 2>/dev/null | grep -q .; then
        print_warning "Algumas dependências podem estar desatualizadas"
        print_status "Execute '$PACKAGE_MANAGER update' para atualizá-las"
    fi
}

# Rebuild native modules for specific architecture
rebuild_native() {
    print_status "Recompilando os módulos nativos para a arquitetura $ARCH..."
    
    # Force rebuild for current architecture
    export npm_config_target_arch=$ELECTRON_ARCH
    export npm_config_target_platform=$(echo $PLATFORM | tr '[:upper:]' '[:lower:]')
    export npm_config_cache=/tmp/.npm
    
    # Rebuild sqlite3 specifically for current architecture
    if [ -d "node_modules/sqlite3" ]; then
        print_status "Recompilando o sqlite3 para $ELECTRON_ARCH..."
        if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
            pnpm rebuild sqlite3
        else
            npm rebuild sqlite3 --target_arch=$ELECTRON_ARCH
        fi
        print_success "sqlite3 recompilado para a arquitetura $ELECTRON_ARCH"
    fi
    
    # Rebuild all native modules
    if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
        pnpm rebuild
    else
        npm rebuild
    fi
    
    print_success "Módulos nativos recompilados para a arquitetura $ELECTRON_ARCH"
}

# Create platform-specific app icons
create_platform_icons() {
    print_status "Verificando e criando os ícones específicos da plataforma..."
    
    if [ ! -f "assets/icon.png" ]; then
        print_warning "Ícone base não encontrado. Criando um ícone padrão..."
        
        # Create a simple default icon (requires ImageMagick)
        if command -v convert &> /dev/null; then
            mkdir -p assets
            convert -size 256x256 xc:transparent -fill "#007acc" -draw "circle 128,128 128,64" assets/icon.png
            print_success "Ícone padrão criado"
        else
            print_warning "ImageMagick não encontrado. Pulando a criação do ícone"
            print_status "Adicione um ícone PNG de 256x256 em assets/icon.png"
        fi
    else
        print_success "Ícone base do app encontrado"
    fi
    
    # Create platform-specific icons
    case $OS in
        macOS)
            if [ ! -f "assets/icon.icns" ]; then
                if command -v iconutil &> /dev/null && [ -f "assets/icon.png" ]; then
                    print_status "Criando o ícone do macOS (.icns)..."
                    mkdir -p assets/icon.iconset
                    
                    # Create different sizes for iconset
                    sips -z 16 16 assets/icon.png --out assets/icon.iconset/icon_16x16.png >/dev/null 2>&1
                    sips -z 32 32 assets/icon.png --out assets/icon.iconset/icon_16x16@2x.png >/dev/null 2>&1
                    sips -z 32 32 assets/icon.png --out assets/icon.iconset/icon_32x32.png >/dev/null 2>&1
                    sips -z 64 64 assets/icon.png --out assets/icon.iconset/icon_32x32@2x.png >/dev/null 2>&1
                    sips -z 128 128 assets/icon.png --out assets/icon.iconset/icon_128x128.png >/dev/null 2>&1
                    sips -z 256 256 assets/icon.png --out assets/icon.iconset/icon_128x128@2x.png >/dev/null 2>&1
                    sips -z 256 256 assets/icon.png --out assets/icon.iconset/icon_256x256.png >/dev/null 2>&1
                    sips -z 512 512 assets/icon.png --out assets/icon.iconset/icon_256x256@2x.png >/dev/null 2>&1
                    sips -z 512 512 assets/icon.png --out assets/icon.iconset/icon_512x512.png >/dev/null 2>&1
                    sips -z 1024 1024 assets/icon.png --out assets/icon.iconset/icon_512x512@2x.png >/dev/null 2>&1
                    
                    iconutil -c icns assets/icon.iconset >/dev/null 2>&1
                    rm -rf assets/icon.iconset
                    print_success "Ícone do macOS (.icns) criado"
                fi
            else
                print_success "Ícone do macOS (.icns) encontrado"
            fi
            ;;
        Windows)
            if [ ! -f "assets/icon.ico" ] && [ -f "assets/icon.png" ]; then
                if command -v convert &> /dev/null; then
                    print_status "Criando o ícone do Windows (.ico)..."
                    convert assets/icon.png -resize 256x256 assets/icon.ico
                    print_success "Ícone do Windows (.ico) criado"
                else
                    print_warning "ImageMagick não encontrado. Não é possível criar o arquivo .ico"
                fi
            else
                print_success "Ícone do Windows (.ico) encontrado ou PNG base ausente"
            fi
            ;;
        Linux)
            # Linux uses PNG, no conversion needed
            print_success "O Linux usa o ícone PNG (nenhuma conversão necessária)"
            ;;
    esac
}

# Run tests if available
run_tests() {
    if [ "$SKIP_TESTS" != "true" ]; then
        print_status "Executando os testes..."
        
        if $PACKAGE_MANAGER run test --if-present; then
            print_success "Todos os testes passaram"
        else
            print_warning "Os testes falharam ou não estão disponíveis"
            if [ "$FORCE_BUILD" != "true" ]; then
                read -p "Continuar com o build? (y = sim / N = não): " -n 1 -r
                echo
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    print_error "Build cancelado devido a falhas nos testes"
                    exit 1
                fi
            fi
        fi
    else
        print_status "Pulando os testes (SKIP_TESTS=true)"
    fi
}

# Build optimized, architecture-specific packages
build_app() {
    print_status "Gerando o build do aplicativo para $OS ($ELECTRON_ARCH)..."
    
    # Set build environment
    export NODE_ENV=production
    export ELECTRON_BUILDER_ARCH=$ELECTRON_ARCH
    
    print_status "Pacotes que serão gerados para $OS:"
    case $BUILD_TARGET in
        mac)
            print_status "  • Instalador DMG (Universal: arm64 + x64)"
            print_status "  • Arquivo ZIP (Universal: arm64 + x64)"
            $PACKAGE_MANAGER run build:mac
            ;;
        linux)
            print_status "  • AppImage (portátil)"
            print_status "  • Pacote DEB"
            $PACKAGE_MANAGER run build:linux
            ;;
        win)
            print_status "  • Instalador NSIS"
            print_status "  • Executável portátil"
            $PACKAGE_MANAGER run build:win
            ;;
        *)
            print_status "  • Build padrão da plataforma"
            $PACKAGE_MANAGER run build
            ;;
    esac
    
    if [ $? -eq 0 ]; then
        print_success "Build concluído com sucesso!"
    else
        print_error "Falha no build!"
        exit 1
    fi
}

# Show detailed build results
show_results() {
    print_status "Resultados do build:"
    echo ""
    
    if [ -d "dist" ]; then
        print_success "Pacotes gerados:"
        
        case $OS in
            macOS)
                echo "  📦 Pacotes para macOS:"
                ls -lh dist/*.dmg 2>/dev/null | while read -r line; do
                    echo "    DMG: $(echo $line | awk '{print $9 " (" $5 ")"}')"
                done
                ls -lh dist/*.zip 2>/dev/null | while read -r line; do
                    echo "    ZIP: $(echo $line | awk '{print $9 " (" $5 ")"}')"
                done
                ;;
            Linux)
                echo "  🐧 Pacotes para Linux:"
                ls -lh dist/*.AppImage 2>/dev/null | while read -r line; do
                    echo "    AppImage: $(echo $line | awk '{print $9 " (" $5 ")"}')"
                done
                ls -lh dist/*.deb 2>/dev/null | while read -r line; do
                    echo "    DEB: $(echo $line | awk '{print $9 " (" $5 ")"}')"
                done
                ;;
            Windows)
                echo "  🪟 Pacotes para Windows:"
                ls -lh dist/*.exe 2>/dev/null | while read -r line; do
                    echo "    EXE: $(echo $line | awk '{print $9 " (" $5 ")"}')"
                done
                ls -lh dist/*.msi 2>/dev/null | while read -r line; do
                    echo "    MSI: $(echo $line | awk '{print $9 " (" $5 ")"}')"
                done
                ;;
        esac
        
        echo ""
        print_status "Tamanho total do build:"
        du -sh dist/ 2>/dev/null | awk '{print "  " $1}'
        
        echo ""
        print_success "Artefatos do build salvos em: $(pwd)/dist/"
    else
        print_warning "Diretório dist não encontrado - o build pode ter falhado"
    fi
}

# Platform-specific installation instructions
show_install_instructions() {
    echo ""
    print_status "Instruções de instalação:"
    
    case $OS in
        macOS)
            echo "  📱 Para instalar no macOS:"
            echo "    • Macs com Intel: use Prompt Studio-1.0.0.dmg"
            echo "    • Apple Silicon: use Prompt Studio-1.0.0-arm64.dmg"
            echo "    • Abra o arquivo DMG e arraste o app para a pasta Aplicativos"
            ;;
        Linux)
            echo "  🐧 Para instalar no Linux:"
            echo "    • AppImage: chmod +x *.AppImage && ./Prompt-Studio-1.0.0.AppImage"
            echo "    • Pacote DEB: sudo dpkg -i *.deb"
            ;;
        Windows)
            echo "  🪟 Para instalar no Windows:"
            echo "    • Execute o instalador .exe para uma instalação guiada"
            echo "    • Ou use a versão portátil (não requer instalação)"
            ;;
    esac
}

# Code signing (macOS only)
sign_app() {
    if [ "$OS" = "macOS" ] && [ -n "$CODESIGN_IDENTITY" ]; then
        print_status "Assinando o código do aplicativo..."
        
        find dist -name "*.app" -type d | while read -r app_path; do
            if [ -n "$app_path" ]; then
                codesign --force --deep --sign "$CODESIGN_IDENTITY" "$app_path"
                print_success "Assinado: $app_path"
            fi
        done
    elif [ "$OS" = "macOS" ]; then
        print_warning "Assinatura de código ignorada (CODESIGN_IDENTITY não definida)"
        print_status "Defina a variável de ambiente CODESIGN_IDENTITY para assinar o código"
    fi
}

# Notarization (macOS only)
notarize_app() {
    if [ "$OS" = "macOS" ] && [ -n "$APPLE_ID" ] && [ -n "$APPLE_ID_PASS" ]; then
        print_status "Notarizando os aplicativos (isso pode levar vários minutos)..."
        
        find dist -name "*.dmg" | while read -r dmg_path; do
            if [ -n "$dmg_path" ]; then
                print_status "Notarizando: $dmg_path"
                xcrun notarytool submit "$dmg_path" \
                    --apple-id "$APPLE_ID" \
                    --password "$APPLE_ID_PASS" \
                    --team-id "$TEAM_ID" \
                    --wait
                print_success "Notarização enviada para: $dmg_path"
            fi
        done
    elif [ "$OS" = "macOS" ]; then
        print_warning "Notarização ignorada (APPLE_ID ou APPLE_ID_PASS ausente)"
        print_status "Defina APPLE_ID, APPLE_ID_PASS e TEAM_ID para a notarização"
    fi
}

# Main execution
main() {
    echo ""
    print_status "Iniciando o processo de build otimizado..."
    
    detect_platform
    check_prerequisites
    clean_build
    install_dependencies "$1"
    rebuild_native
    create_platform_icons
    run_tests
    build_app
    sign_app
    notarize_app
    show_results
    show_install_instructions
    
    echo ""
    print_success "🎉 Processo de build otimizado para a arquitetura concluído!"
    print_status "Plataforma: $OS ($ELECTRON_ARCH)"
    print_status "Gerenciador de pacotes: $PACKAGE_MANAGER"
    echo ""
}

# Handle script arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            echo "Prompt Studio - Build de produção"
            echo ""
            echo "Uso: $0 [opções]"
            echo ""
            echo "Opções:"
            echo "  --help, -h     Mostra esta mensagem de ajuda"
            echo "  --clean        Faz uma instalação limpa das dependências"
            echo "  --skip-tests   Pula a execução dos testes"
            echo "  --force        Força o build mesmo se os testes falharem"
            echo ""
            echo "Variáveis de ambiente:"
            echo "  CODESIGN_IDENTITY  Identidade de assinatura de código para macOS"
            echo "  APPLE_ID          Apple ID para a notarização"
            echo "  APPLE_ID_PASS     Senha de app específica do Apple ID"
            echo "  TEAM_ID           ID da equipe no Apple Developer"
            echo "  SKIP_TESTS        Pula os testes (defina como 'true')"
            echo "  FORCE_BUILD       Força o build mesmo com falhas nos testes"
            echo ""
            echo "Plataformas suportadas:"
            echo "  macOS: DMG e ZIP (arm64 para Apple Silicon, x64 para Intel)"
            echo "  Linux: pacotes AppImage e DEB"
            echo "  Windows: instalador NSIS e exe portátil (via WSL/MinGW)"
            echo ""
            exit 0
            ;;
        --clean)
            CLEAN_INSTALL="true"
            shift
            ;;
        --skip-tests)
            export SKIP_TESTS="true"
            shift
            ;;
        --force)
            export FORCE_BUILD="true"
            shift
            ;;
        *)
            print_error "Opção desconhecida: $1"
            print_status "Use --help para ver as instruções de uso"
            exit 1
            ;;
    esac
done

# Trap Ctrl+C and cleanup
trap 'print_status "Build cancelado pelo usuário"; exit 1' INT

# Run main function
main "$CLEAN_INSTALL"