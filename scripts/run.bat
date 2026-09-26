@echo off
chcp 65001 >nul
REM Prompt Studio Development Runner (Windows)
REM This script checks dependencies, installs them if needed, and starts the app

setlocal enabledelayedexpansion

REM Always run from the project root (the folder above scripts\), even when double-clicked
cd /d "%~dp0.."

echo.
echo ^🚀 Prompt Studio - Modo de desenvolvimento
echo ==========================================

REM Function to print colored output (Windows doesn't support colors in batch easily)
set "INFO_PREFIX=[INFO]"
set "SUCCESS_PREFIX=[SUCESSO]"
set "WARNING_PREFIX=[AVISO]"
set "ERROR_PREFIX=[ERRO]"

REM Check if Node.js is installed
echo %INFO_PREFIX% Verificando a instalação do Node.js...

node --version >nul 2>&1
if !errorlevel! neq 0 (
    echo %ERROR_PREFIX% O Node.js não está instalado
    echo %INFO_PREFIX% Instale o Node.js em https://nodejs.org/
    echo %INFO_PREFIX% Versão recomendada: 18.x ou superior
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo %SUCCESS_PREFIX% Node.js encontrado: !NODE_VERSION!

REM Extract major version number
for /f "tokens=1 delims=." %%a in ("!NODE_VERSION:~1!") do set NODE_MAJOR=%%a
if !NODE_MAJOR! lss 16 (
    echo %WARNING_PREFIX% A versão do Node.js é anterior à recomendada ^(v16+^)
    echo %INFO_PREFIX% Sua versão: !NODE_VERSION!
    echo %INFO_PREFIX% Considere atualizar para garantir a melhor compatibilidade
)

REM Check package manager (prefer pnpm, fallback to npm)
echo %INFO_PREFIX% Verificando o gerenciador de pacotes...

call pnpm --version >nul 2>&1
if !errorlevel! equ 0 (
    set "PACKAGE_MANAGER=pnpm"
    for /f "tokens=*" %%i in ('pnpm --version') do set PKG_VERSION=%%i
    echo %SUCCESS_PREFIX% pnpm encontrado: v!PKG_VERSION!
    goto :package_manager_found
)

call npm --version >nul 2>&1
if !errorlevel! equ 0 (
    set "PACKAGE_MANAGER=npm"
    for /f "tokens=*" %%i in ('npm --version') do set PKG_VERSION=%%i
    echo %SUCCESS_PREFIX% npm encontrado: v!PKG_VERSION!
    goto :package_manager_found
)

echo %ERROR_PREFIX% Nenhum gerenciador de pacotes encontrado
echo %INFO_PREFIX% Instale o pnpm (recomendado) ou o npm
echo %INFO_PREFIX% pnpm: npm install -g pnpm
echo %INFO_PREFIX% npm: normalmente já vem com a instalação do Node.js
pause
exit /b 1

:package_manager_found

REM Check if we're in the correct directory
echo %INFO_PREFIX% Verificando o diretório do projeto...

if not exist "package.json" (
    echo %ERROR_PREFIX% package.json não encontrado
    echo %INFO_PREFIX% Execute este script a partir do diretório raiz do projeto
    pause
    exit /b 1
)

REM Check for TypeScript Electron project structure
if not exist "electron\main.ts" (
    if not exist "dist-electron\main.js" (
        echo %ERROR_PREFIX% Arquivo principal do Electron não encontrado
        echo %INFO_PREFIX% Arquivos procurados: electron\main.ts ou dist-electron\main.js
        echo %INFO_PREFIX% A estrutura do projeto parece incompleta
        pause
        exit /b 1
    )
)

if not exist "vite.config.ts" (
    echo %ERROR_PREFIX% vite.config.ts não encontrado
    echo %INFO_PREFIX% Este não parece ser um projeto Electron baseado em Vite
    pause
    exit /b 1
)

echo %SUCCESS_PREFIX% A estrutura do projeto está correta

REM Create necessary directories
echo %INFO_PREFIX% Criando os diretórios necessários...

if not exist "assets" mkdir "assets"
if not exist "src\database" mkdir "src\database"
if not exist "src\renderer" mkdir "src\renderer"
if not exist "scripts" mkdir "scripts"

echo %SUCCESS_PREFIX% Diretórios criados

REM Install dependencies
echo %INFO_PREFIX% Verificando as dependências...

if not exist "node_modules" (
    echo %INFO_PREFIX% Instalando as dependências... ^(isso pode levar alguns minutos^)
    
    call %PACKAGE_MANAGER% install
    if !errorlevel! neq 0 (
        echo %ERROR_PREFIX% Não foi possível instalar as dependências
        echo %INFO_PREFIX% Tente executar: %PACKAGE_MANAGER% install
        echo %INFO_PREFIX% Ou exclua a pasta node_modules e os arquivos de lock e tente novamente
        pause
        exit /b 1
    )
    
    echo %SUCCESS_PREFIX% Dependências instaladas com sucesso
) else (
    echo %SUCCESS_PREFIX% As dependências já estão instaladas
    
    REM Check for outdated packages (only for npm)
    if "%PACKAGE_MANAGER%"=="npm" (
        call npm outdated >nul 2>&1
        if !errorlevel! neq 0 (
            echo %WARNING_PREFIX% Algumas dependências podem estar desatualizadas
            echo %INFO_PREFIX% Execute '%PACKAGE_MANAGER% update' para atualizá-las
        )
    )
)

REM Check for native dependencies (sqlite3)
echo %INFO_PREFIX% Verificando as dependências nativas...

if not exist "node_modules\sqlite3" (
    echo %WARNING_PREFIX% sqlite3 não encontrado em node_modules
    echo %INFO_PREFIX% Isso pode causar problemas. Reinstalando as dependências...
    rmdir /s /q "node_modules" >nul 2>&1
    del "package-lock.json" >nul 2>&1
    del "pnpm-lock.yaml" >nul 2>&1
    call %PACKAGE_MANAGER% install
    goto :continue_native_check
)

REM Check if sqlite3 binary exists (Windows specific paths)
set "SQLITE_FOUND=0"
if exist "node_modules\sqlite3\lib\binding\napi-v6-win32-x64\node_sqlite3.node" set "SQLITE_FOUND=1"
if exist "node_modules\sqlite3\lib\binding\napi-v6-win32-ia32\node_sqlite3.node" set "SQLITE_FOUND=1"
if exist "node_modules\sqlite3\build\Release\node_sqlite3.node" set "SQLITE_FOUND=1"

if !SQLITE_FOUND! equ 0 (
    echo %WARNING_PREFIX% Binário do sqlite3 não encontrado. Recompilando...
    call %PACKAGE_MANAGER% rebuild sqlite3
)

:continue_native_check
echo %SUCCESS_PREFIX% Verificação das dependências nativas concluída

REM Set environment variables for development
echo %INFO_PREFIX% Configurando o ambiente de desenvolvimento...

if "%NODE_ENV%"=="" set NODE_ENV=development

REM Enable Electron debugging if requested
if "%1"=="--debug" (
    set ELECTRON_ENABLE_LOGGING=1
    set ELECTRON_ENABLE_STACK_DUMPING=1
    set ENABLE_DEV_TOOLS=true
    echo %INFO_PREFIX% Modo de depuração ativado - o DevTools abrirá automaticamente
) else (
    echo %INFO_PREFIX% DevTools desativado por padrão - use Ctrl+Shift+I ou F12 para abrir/fechar
)

echo %SUCCESS_PREFIX% Ambiente configurado

echo.
echo %SUCCESS_PREFIX% Todas as verificações passaram 🎉
echo.

REM Start the application
echo %INFO_PREFIX% Iniciando o Prompt Studio...
echo %INFO_PREFIX% Pressione Ctrl+C para encerrar o aplicativo
echo.

REM Start the application using the correct Electron + Vite development command
call %PACKAGE_MANAGER% run electron:dev

if !errorlevel! neq 0 (
    echo.
    echo %ERROR_PREFIX% Não foi possível iniciar o aplicativo
    echo %INFO_PREFIX% Confira as mensagens de erro acima para mais detalhes
    pause
    exit /b 1
)

REM Handle help argument
:help
if "%1"=="--help" goto :show_help
if "%1"=="-h" goto :show_help
goto :eof

:show_help
echo Prompt Studio - Modo de desenvolvimento
echo.
echo Uso: %0 [opções]
echo.
echo Opções:
echo   --help, -h    Mostra esta mensagem de ajuda
echo   --debug       Ativa o modo de depuração com logs adicionais
echo.
echo Este script vai:
echo   1. Verificar a instalação do Node.js e do gerenciador de pacotes (pnpm é o preferido)
echo   2. Verificar a estrutura do projeto TypeScript + Electron + Vite
echo   3. Instalar as dependências, se necessário
echo   4. Verificar as dependências nativas (sqlite3)
echo   5. Iniciar o aplicativo em modo de desenvolvimento (Vite + Electron)
echo.
pause
exit /b 0

endlocal
