import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installWebDrumCore } from './webDrumCore'
import './styles.css'

const root = document.getElementById('root')!

if (!('serial' in navigator)) {
  root.innerHTML = `
    <div style="max-width:520px;margin:80px auto;padding:24px;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#e9e4d8;background:#171c24;border:1px solid #2a3240;border-radius:10px;">
      <h1 style="font-size:18px;">Navegador sem suporte a Web Serial</h1>
      <p>Essa página precisa da <strong>Web Serial API</strong> para se conectar ao módulo por USB — disponível no
      <strong>Chrome</strong> e no <strong>Edge</strong> (desktop). Abra esta página num desses navegadores.</p>
    </div>
  `
} else {
  // Instala a implementacao Web Serial de DrumCoreApi em window.drumCore
  // ANTES de renderizar <App />.
  installWebDrumCore()

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
