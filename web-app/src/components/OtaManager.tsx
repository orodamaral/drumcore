// Aba Firmware quando o app é aberto pela placa (Wi-Fi, Fase AE fase 3):
// atualiza o firmware pela rede, sem cabo. Versão mais recente do GitHub
// (precisa de internet no aparelho - rede de casa) ou um arquivo .bin
// escolhido (funciona também na rede própria do módulo, sem internet).
import { useEffect, useRef, useState } from 'react'
import { downloadFirmwareBinary, getLatestFirmware, type FirmwareManifest } from '../firmwareCheck'
import { DEFAULT_APP_OFFSET, extractAppImage, otaErrorMessage, uploadFirmware } from '../otaUpdate'
import type { OtaStatus } from '../protocol'

type Phase =
  | { phase: 'idle' }
  | { phase: 'preparing'; label: string }
  | { phase: 'confirm'; label: string }
  | { phase: 'uploading'; label: string; percent: number }
  | { phase: 'restarting'; label: string }
  | { phase: 'error'; message: string }

interface Props {
  connected: boolean
  firmwareVersion?: string
  /** null = nenhum ota_status desde o último pedido. */
  otaStatus: OtaStatus | null
  onRequest: () => void
  onCancel: () => void
}

export default function OtaManager({ connected, firmwareVersion, otaStatus, onRequest, onCancel }: Props) {
  const [latest, setLatest] = useState<{ manifest: FirmwareManifest; downloadUrl: string } | null>(null)
  const [latestError, setLatestError] = useState<string | null>(null)
  const [status, setStatus] = useState<Phase>({ phase: 'idle' })
  const appRef = useRef<Uint8Array | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    getLatestFirmware()
      .then(setLatest)
      .catch(() =>
        setLatestError(
          'Não deu para consultar o GitHub — este aparelho está sem internet (normal na rede própria do módulo). ' +
            'Use "Escolher arquivo" com o firmware baixado antes, ou conecte o módulo na rede de casa.'
        )
      )
  }, [])

  // Confirmado no módulo -> envia o arquivo.
  useEffect(() => {
    if (status.phase !== 'confirm' || !otaStatus) return
    if (otaStatus.state === 'armed' && !startedRef.current && appRef.current) {
      startedRef.current = true
      const label = status.label
      setStatus({ phase: 'uploading', label, percent: 0 })
      uploadFirmware(appRef.current, (percent) => setStatus({ phase: 'uploading', label, percent }))
        .then(() => setStatus({ phase: 'restarting', label }))
        .catch((err) => setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) }))
    } else if (otaStatus.state === 'idle') {
      setStatus({ phase: 'error', message: 'Cancelado no módulo (ou o tempo para confirmar acabou).' })
    } else if (otaStatus.state === 'error') {
      setStatus({ phase: 'error', message: otaErrorMessage(otaStatus.error) })
    }
  }, [otaStatus, status])

  function begin(app: Uint8Array, label: string): void {
    appRef.current = app
    startedRef.current = false
    setStatus({ phase: 'confirm', label })
    onRequest()
  }

  async function fromGithub(): Promise<void> {
    if (!latest) return
    // Releases sem app_offset são de antes da atualização pelo Wi-Fi (sem Wi-Fi nenhum).
    if (
      !latest.manifest.app_offset &&
      !window.confirm(
        `A versão ${latest.manifest.version} é anterior ao Wi-Fi: depois de instalar, o módulo fica sem Wi-Fi e só dá para atualizar de novo pelo USB. Instalar mesmo assim?`
      )
    )
      return
    const label = latest.manifest.version
    try {
      setStatus({ phase: 'preparing', label })
      const bytes = await downloadFirmwareBinary(latest.downloadUrl)
      const offset = latest.manifest.app_offset ? Number.parseInt(latest.manifest.app_offset, 16) : DEFAULT_APP_OFFSET
      begin(extractAppImage(bytes, offset), label)
    } catch (err) {
      setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function fromFile(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      setStatus({ phase: 'preparing', label: file.name })
      const bytes = new Uint8Array(await file.arrayBuffer())
      begin(extractAppImage(bytes), file.name)
    } catch (err) {
      setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  function cancel(): void {
    onCancel()
    setStatus({ phase: 'idle' })
  }

  const busy = status.phase === 'preparing' || status.phase === 'confirm' || status.phase === 'uploading'
  const isLatest = !!latest && firmwareVersion === latest.manifest.version
  const panelClassName = [
    'autotune-panel',
    'firmware-panel',
    busy ? 'active' : '',
    status.phase === 'restarting' ? 'done' : '',
    status.phase === 'error' ? 'aborted' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="firmware-manager">
      <div className="firmware-intro">
        <h2>Firmware</h2>
        <p className="pad-hint">
          Atualiza o firmware do módulo pelo Wi-Fi, sem cabo. Por segurança, o módulo pede uma confirmação: quando
          pedir, <strong>clique no botão do módulo</strong>. Não toque nem desligue o módulo durante a gravação.
        </p>
      </div>

      <div className={panelClassName}>
        <p className="pad-hint">
          Versão no módulo: <strong>{firmwareVersion ?? '—'}</strong>
          {latest && (
            <>
              {' '}
              · mais recente no GitHub: <strong>{latest.manifest.version}</strong>
              {isLatest && ' (já está atualizado)'}
            </>
          )}
        </p>
        {latest && !latest.manifest.app_offset && (
          <p className="pad-hint">
            Atenção: essa versão do GitHub é anterior ao Wi-Fi. Instalada, o módulo fica sem Wi-Fi (volta a ter
            gravando uma versão mais nova pelo USB).
          </p>
        )}
        {latestError && <p className="pad-hint">{latestError}</p>}

        {(status.phase === 'idle' || status.phase === 'error') && (
          <>
            {status.phase === 'error' && (
              <>
                <p className="autotune-tier">Não atualizou</p>
                <p className="pad-hint">{status.message} O firmware atual continua no módulo.</p>
              </>
            )}
            <div className="global-actions">
              {latest && (
                <button className="autotune-start" onClick={() => void fromGithub()} disabled={!connected}>
                  {isLatest ? `Reinstalar ${latest.manifest.version}` : `Atualizar para ${latest.manifest.version}`}
                </button>
              )}
              <button onClick={() => fileInputRef.current?.click()} disabled={!connected}>
                Escolher arquivo .bin…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".bin,application/octet-stream"
                hidden
                onChange={(e) => {
                  void fromFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
            <p className="pad-hint">
              O arquivo pode ser o <code>drumcore-firmware-….bin</code> das releases do GitHub (o mesmo da gravação por
              USB) ou o <code>firmware.bin</code> de um build do PlatformIO.
            </p>
          </>
        )}

        {status.phase === 'preparing' && <p className="autotune-tier">Preparando {status.label}…</p>}

        {status.phase === 'confirm' && (
          <>
            <p className="autotune-tier">Confirme no módulo</p>
            <p className="pad-hint">
              A tela do módulo está perguntando se pode atualizar: <strong>clique no botão</strong> para confirmar
              (segurar cancela). Você tem 1 minuto.
            </p>
            <button onClick={cancel}>Cancelar</button>
          </>
        )}

        {status.phase === 'uploading' && (
          <>
            <p className="autotune-tier">
              Enviando {status.label}… {status.percent}%
            </p>
            <div className="autotune-progress">
              <div className="autotune-progress-bar" style={{ width: `${status.percent}%` }} />
            </div>
          </>
        )}

        {status.phase === 'restarting' && (
          <>
            <p className="autotune-tier">Firmware gravado!</p>
            <p className="pad-hint">
              O módulo está reiniciando com a versão nova e volta para o Wi-Fi sozinho. Este app reconecta assim que
              ele voltar{connected && firmwareVersion ? ` — versão agora: ${firmwareVersion}` : '…'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
