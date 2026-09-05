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
  server: {
    fs: {
      // Permite importar arquivos de fora da raiz do projeto (../desktop-app) -
      // Vite restringe isso por padrao no modo dev.
      allow: ['..']
    }
  }
})
