@echo off
chcp 65001 >nul
REM Cria o atalho "Prompt Studio" (Área de Trabalho), que abre o app sem janela de terminal.
REM Rode de novo depois de atualizar o código, para recompilar o app.
cd /d "%~dp0.."
if not exist "node_modules" (
    echo Instalando as dependências...
    call npm install || goto :erro
)
echo Compilando o Prompt Studio e criando o atalho...
call npm run atalho || goto :erro
echo.
echo Pronto. Abra pelo atalho "Prompt Studio" na Área de Trabalho.
pause
exit /b 0
:erro
echo.
echo Não foi possível criar o atalho. Veja as mensagens acima.
pause
exit /b 1
