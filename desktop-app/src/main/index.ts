import { app, BrowserWindow, ipcMain, Menu, session } from 'electron'
import { join } from 'path'
import { SerialConnection } from './serial'

const serial = new SerialConnection()
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: 'DrumCore - Configuração',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()

  // Web Serial (usado pela aba Firmware, via esptool-js) exige que o
  // processo main resolva o picker de porta - sem esse handler,
  // navigator.serial.requestPort() no renderer trava pra sempre (Electron
  // nao tem um chooser nativo pronto pra isso, diferente do Chrome browser).
  // Simplificacao pro v1: pega a primeira porta da lista automaticamente -
  // cobre o caso comum (usuario so' tem o ESP32-S3 plugado). Se isso
  // incomodar na pratica (mais de uma porta serial disponivel), trocar por
  // um picker de verdade no renderer (listar portList via IPC e deixar o
  // usuario escolher antes de resolver o callback).
  session.defaultSession.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault()
    callback(portList.length > 0 ? portList[0].portId : '')
  })

  ipcMain.handle('serial:list-ports', () => serial.listPorts())

  ipcMain.handle('serial:connect', async (_event, path: string) => {
    if (!mainWindow) return
    await serial.connect(path, mainWindow)
  })

  ipcMain.handle('serial:disconnect', () => {
    serial.disconnect()
  })

  ipcMain.handle('serial:send', (_event, line: string) => {
    serial.send(line)
  })

  ipcMain.handle('serial:is-connected', () => serial.isConnected())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  serial.disconnect()
  if (process.platform !== 'darwin') app.quit()
})
