# Prompt Studio Production Build Script (Windows PowerShell)
# This script creates distributable packages for Windows

param(
    [switch]$Clean,
    [switch]$SkipTests,
    [switch]$Force,
    [switch]$Help
)

# Function to write colored output
function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCESSO] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[AVISO] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERRO] $Message" -ForegroundColor Red
}

function Show-Help {
    Write-Host "Prompt Studio - Build de produção (PowerShell)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Uso: .\build.ps1 [opções]" -ForegroundColor White
    Write-Host ""
    Write-Host "Opções:" -ForegroundColor White
    Write-Host "  -Help         Mostra esta mensagem de ajuda" -ForegroundColor Gray
    Write-Host "  -Clean        Faz uma instalação limpa das dependências" -ForegroundColor Gray
    Write-Host "  -SkipTests    Pula a execução dos testes" -ForegroundColor Gray
    Write-Host "  -Force        Força o build mesmo se os testes falharem" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Variáveis de ambiente:" -ForegroundColor White
    Write-Host "  `$env:SKIP_TESTS     Pula os testes (defina como 'true')" -ForegroundColor Gray
    Write-Host "  `$env:FORCE_BUILD    Força o build mesmo com falhas nos testes" -ForegroundColor Gray
    Write-Host ""
    exit 0
}

function Test-Prerequisites {
    Write-Status "Verificando os pré-requisitos..."
    
    # Check Node.js
    try {
        $nodeVersion = & node --version 2>$null
        Write-Success "Node.js: $nodeVersion"
    } catch {
        Write-Error "O Node.js não está instalado ou não está no PATH!"
        Write-Status "Instale o Node.js em https://nodejs.org/"
        exit 1
    }
    
    # Check npm
    try {
        $npmVersion = & npm --version 2>$null
        Write-Success "npm: v$npmVersion"
    } catch {
        Write-Error "O npm não está instalado ou não está no PATH!"
        exit 1
    }
    
    # Check project structure
    if (-not (Test-Path "package.json")) {
        Write-Error "package.json não encontrado! Execute a partir da raiz do projeto."
        exit 1
    }
    
    if (-not (Test-Path "main.js")) {
        Write-Error "main.js não encontrado! A estrutura do projeto está incompleta."
        exit 1
    }
    
    Write-Success "Pré-requisitos verificados com sucesso"
}

function Clear-BuildDirs {
    Write-Status "Limpando os builds anteriores..."
    
    if (Test-Path "dist") {
        Remove-Item -Recurse -Force "dist"
        Write-Status "Diretório dist antigo removido"
    }
    
    if (Test-Path "build") {
        Remove-Item -Recurse -Force "build"
        Write-Status "Diretório build antigo removido"
    }
    
    Write-Success "Diretórios de build limpos"
}

function Install-Dependencies {
    param([bool]$CleanInstall)
    
    Write-Status "Instalando/atualizando as dependências..."
    
    # Clean install for production
    if ($CleanInstall) {
        Write-Status "Fazendo uma instalação limpa..."
        if (Test-Path "node_modules") {
            Remove-Item -Recurse -Force "node_modules"
        }
        if (Test-Path "package-lock.json") {
            Remove-Item -Force "package-lock.json"
        }
    }
    
    # Install production dependencies
    Write-Status "Instalando as dependências de produção..."
    try {
        & npm ci --only=production 2>$null
    } catch {
        & npm install --only=production
    }
    
    # Install dev dependencies needed for building
    Write-Status "Instalando as dependências de desenvolvimento..."
    & npm install --only=dev
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Não foi possível instalar as dependências"
        exit 1
    }
    
    Write-Success "Dependências instaladas"
}

function Rebuild-Native {
    Write-Status "Recompilando os módulos nativos..."
    
    # Rebuild sqlite3 for current platform
    if (Test-Path "node_modules\sqlite3") {
        Write-Status "Recompilando o sqlite3..."
        & npm rebuild sqlite3
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "sqlite3 recompilado para Windows"
        } else {
            Write-Warning "Não foi possível recompilar o sqlite3"
        }
    }
    
    Write-Success "Recompilação dos módulos nativos concluída"
}

function New-AppIcon {
    Write-Status "Verificando o ícone do app..."
    
    if (-not (Test-Path "assets\icon.png")) {
        Write-Warning "Ícone não encontrado"
        Write-Status "Adicione um ícone PNG de 256x256 em assets\icon.png"
        
        # Create assets directory if it doesn't exist
        if (-not (Test-Path "assets")) {
            New-Item -ItemType Directory -Path "assets" | Out-Null
        }
    } else {
        Write-Success "Ícone do app encontrado"
    }
    
    # Create .ico file for Windows if it doesn't exist
    if ((Test-Path "assets\icon.png") -and (-not (Test-Path "assets\icon.ico"))) {
        Write-Status "Convertendo o PNG em ICO para o Windows..."
        
        # Try to use ImageMagick if available
        try {
            & convert "assets\icon.png" -resize 256x256 "assets\icon.ico" 2>$null
            Write-Success "Ícone do Windows criado"
        } catch {
            Write-Warning "ImageMagick não encontrado. Usando o PNG como alternativa"
            Write-Status "Para uma integração melhor com o Windows, instale o ImageMagick ou crie um arquivo .ico manualmente"
        }
    }
}

