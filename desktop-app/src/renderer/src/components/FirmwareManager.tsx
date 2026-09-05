import { useEffect, useState } from 'react'
import { ESPLoader, Transport } from 'esptool-js'
import esp32UartImage from '../assets/esp32-uart.png'

// Repositorio publico de onde as releases de firmware (tag "fw-v*") sao
// baixadas - ver .github/workflows/firmware-release.yml.
const GITHUB_REPO = 'orodamaral/drumcore'
const FLASH_BAUD_RATE = 115200

interface FirmwareManifest {
  version: string
  chip: string
  flash_size: string
  flash_mode: string
  offset: string
  file: string
}

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
}

interface GithubRelease {
  tag_name: string
  assets: GithubReleaseAsset[]
}

type FlashStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ready'; manifest: FirmwareManifest; downloadUrl: string }
  | { phase: 'connecting' }
  | { phase: 'downloading' }
  | { phase: 'writing'; percent: number }
  | { phase: 'done' }
  | { phase: 'error'; message: string }

interface FirmwareManagerProps {
  appConnected: boolean
  connectedFirmwareVersion?: string
  onDisconnectApp: () => Promise<void>
}

export default function FirmwareManager({
  appConnected,
  connectedFirmwareVersion,
  onDisconnectApp
}: FirmwareManagerProps) {
  const [status, setStatus] = useState<FlashStatus>({ phase: 'idle' })
  const [checkError, setCheckError] = useState<string | null>(null)

  async function checkForUpdate(): Promise<void> {
    setStatus({ phase: 'checking' })
    setCheckError(null)
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`)
      if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`)
      const releases = (await res.json()) as GithubRelease[]

      // Tags de firmware ("fw-v*") ordenam certo por string porque seguem
      // sempre o mesmo formato fw-vMAJOR.MINOR.PATCH com mesma contagem de
      // digitos na pratica deste projeto - se isso mudar, trocar por
      // comparacao semver de verdade.
      const firmwareReleases = releases
        .filter((release) => release.tag_name.startsWith('fw-v'))
        .sort((a, b) => (a.tag_name < b.tag_name ? 1 : -1))
      const latest = firmwareReleases[0]
      if (!latest) throw new Error('Nenhuma release de firmware encontrada no GitHub ainda.')

      const manifestAsset = latest.assets.find((asset) => asset.name === 'manifest.json')
      const binAsset = latest.assets.find((asset) => asset.name.endsWith('.bin'))
      if (!manifestAsset || !binAsset) {
        throw new Error('Release encontrada, mas faltam os arquivos esperados (manifest.json / .bin).')
      }

      const manifestRes = await fetch(manifestAsset.browser_download_url)
      if (!manifestRes.ok) throw new Error(`Falha ao baixar manifest.json (${manifestRes.status})`)
      const manifest = (await manifestRes.json()) as FirmwareManifest

      setStatus({ phase: 'ready', manifest, downloadUrl: binAsset.browser_download_url })
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : String(err))
      setStatus({ phase: 'idle' })
    }
  }

  useEffect(() => {
    checkForUpdate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function flash(manifest: FirmwareManifest, downloadUrl: string): Promise<void> {
    if (appConnected) {
      await onDisconnectApp()
    }

    try {
      setStatus({ phase: 'connecting' })

      // Web Serial (API do navegador, WICG) - porta separada da usada pela
      // aba Pads/Global (essa usa serialport/Node via window.drumCore). O
      // picker de dispositivo e' resolvido no processo main (ver
      // main/index.ts, handler 'select-serial-port').
      const port = await navigator.serial.requestPort()
      const transport = new Transport(port)
      const loader = new ESPLoader({ transport, baudrate: FLASH_BAUD_RATE })
      await loader.main()

      setStatus({ phase: 'downloading' })
      const binRes = await fetch(downloadUrl)
      if (!binRes.ok) throw new Error(`Falha ao baixar o firmware (${binRes.status})`)
      const firmwareBytes = new Uint8Array(await binRes.arrayBuffer())

      setStatus({ phase: 'writing', percent: 0 })
      await loader.writeFlash({
        fileArray: [{ data: firmwareBytes, address: 0 }],
        // O binario e' um unico arquivo mesclado (bootloader+partitions+app,
        // ver .github/workflows/firmware-release.yml) - "keep" preserva os
        // parametros de flash ja embutidos no cabecalho dele em vez de
        // arriscar sobrescrever com um valor errado aqui.
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_fileIndex, written, total) => {
          setStatus({ phase: 'writing', percent: Math.round((written / total) * 100) })
        }
      })

      await transport.disconnect()
      setStatus({ phase: 'done' })
    } catch (err) {
      setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const isBusy =
    status.phase === 'connecting' || status.phase === 'downloading' || status.phase === 'writing'

  const updateAvailable =
    status.phase === 'ready' &&
    !!connectedFirmwareVersion &&
    connectedFirmwareVersion !== 'demo' &&
    connectedFirmwareVersion !== status.manifest.version

  const panelClassName = [
    'autotune-panel',
    'firmware-panel',
    isBusy ? 'active' : '',
    status.phase === 'done' ? 'done' : '',
    status.phase === 'error' ? 'aborted' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="firmware-manager">
      <div className="firmware-intro">
        <h2>Firmware</h2>
        <p className="pad-hint">
          Instala ou atualiza o firmware do ESP32-S3 direto por aqui, baixando a versão mais
          recente publicada no GitHub. Funciona tanto pra gravar uma placa nova quanto pra
          atualizar uma que já está em uso — não precisa saber PlatformIO nem linha de comando.
        </p>
      </div>

      <div className="firmware-port-guide">
        <img src={esp32UartImage} alt="Porta USB-UART destacada na placa ESP32-S3" />
        <p className="pad-hint">
          Conecte o cabo USB na porta <strong>USB-UART</strong> destacada na foto acima (não na
          porta USB nativa, do lado oposto) — só essa porta permite a gravação automática, sem
          precisar segurar nenhum botão na placa.
        </p>
      </div>

      <div className={panelClassName}>
        {status.phase === 'checking' && (
          <p className="autotune-tier">Verificando última versão no GitHub...</p>
        )}

        {checkError && (
          <>
            <p className="autotune-tier">Não consegui verificar atualizações</p>
            <p className="pad-hint">{checkError}</p>
            <button onClick={checkForUpdate}>Tentar de novo</button>
          </>
        )}

        {status.phase === 'ready' && (
          <>
            <p className="autotune-tier">Versão disponível: {status.manifest.version}</p>
            {connectedFirmwareVersion && connectedFirmwareVersion !== 'demo' && (
              <p className="pad-hint">
                Versão conectada agora: {connectedFirmwareVersion}
                {updateAvailable
                  ? ' — atualização disponível.'
                  : ' — já está na versão mais recente.'}
              </p>
            )}
            <button className="autotune-start" onClick={() => flash(status.manifest, status.downloadUrl)}>
              {connectedFirmwareVersion ? 'Atualizar firmware' : 'Instalar firmware'}
            </button>
          </>
        )}

        {status.phase === 'connecting' && (
          <p className="autotune-tier">Selecione a placa na janela do sistema e aguarde conectar...</p>
        )}
        {status.phase === 'downloading' && <p className="autotune-tier">Baixando firmware...</p>}

        {status.phase === 'writing' && (
          <>
            <p className="autotune-tier">Gravando... {status.percent}%</p>
            <div className="autotune-progress">
              <div className="autotune-progress-bar" style={{ width: `${status.percent}%` }} />
            </div>
          </>
        )}

        {status.phase === 'done' && (
          <>
            <p className="autotune-tier">Firmware gravado com sucesso!</p>
            <p className="pad-hint">Desconecte e reconecte o cabo, ou reinicie a placa, pra rodar o novo firmware.</p>
          </>
        )}

        {status.phase === 'error' && (
          <>
            <p className="autotune-tier">Erro ao gravar</p>
            <p className="pad-hint">{status.message}</p>
            <button onClick={checkForUpdate}>Recomeçar</button>
          </>
        )}
      </div>
    </div>
  )
}
