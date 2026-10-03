// Aba Global > Wi-Fi (Fase AE, ver docs/08-wifi.md): rede própria do
// módulo, rede de casa (busca, salvar, esquecer) e "ligar ao iniciar".
import { useState } from 'react'
import { WifiInfo, WifiNetwork } from '../protocol'

export interface WifiScanState {
  busy: boolean
  networks: WifiNetwork[]
  error?: string
}

interface Props {
  wifi: WifiInfo
  scan: WifiScanState | null
  /** App aberto pela placa (conexão pelo Wi-Fi). */
  hosted: boolean
  onSend: (obj: Record<string, unknown>) => void
  onScan: () => void
}

const STA_LABEL: Record<string, string> = {
  connecting: 'conectando…',
  connected: 'conectado',
  failed: 'não conectou',
  none: 'Wi-Fi desligado'
}

function signal(rssi: number): string {
  return rssi >= -60 ? '▂▄▆█' : rssi >= -70 ? '▂▄▆' : rssi >= -80 ? '▂▄' : '▂'
}

export default function WifiPanel({ wifi, scan, hosted, onSend, onScan }: Props) {
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')

  const staState = wifi.sta_state ?? 'none'
  const staSaved = !!wifi.sta_ssid
  const homeUrl = `http://${wifi.hostname}.local`
  const passwordInvalid = password.length > 0 && (password.length < 8 || password.length > 63)
  const canSave = ssid.trim().length > 0 && ssid.length <= 32 && !passwordInvalid

  function toggleWifi(): void {
    const on = !wifi.active
    if (!on && hosted && !window.confirm('Desligar o Wi-Fi vai desconectar este app do módulo. Continuar?')) return
    onSend({ cmd: 'set_wifi', enabled: on })
  }

  function saveNetwork(): void {
    if (!canSave) return
    if (
      hosted &&
      !wifi.ap_active &&
      !window.confirm('O módulo vai trocar de rede e este app vai perder a conexão. Continuar?')
    )
      return
    onSend({ cmd: 'set_wifi_network', ssid: ssid.trim(), password })
    setPassword('')
  }

  function forget(): void {
    if (hosted && !wifi.ap_active && !window.confirm('O módulo vai sair da rede de casa e este app vai perder a conexão. Continuar?')) return
    onSend({ cmd: 'forget_wifi_network' })
  }

  const status = !wifi.active
    ? 'Desligado'
    : staState === 'connected'
      ? `Conectado à rede ${wifi.sta_ssid}`
      : staState === 'connecting'
        ? `Conectando à rede ${wifi.sta_ssid}…`
        : staState === 'failed'
          ? `Não conectou à rede ${wifi.sta_ssid} — rede própria do módulo no ar`
          : 'Rede própria do módulo no ar'

  return (
    <section className="editor-section">
      <h3 className="section-title">Wi-Fi</h3>
      <p className={`wifi-status ${wifi.active ? 'on' : ''}`}>{status}</p>

      {hosted && staState === 'connected' && wifi.ap_active && (
        <div className="wifi-banner" role="status">
          Pronto! A rede própria do módulo desliga em cerca de {Math.max(1, Math.round((wifi.ap_off_in_ms ?? 30000) / 1000))} s.
          Volte este aparelho para a rede <strong>{wifi.sta_ssid}</strong> e abra <strong>{homeUrl}</strong> (ou{' '}
          <strong>http://{wifi.sta_ip}</strong>).
        </div>
      )}

      <dl className="import-summary">
        {wifi.ap_active ? (
          <>
            <div>
              <dt>Rede própria</dt>
              <dd>{wifi.ssid}</dd>
            </div>
            <div>
              <dt>Senha</dt>
              <dd>{wifi.password}</dd>
            </div>
            <div>
              <dt>Endereço</dt>
              <dd>
                {wifi.hostname}.local · {wifi.ip}
              </dd>
            </div>
          </>
        ) : !wifi.active ? (
          <div>
            <dt>Rede própria</dt>
            <dd>
              {wifi.ssid} · senha {wifi.password}
            </dd>
          </div>
        ) : null}
        {staSaved && (
          <div>
            <dt>Rede de casa</dt>
            <dd>
              {wifi.sta_ssid} · {wifi.active ? STA_LABEL[staState] : 'salva'}
            </dd>
          </div>
        )}
        {staState === 'connected' && (
          <div>
            <dt>Endereço na rede de casa</dt>
            <dd>
              {wifi.hostname}.local · {wifi.sta_ip}
            </dd>
          </div>
        )}
      </dl>

      <div className="global-actions">
        <button onClick={toggleWifi}>{wifi.active ? 'Desligar Wi-Fi' : 'Ligar Wi-Fi'}</button>
      </div>
      <label className="check wifi-autostart">
        <input
          type="checkbox"
          checked={!!wifi.autostart}
          onChange={(e) => onSend({ cmd: 'set_wifi', autostart: e.target.checked })}
        />
        Ligar o Wi-Fi sempre que o módulo ligar
      </label>
      <p className="pad-hint">
        Com o Wi-Fi ligado, abra <strong>{homeUrl}</strong> num aparelho da mesma rede para usar este ConfigTool sem
        cabo. Se o endereço .local não abrir (comum no Android), use o IP. O Wi-Fi divide o processador com a leitura
        dos pads: se notar atraso ao tocar, deixe desligado.
      </p>

      <h4 className="wifi-sub">Rede de casa</h4>
      <p className="pad-hint">
        Com uma rede de casa salva, o módulo entra nela ao ligar o Wi-Fi, e você acessa o ConfigTool sem trocar de
        rede. Se ela não conectar em 15 s, o módulo cria a rede própria para você corrigir. A senha fica guardada só no
        módulo.
      </p>
      {staSaved && (
        <div className="global-actions">
          {staState === 'failed' && <button onClick={() => onSend({ cmd: 'retry_wifi_network' })}>Tentar de novo</button>}
          <button onClick={forget}>Esquecer {wifi.sta_ssid}</button>
        </div>
      )}

      <div className="wifi-form">
        <div className="wifi-field">
          <label htmlFor="wifi-ssid" className="param-label">
            Nome da rede
          </label>
          <div className="wifi-row">
            <input
              id="wifi-ssid"
              type="text"
              list="wifi-networks"
              value={ssid}
              maxLength={32}
              autoComplete="off"
              onChange={(e) => setSsid(e.target.value)}
            />
            <button type="button" onClick={onScan} disabled={!wifi.active || scan?.busy}>
              {scan?.busy ? 'Procurando…' : 'Procurar redes'}
            </button>
          </div>
          <datalist id="wifi-networks">
            {scan?.networks.map((n) => <option key={n.ssid} value={n.ssid} />)}
          </datalist>
        </div>
        {scan && !scan.busy && (
          <div className="wifi-scan">
            {scan.error ? (
              <p className="pad-hint">Não foi possível procurar redes agora.</p>
            ) : scan.networks.length === 0 ? (
              <p className="pad-hint">Nenhuma rede encontrada.</p>
            ) : (
              scan.networks.map((n) => (
                <button
                  key={n.ssid}
                  type="button"
                  className={`wifi-net ${ssid === n.ssid ? 'active' : ''}`}
                  onClick={() => setSsid(n.ssid)}
                >
                  <span className="wifi-net-name">{n.ssid}</span>
                  <span className="wifi-net-meta">
                    {n.secure ? '🔒 ' : ''}
                    {signal(n.rssi)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        <div className="wifi-field">
          <label htmlFor="wifi-pass" className="param-label">
            Senha
          </label>
          <input
            id="wifi-pass"
            type="password"
            value={password}
            maxLength={63}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          {passwordInvalid && <p className="param-note">A senha de Wi-Fi tem de 8 a 63 caracteres.</p>}
        </div>
        <div className="global-actions">
          <button className="btn-primary" onClick={saveNetwork} disabled={!canSave}>
            {wifi.active ? 'Salvar e conectar' : 'Salvar rede'}
          </button>
        </div>
        {!wifi.active && <p className="pad-hint">Ligue o Wi-Fi para procurar redes. Dá para salvar digitando o nome.</p>}
      </div>
    </section>
  )
}
