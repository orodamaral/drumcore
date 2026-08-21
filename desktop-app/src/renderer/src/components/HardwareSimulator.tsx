import { useEffect, useRef, useState } from 'react'
import { FieldSpec, PadConfig, PadConfigPrimary, PadType, PAD_TYPE_META } from '../protocol'

const PAD_COUNT = 32
const GRID_COLS = 8
const IDLE_TIMEOUT_MS = 4000 // mesmo valor do firmware (ver docs/01-decisoes-arquiteturais.md)
const PAD_FLASH_MS = 200
const HOME_TICK_MS = 100 // frequencia de reavaliacao dos flashes enquanto a tela inicial esta visivel
const SIMULATED_HIT_INTERVAL_MS = 1200

// Base "em branco" pra um pad - espelha o que o firmware grava no primeiro
// boot (ver setup() em firmware/src/main.cpp).
function blankPad(i: number, type: PadType = 0): PadConfigPrimary {
  return {
    pad: i,
    primary: true,
    pad_type: type,
    uses_second_channel: PAD_TYPE_META[type].channels === 2,
    name: `Pad ${i + 1}`,
    label: '',
    sensitivity: 100,
    threshold: 10,
    scan_time: 10,
    mask_time: 30,
    curve_type: 0,
    rim_sensitivity: 20,
    rim_threshold: 3,
    note: 36 + i,
    note_rim: 39,
    note_cup: 40,
    hihat_pedal_channel: -1
  }
}

function nameFor(i: number, label: string): string {
  return label ? `${i + 1} - ${label}` : `Pad ${i + 1}`
}

// Dataset de demonstração - mistura tipos diferentes pra dar um "tour" pelas
// telas possíveis sem precisar configurar nada. Só existe aqui no
// simulador (não é sincronizado com o modo demo do editor "Configuração").
function createPreviewPads(): Array<PadConfig> {
  const pads: PadConfig[] = Array.from({ length: PAD_COUNT }, (_, i) => blankPad(i))

  function set(i: number, type: PadType, label: string, extra: Partial<PadConfigPrimary> = {}): void {
    const base = blankPad(i, type)
    const pad: PadConfigPrimary = { ...base, label, name: nameFor(i, label), ...extra }
    pads[i] = pad
    if (PAD_TYPE_META[type].channels === 2) {
      pads[i + 1] = { pad: i + 1, primary: false, consumed_by: i }
    }
  }

  set(0, 0, 'Caixa')
  set(1, 1, 'Tom 1') // dual - consome o pad 2
  set(3, 3, 'Crash') // prato 2 zonas - consome o pad 4
  set(5, 5, 'Ride') // prato 3 zonas - consome o pad 6
  set(7, 4, 'Chimbal', { hihat_pedal_channel: 9 }) // chimbal 2 zonas - consome o pad 8
  set(9, 6, 'Pedal Chimbal')
  set(10, 2, 'Chimbal Simples', { hihat_pedal_channel: 9 })
  set(11, 7, 'Pedal Óptico')

  return pads
}

function fieldsFor(pad: PadConfig | undefined): FieldSpec[] {
  if (!pad || !pad.primary) return []
  return PAD_TYPE_META[pad.pad_type].fields
}

// Velocímetro (arco 150°→30°, agulha) - espelha drawGauge() em
// firmware/src/main.cpp. SVG nativo, sem lib de gráfico.
function Gauge({ value, min, max }: { value: number; min: number; max: number }): JSX.Element {
  const t = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
  const startDeg = 150
  const endDeg = 30
  const cx = 60
  const cy = 58
  const r = 46

  const angleAt = (tt: number): number => ((startDeg - tt * (startDeg - endDeg)) * Math.PI) / 180
  const point = (angleRad: number, radius: number): { x: number; y: number } => ({
    x: cx + radius * Math.cos(angleRad),
    y: cy - radius * Math.sin(angleRad)
  })

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((tk) => {
    const a = angleAt(tk)
    const p1 = point(a, r - 8)
    const p2 = point(a, r)
    return <line key={tk} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="hw-sim-gauge-tick" />
  })

  const needleTip = point(angleAt(t), r - 6)

  return (
    <svg viewBox="0 0 120 78" className="hw-sim-gauge" role="img" aria-label={`Velocímetro: ${value} entre ${min} e ${max}`}>
      {ticks}
      <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y} className="hw-sim-gauge-needle" />
      <circle cx={cx} cy={cy} r={4} className="hw-sim-gauge-pivot" />
      <text x={cx - r} y={cy + 16} className="hw-sim-gauge-label">
        {min}
      </text>
      <text x={cx + r - 12} y={cy + 16} className="hw-sim-gauge-label">
        {max}
      </text>
    </svg>
  )
}

