// Aba Global > Monitor de entradas (2026-10-30): pico bruto de cada canal
// (antes do ganho), direto do conversor do ESP32 (0-4095), pra ver se um
// piezo satura, está fraco ou com ruído. Usa raw_monitor / raw_levels.
import { useEffect, useRef, useState } from 'react'
import { PadConfig, RawLevels } from '../protocol'

const ADC_MAX = 4095
const HIT_LEVEL = 150 // acima disso conta como golpe (ruído fica bem abaixo) - igual ao módulo
const KEEPALIVE_MS = 10000 // o firmware desliga sozinho sem renovação em 30 s
const JACKS = 16

interface Props {
  connected: boolean
  pads: Record<number, PadConfig>
  jackLabels: Record<number, string>
  levels: RawLevels | null
  onSend: (obj: Record<string, unknown>) => void
}

function channelName(pads: Record<number, PadConfig>, c: number): string {
  const p = pads[c]
  if (!p) return '—'
  if (p.primary) return p.enabled ? p.label || p.name : 'desligado'
  const owner = pads[c - 1]
  return owner && owner.primary ? `2ª zona de ${owner.label || owner.name}` : '2ª zona'
}

/** Canal lido normalmente pelo módulo (pad ligado, ou 2ª zona de um pad ligado). */
function channelUsed(pads: Record<number, PadConfig>, c: number): boolean {
  const p = pads[c]
  if (!p) return false
  if (p.primary) return p.enabled
  const owner = pads[c - 1]
  return !!owner && owner.primary && owner.enabled
}

function jackLabel(c: number): string {
  return `J${Math.floor(c / 2) + 1} ${c % 2 ? 'ring' : 'tip'}`
}

