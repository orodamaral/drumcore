import { useEffect, useState } from 'react'
import { ESPLoader, Transport } from 'esptool-js'
import esp32UartImage from '../assets/esp32-uart.png'
import type { FirmwareManifest } from '../env'

const FLASH_BAUD_RATE = 115200

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
      // Roda no processo main (window.drumCore.getLatestFirmware) - os
      // links de asset do GitHub nao mandam CORS liberado pro renderer, um
      // fetch direto daqui falha. Ver src/main/firmwareRelease.ts.
      const { manifest, downloadUrl } = await window.drumCore.getLatestFirmware()
      setStatus({ phase: 'ready', manifest, downloadUrl })
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
      // Mesmo motivo do getLatestFirmware() acima - o link de asset nao tem
      // CORS liberado, o download roda no processo main.
      const firmwareBytes = await window.drumCore.downloadFirmwareBinary(downloadUrl)

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