export default function HardwareSimulator() {
  const [pads, setPads] = useState<PadConfig[]>(() => createPreviewPads())
  const [padIndex, setPadIndex] = useState(0)
  const [itemIndex, setItemIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [flash, setFlash] = useState<'editar' | 'ok' | null>(null)
  const [enc1Angle, setEnc1Angle] = useState(0)
  const [enc2Angle, setEnc2Angle] = useState(0)
  const [showHome, setShowHome] = useState(false)
  const [padHitFlash, setPadHitFlash] = useState<number[]>(() => new Array(PAD_COUNT).fill(0))
  const [, forceTick] = useState(0)

  const lastInteractionRef = useRef(Date.now())

  const pad = pads[padIndex]
  const fields = fieldsFor(pad)
  const currentField = fields[itemIndex]

  function markInteraction(): void {
    lastInteractionRef.current = Date.now()
    setShowHome(false)
  }

  function showFlash(kind: 'editar' | 'ok'): void {
    setFlash(kind)
    setTimeout(() => setFlash(null), 500)
  }

  function movePad(delta: number): void {
    setPadIndex((p) => (p + delta + PAD_COUNT) % PAD_COUNT)
    setItemIndex(0)
  }

  function moveItem(delta: number): void {
    if (fields.length === 0) return
    setItemIndex((i) => (i + delta + fields.length) % fields.length)
  }

  function adjustValue(delta: number): void {
    if (!currentField || !pad?.primary) return
    const spec = currentField
    setPads((prev) => {
      const next = [...prev]
      const target = next[padIndex]
      if (!target.primary) return prev
      let value = target[spec.field] + delta
      if (value > spec.max) value = spec.min
      if (value < spec.min) value = spec.max
      next[padIndex] = { ...target, [spec.field]: value }
      return next
    })
  }

  function rotateEncoder1(delta: number): void {
    markInteraction()
    setEnc1Angle((a) => a + delta * 36)
    if (editing) adjustValue(delta)
    else movePad(delta)
  }

  function rotateEncoder2(delta: number): void {
    markInteraction()
    setEnc2Angle((a) => a + delta * 36)
    if (editing) return // desabilitado durante edicao, igual ao firmware (readButton so aceita UP/DOWN)
    moveItem(delta)
  }

  function pressEncoder1(): void {
    markInteraction()
    if (!pad?.primary) return
    if (!editing) {
      setEditing(true)
      showFlash('editar')
    } else {
      setEditing(false)
      showFlash('ok')
    }
  }

  function resetPreview(): void {
    setPads(createPreviewPads())
    setPadIndex(0)
    setItemIndex(0)
    setEditing(false)
    setPadHitFlash(new Array(PAD_COUNT).fill(0))
  }

  // Alterna pra tela inicial (grid) depois de IDLE_TIMEOUT_MS sem interacao
  // com os encoders - mesma regra do firmware (renderScreen() em main.cpp).
  useEffect(() => {
    const t = setInterval(() => {
      if (!showHome && Date.now() - lastInteractionRef.current > IDLE_TIMEOUT_MS) {
        setShowHome(true)
      }
    }, 300)
    return () => clearInterval(t)
  }, [showHome])

  // Redesenha (via re-render) a tela inicial periodicamente, so' pra deixar
  // os flashes de hit apagarem sem precisar de outro evento.
  useEffect(() => {
    if (!showHome) return
    const t = setInterval(() => forceTick((n) => n + 1), HOME_TICK_MS)
    return () => clearInterval(t)
  }, [showHome])

  // Simula hits aleatorios nos pads primarios, so' pra exercitar o flash
  // verde da tela inicial - nao afeta a tela de configuracao.
  useEffect(() => {
    const t = setInterval(() => {
      const primaryIndices = pads.map((p, i) => (p?.primary ? i : -1)).filter((i) => i >= 0)
      if (primaryIndices.length === 0) return
      const i = primaryIndices[Math.floor(Math.random() * primaryIndices.length)]
      setPadHitFlash((prev) => {
        const next = [...prev]
        next[i] = Date.now() + PAD_FLASH_MS
        return next
      })
    }, SIMULATED_HIT_INTERVAL_MS)
    return () => clearInterval(t)
  }, [pads])

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'ArrowUp') rotateEncoder1(1)
      else if (event.key === 'ArrowDown') rotateEncoder1(-1)
      else if (event.key === 'ArrowRight') rotateEncoder2(1)
      else if (event.key === 'ArrowLeft') rotateEncoder2(-1)
      else if (event.key === 'Enter' || event.key === ' ') pressEncoder1()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, padIndex, itemIndex, pads])

  const now = Date.now()

  return (
    <div className="hw-sim">
      <div className="hw-sim-device">
        <div className="hw-sim-screen">
          {flash === 'editar' && <div className="hw-sim-flash hw-sim-flash-yellow">EDITAR</div>}
          {flash === 'ok' && <div className="hw-sim-flash hw-sim-flash-green">OK</div>}

          {!flash && showHome && (
            <div className="hw-sim-grid" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}>
              {Array.from({ length: PAD_COUNT }, (_, i) => (
                <div key={i} className={`hw-sim-cell${now < padHitFlash[i] ? ' hot' : ''}`}>
                  {i + 1}
                </div>
              ))}
            </div>
          )}

          {!flash && !showHome && (
            <>
              <div className="hw-sim-padname">{pad?.primary ? pad.name : `Pad ${padIndex + 1}`}</div>

              {pad?.primary ? (
                currentField && (
                  <>
                    <div className="hw-sim-item">{currentField.label}</div>
                    <Gauge value={pad[currentField.field]} min={currentField.min} max={currentField.max} />
                    <div className="hw-sim-value">{pad[currentField.field]}</div>
                  </>
                )
              ) : (
                <div className="hw-sim-consumed">
                  Canal ocupado
                  <br />
                  (2º canal do pad anterior)
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="hw-sim-controls">
        <div className="hw-sim-encoder">
          <button
            className="hw-sim-knob"
            style={{ transform: `rotate(${enc1Angle}deg)` }}
            onWheel={(event) => rotateEncoder1(event.deltaY < 0 ? 1 : -1)}
            onClick={pressEncoder1}
          >
            <span className="hw-sim-knob-mark" />
          </button>
          <span className="hw-sim-encoder-label">
            Encoder 1 — pad (fora de edição) / valor (editando)
            <br />
            girar: roda do mouse · clique: EDIT/SET
          </span>
        </div>

        <div className="hw-sim-encoder">
          <button className="hw-sim-knob" style={{ transform: `rotate(${enc2Angle}deg)` }} onWheel={(event) => rotateEncoder2(event.deltaY < 0 ? 1 : -1)}>
            <span className="hw-sim-knob-mark" />
          </button>
          <span className="hw-sim-encoder-label">
            Encoder 2 — item/parâmetro
            <br />
            girar: roda do mouse
          </span>
        </div>
      </div>

      <p className="hw-sim-hint">
        Atalhos de teclado: <kbd>↑</kbd>/<kbd>↓</kbd> = encoder 1, <kbd>←</kbd>/<kbd>→</kbd> = encoder 2,{' '}
        <kbd>Enter</kbd>/<kbd>Espaço</kbd> = clique do encoder 1. Sem interação por {IDLE_TIMEOUT_MS / 1000}s a tela
        volta pro grid inicial.
      </p>

      <button className="hw-sim-reset" onClick={resetPreview}>
        Reiniciar dados de exemplo
      </button>
    </div>
  )
}
