import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Reusa os componentes/logica de ../desktop-app/src/renderer/src (App.tsx,
// PadGrid, PadEditor, FirmwareManager, protocol, mockDevice, firmwareCheck,
// webDrumCore, styles.css) sem duplicar nada - a unica diferenca entre o
// build Electron e este e' qual implementacao de DrumCoreApi fica em
// window.drumCore (ver src/main.tsx aqui vs desktop-app/src/preload/index.ts).
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    // Sem isso, App.tsx/FirmwareManager.tsx (fisicamente dentro de
    // desktop-app/) resolvem "react"/"react-dom" a partir de
    // desktop-app/node_modules (resolucao sobe a partir do arquivo que
    // importa), enquanto src/main.tsx aqui resolve do
    // web-app/node_modules - DUAS copias de React no mesmo bundle,
    // causa classica de "Invalid hook call" (pagina em branco, sem
    // erro visivel fora do console). Forca todo mundo a usar a copia
    // daqui, seja qual for o arquivo que importou.
    alias: {
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'esptool-js': resolve(__dirname, 'node_modules/esptool-js')
    }
  },
  server: {
    fs: {
      // Permite importar arquivos de fora da raiz do projeto (../desktop-app) -
      // Vite restringe isso por padrao no modo dev.
      allow: ['..']
    }
  }
})
