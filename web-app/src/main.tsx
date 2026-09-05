import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../../desktop-app/src/renderer/src/App'
import { installWebDrumCore } from '../../desktop-app/src/renderer/src/webDrumCore'
import '../../desktop-app/src/renderer/src/styles.css'

const root = document.getElementById('root')!

if (!('serial' in navigator)) {
  root.innerHTML = `
    <div style="max-width:520px;margin:80px auto;padding:24px;font-family:system-ui,sans-serif;color:#e6edf3;background:#1e252b;border:1px solid #38434d;border-radius:8px;">
      <h1 style="font-size:18px;">Navegador sem suporte a Web Serial</h1>
      <p>Essa página precisa da <strong>Web Serial API</strong> para se conectar ao módulo por USB — disponível no
      <strong>Chrome</strong> e no <strong>Edge</strong> (desktop). Abra esta página num desses navegadores.</p>
    </div>
  `
} else {
  // Instala a implementacao Web Serial de DrumCoreApi em window.drumCore
  // ANTES de renderizar <App /> - App.tsx e' identico ao usado no build
  // Electron (window.drumCore la' vem do preload via contextBridge).
  installWebDrumCore()

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
