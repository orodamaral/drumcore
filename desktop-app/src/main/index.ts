import { app, BrowserWindow, ipcMain } from 'electron'
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
  createWindow()

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