function Invoke-Tests {
    if ($SkipTests -or $env:SKIP_TESTS -eq "true") {
        Write-Status "Pulando os testes"
        return
    }
    
    Write-Status "Executando os testes..."
    
    try {
        & npm run test 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Todos os testes passaram"
        } else {
            Write-Warning "Os testes falharam ou não estão disponíveis"
            if (-not $Force -and $env:FORCE_BUILD -ne "true") {
                $response = Read-Host "Continuar com o build? (y = sim / N = não)"
                if ($response -notmatch "^[Yy]$") {
                    Write-Error "Build cancelado devido a falhas nos testes"
                    exit 1
                }
            }
        }
    } catch {
        Write-Warning "Nenhum script de teste encontrado"
    }
}

function Build-Application {
    Write-Status "Gerando o build do aplicativo para Windows..."
    
    # Set build environment
    $env:NODE_ENV = "production"
    
    Write-Status "Executando o electron-builder para Windows..."
    & npm run build:win
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Build concluído com sucesso!"
    } else {
        Write-Error "Falha no build!"
        exit 1
    }
}

function Show-BuildResults {
    Write-Status "Resultados do build:"
    Write-Host ""
    
    if (Test-Path "dist") {
        Write-Success "Pacotes gerados:"
        Get-ChildItem "dist" | Format-Table Name, Length, LastWriteTime -AutoSize
        
        Write-Host ""
        Write-Status "Tamanho dos pacotes:"
        Get-ChildItem "dist" | ForEach-Object {
            $size = if ($_.Length -gt 1MB) { "{0:N1} MB" -f ($_.Length / 1MB) } else { "{0:N1} KB" -f ($_.Length / 1KB) }
            Write-Host "  $($_.Name): $size" -ForegroundColor Cyan
        }
        
        Write-Host ""
        $distPath = Resolve-Path "dist"
        Write-Success "Artefatos do build salvos em: $distPath"
    } else {
        Write-Warning "Diretório dist não encontrado - o build pode ter falhado"
    }
}

function Sign-Application {
    if ($env:SIGNTOOL_PATH -and $env:CERT_THUMBPRINT) {
        Write-Status "Assinando o código do aplicativo..."
        
        $exeFiles = Get-ChildItem "dist" -Filter "*.exe" -Recurse
        foreach ($exe in $exeFiles) {
            Write-Status "Assinando $($exe.Name)..."
            & "$env:SIGNTOOL_PATH" sign /sha1 "$env:CERT_THUMBPRINT" /t "http://timestamp.digicert.com" "$($exe.FullName)"
            
            if ($LASTEXITCODE -eq 0) {
                Write-Success "$($exe.Name) assinado"
            } else {
                Write-Warning "Não foi possível assinar $($exe.Name)"
            }
        }
    } else {
        Write-Status "Assinatura de código ignorada (nenhum certificado de assinatura configurado)"
        Write-Status "Para ativar a assinatura, defina as variáveis de ambiente SIGNTOOL_PATH e CERT_THUMBPRINT"
    }
}

function Main {
    Write-Host ""
    Write-Host "📦 Prompt Studio - Build de produção (PowerShell)" -ForegroundColor Cyan
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host ""
    
    if ($Help) {
        Show-Help
    }
    
    Write-Status "Iniciando o processo de build para Windows..."
    
    try {
        Test-Prerequisites
        Clear-BuildDirs
        Install-Dependencies -CleanInstall $Clean
        Rebuild-Native
        New-AppIcon
        Invoke-Tests
        Build-Application
        Sign-Application
        Show-BuildResults
        
        Write-Host ""
        Write-Success "🎉 Processo de build concluído!"
        Write-Status "Para instalar: execute o instalador .exe da pasta dist/"
        Write-Status "Versão portátil: execute o Prompt Studio.exe diretamente"
        Write-Host ""
        
    } catch {
        Write-Error "Falha no processo de build: $($_.Exception.Message)"
        Write-Host $_.ScriptStackTrace -ForegroundColor Red
        exit 1
    }
}

# Handle Ctrl+C
try {
    Main
} catch [System.Management.Automation.PipelineStoppedException] {
    Write-Status "Build cancelado pelo usuário"
    exit 1
}