export default function RawMonitor({ connected, pads, jackLabels, levels, onSend }: Props) {
  const [on, setOn] = useState(false)
  const [all, setAll] = useState(false)
  const [hold, setHold] = useState<number[]>(() => new Array(JACKS * 2).fill(0))
  const [satTotal, setSatTotal] = useState<number[]>(() => new Array(JACKS * 2).fill(0))
  // Entrada em foco (visão grande, pra ajustar trimpot): pico do último golpe.
  const [focus, setFocus] = useState(0)
  const [lastHit, setLastHit] = useState(0)
  const burst = useRef({ inBurst: false, max: 0 })
  const focusUsed = channelUsed(pads, focus)
  const sendRef = useRef(onSend)
  sendRef.current = onSend

  // Liga/renova/desliga o monitor no módulo.
  useEffect(() => {
    if (!on || !connected) return
    const send = () => sendRef.current({ cmd: 'raw_monitor', enabled: true, all: all || !focusUsed })
    send()
    const t = window.setInterval(send, KEEPALIVE_MS)
    return () => {
      window.clearInterval(t)
      sendRef.current({ cmd: 'raw_monitor', enabled: false })
    }
  }, [on, all, connected, focusUsed])

  // Acumula o maior pico e as leituras saturadas desde o último "zerar".
  useEffect(() => {
    if (!on || !levels) return
    setHold((prev) => prev.map((v, i) => Math.max(v, levels.peaks[i] ?? 0)))
    setSatTotal((prev) => prev.map((v, i) => v + (levels.sat[i] ?? 0)))
    const v = levels.peaks[focus] ?? 0
    const b = burst.current
    if (v >= HIT_LEVEL) {
      b.max = b.inBurst ? Math.max(b.max, v) : v
      b.inBurst = true
    } else if (b.inBurst) {
      b.inBurst = false
      setLastHit(b.max)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels, on])

  function reset(): void {
    setLastHit(0)
    burst.current = { inBurst: false, max: 0 }
    setHold(new Array(JACKS * 2).fill(0))
    setSatTotal(new Array(JACKS * 2).fill(0))
  }

  function row(c: number, zone: 'T' | 'R') {
    const used = on && levels ? levels.used[c] === 1 : false
    const now = used && levels ? levels.peaks[c] ?? 0 : 0
    const peak = hold[c]
    const sat = satTotal[c]
    const level = sat > 0 ? 'sat' : peak > ADC_MAX * 0.85 ? 'hot' : ''
    return (
      <div className={`rawmon-row ${used ? '' : 'off'}`} key={c}>
        <span className="rawmon-zone" title={zone === 'T' ? 'tip' : 'ring'}>
          {zone}
        </span>
        <span className="rawmon-name" title={channelName(pads, c)}>
          {channelName(pads, c)}
        </span>
        <div className="rawmon-track" aria-hidden>
          <div className={`rawmon-fill ${level}`} style={{ width: `${(now / ADC_MAX) * 100}%` }} />
          {peak > 0 && <div className={`rawmon-hold ${level}`} style={{ left: `${(peak / ADC_MAX) * 100}%` }} />}
        </div>
        <span className={`rawmon-val ${level}`} title="maior pico desde que ligou / zerou">
          {used ? (sat > 0 ? `SATUROU ×${sat}` : peak) : '—'}
        </span>
      </div>
    )
  }

  return (
    <section className="editor-section">
      <h3 className="section-title">Monitor de entradas</h3>
      <p className="pad-hint">
        Leitura bruta de cada porta, direto do conversor do módulo (0 a 4095, antes do ganho). Bata em cada pad com a
        força máxima que você toca: a barra mostra o pico e a marca guarda o maior. <strong>SATUROU</strong> = o sinal
        passou do teto e a dinâmica das batidas mais fortes se perde (reduza o sinal do piezo, por exemplo com um
        divisor ou trimpot). Pico baixo demais = pouca dinâmica. Pad parado deve ficar perto de zero (o resto é ruído).
      </p>
      <div className="global-actions">
        <button className={on ? '' : 'btn-primary'} onClick={() => setOn((v) => !v)} disabled={!connected}>
          {on ? 'Desligar monitor' : 'Ligar monitor'}
        </button>
        <button onClick={reset} disabled={!on}>
          Zerar picos
        </button>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Ler também as portas sem pad (testar jack novo)
        </label>
      </div>
      {on && (
        <div className="rawmon-focus">
          <div className="rawmon-focus-head">
            <label htmlFor="rawmon-focus" className="param-label">
              Entrada
            </label>
            <select
              id="rawmon-focus"
              value={focus}
              onChange={(e) => {
                setFocus(Number(e.target.value))
                setLastHit(0)
                burst.current = { inBurst: false, max: 0 }
              }}
            >
              {Array.from({ length: JACKS * 2 }, (_, c) => (
                <option key={c} value={c}>
                  {jackLabel(c)}
                  {jackLabels[Math.floor(c / 2)] ? ` (${jackLabels[Math.floor(c / 2)]})` : ''} — {channelName(pads, c)}
                </option>
              ))}
            </select>
          </div>
          {(() => {
            const now = levels && levels.used[focus] === 1 ? levels.peaks[focus] ?? 0 : 0
            const peak = hold[focus]
            const sat = satTotal[focus]
            const cls = (v: number) => (v >= 4090 ? 'sat' : v > ADC_MAX * 0.85 ? 'hot' : '')
            return (
              <>
                <div className="rawmon-big-track" aria-hidden>
                  <div className={`rawmon-fill ${cls(now)}`} style={{ width: `${(now / ADC_MAX) * 100}%` }} />
                  <div className="rawmon-mark85" />
                  {peak > 0 && <div className={`rawmon-hold ${cls(peak)}`} style={{ left: `${(peak / ADC_MAX) * 100}%` }} />}
                </div>
                <dl className="import-summary rawmon-nums">
                  <div>
                    <dt>Último golpe</dt>
                    <dd className={`rawmon-big ${cls(lastHit)}`}>{lastHit || '—'}</dd>
                  </div>
                  <div>
                    <dt>Maior</dt>
                    <dd className={cls(peak)}>{peak}</dd>
                  </div>
                  <div>
                    <dt>Saturação</dt>
                    <dd className={sat > 0 ? 'sat' : 'ok'}>{sat > 0 ? `SATUROU ×${sat}` : 'sem saturação'}</dd>
                  </div>
                </dl>
                <p className="pad-hint">
                  Para ajustar o trimpot: bata com a sua força máxima e gire até o <strong>último golpe</strong> ficar
                  perto da marca de 85% sem nunca saturar. Também dá para escolher a entrada na tela do módulo, em
                  GLOBAL &gt; MONITOR.
                </p>
              </>
            )
          })()}
        </div>
      )}
      {on && (
        <div className="rawmon-grid">
          {Array.from({ length: JACKS }, (_, j) => (
            <div className="rawmon-jack" key={j}>
              <div className="rawmon-head">
                J{j + 1}
                {jackLabels[j] ? <span> · {jackLabels[j]}</span> : null}
              </div>
              {row(2 * j, 'T')}
              {row(2 * j + 1, 'R')}
            </div>
          ))}
        </div>
      )}
      {on && (
        <p className="pad-hint">
          Enquanto o monitor está ligado o módulo manda ~10 leituras por segundo; ele desliga sozinho 30 s depois de
          você sair desta tela ou fechar o app.
        </p>
      )}
    </section>
  )
}
