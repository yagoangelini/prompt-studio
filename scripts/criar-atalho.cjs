// Windows: creates the "Prompt Studio" shortcut that opens the app without a terminal window.
// Runs inside Electron (npm run atalho): it needs nativeImage (icon) and shell.writeShortcutLink.
//  1. Generates assets/icon.ico from assets/icon.png (16 to 256 px), if it does not exist yet
//  2. Writes "Prompt Studio.lnk" on the Desktop and in the project folder, pointing to electron.exe
//     with the project folder, the icon and the same AppUserModelID as the app (electron/main.ts),
//     so the pinned taskbar button and the running window are the same button
const { app, nativeImage, shell } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const APP_USER_MODEL_ID = 'com.promptstudio.app'
const PROJECT = path.resolve(__dirname, '..')
const ICON_PNG = path.join(PROJECT, 'assets', 'icon.png')
const ICON_ICO = path.join(PROJECT, 'assets', 'icon.ico')
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

// This helper must not create an "Electron" folder with the user's data
app.setPath('userData', path.join(os.tmpdir(), 'prompt-studio-criar-atalho'))

// ICO with PNG entries (supported since Windows Vista)
function writeIco(target) {
  const source = nativeImage.createFromPath(ICON_PNG)
  if (source.isEmpty()) throw new Error(`Não foi possível ler ${ICON_PNG}`)
  const images = ICO_SIZES.map((size) => source.resize({ width: size, height: size, quality: 'best' }).toPNG())
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let offset = header.length + entries.length
  images.forEach((png, index) => {
    const size = ICO_SIZES[index]
    const entry = index * 16
    entries.writeUInt8(size >= 256 ? 0 : size, entry)
    entries.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    entries.writeUInt8(0, entry + 2)
    entries.writeUInt8(0, entry + 3)
    entries.writeUInt16LE(1, entry + 4)
    entries.writeUInt16LE(32, entry + 6)
    entries.writeUInt32LE(png.length, entry + 8)
    entries.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  fs.writeFileSync(target, Buffer.concat([header, entries, ...images]))
}

function writeShortcut(file) {
  const ok = shell.writeShortcutLink(file, 'create', {
    target: process.execPath,
    args: `"${PROJECT}"`,
    cwd: PROJECT,
    description: 'Biblioteca de prompts: abre o Prompt Studio sem janela de terminal',
    icon: ICON_ICO,
    iconIndex: 0,
    appUserModelId: APP_USER_MODEL_ID,
  })
  if (!ok) throw new Error(`Não foi possível criar ${file}`)
  return file
}

app.whenReady().then(() => {
  try {
    if (process.platform !== 'win32') throw new Error('Este script é só para o Windows.')
    if (!fs.existsSync(path.join(PROJECT, 'dist', 'index.html')) || !fs.existsSync(path.join(PROJECT, 'dist-electron', 'main.js'))) {
      throw new Error('O app ainda não foi compilado. Rode "npm run build:app" antes.')
    }
    if (!fs.existsSync(ICON_ICO)) {
      writeIco(ICON_ICO)
      console.log(`Ícone criado: ${ICON_ICO}`)
    }
    const created = [
      writeShortcut(path.join(app.getPath('desktop'), 'Prompt Studio.lnk')),
      writeShortcut(path.join(PROJECT, 'Prompt Studio.lnk')),
    ]
    for (const file of created) console.log(`Atalho criado: ${file}`)
    console.log('\nPara fixar na barra de tarefas: clique com o botão direito no atalho da Área de Trabalho >')
    console.log('"Mostrar mais opções" > "Fixar na barra de tarefas" (ou abra o app e fixe o botão dele).')
    app.exit(0)
  } catch (error) {
    console.error(`ERRO: ${error instanceof Error ? error.message : error}`)
    app.exit(1)
  }
})
