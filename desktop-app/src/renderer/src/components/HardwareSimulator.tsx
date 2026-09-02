import { useEffect, useRef, useState } from 'react'
import {
  FieldSpec,
  GlobalConfig,
  MIDI_OUTPUT_LABELS,
  PadConfig,
  PadConfigPrimary,
  PadType,
  PAD_TYPE_META
} from '../protocol'

// Simulador visual do módulo (tela 128x128 + 2 encoders), sem depender do
// hardware. Espelha a máquina de estados de design/SPEC.md (BOOT é omitido
// aqui - dura só a inicialização) e a semântica de ENC1/ENC2 descrita ali:
// ENC1 gira = troca de página (ou pad em foco dentro de PAD_EDIT/SIGNAL),
// clique = alterna PAD_EDIT<->SIGNAL, hold 600ms = volta pra LIVE; ENC2 gira
// = navega lista / edita valor, clique = entra no item / confirma, hold
// 600ms = volta um nível. Edição fica só neste estado (RAM) até "SALVAR" em
// GLOBAL - não é sincronizado com a aba "Pads" (que fala com o firmware de
// verdade / modo demo via protocolo serial).
const PAD_COUNT = 32

type Page = 'LIVE' | 'PADS' | 'PAD_EDIT' | 'SIGNAL' | 'GLOBAL' | 'AUTOTUNE'

const GLOBAL_ROWS = ['MIDI CH', 'SAIDA', 'SALVAR', 'RESTAURAR'] as const

const AUTOTUNE_HIT_TARGET = 8

interface AutoTuneSimState {
  phase: 'noise' | 'collecting' | 'done'
  hitCount: number
  result?: { sensitivity: number; threshold: number; scan_time: number; mask_time: number }
}

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
    retrigger: 0,
    gain: 100,
    xtalk: 0,
    xtalk_group: 0,
    rim_sensitivity: 20,
    rim_threshold: 3,
    note: 36 + i,
    note_rim: 39,
    note_cup: 40,
    hihat_pedal_channel: -1,
    enabled: true
  }
}

function nameFor(i: number, label: string): string {
  return label ? `${i + 1} - ${label}` : `Pad ${i + 1}`
}

// Dataset de demonstração - mistura tipos diferentes pra dar um "tour" pelas
// telas possíveis sem precisar configurar nada.
function createPreviewPads(): PadConfig[] {
  const pads: PadConfig[] = Array.from({ length: PAD_COUNT }, (_, i) => blankPad(i))

  function set(i: number, type: PadType, label: string, extra: Partial<PadConfigPrimary> = {}): void {
    const base = blankPad(i, type)
    const pad: PadConfigPrimary = { ...base, label, name: nameFor(i, label), ...extra }
    pads[i] = pad
    if (PAD_TYPE_META[type].channels === 2) {
      pads[i + 1] = { pad: i + 1, primary: false, consumed_by: i }
    }
  }

  set(0, 8, 'Caixa')
  set(2, 1, 'Tom 1')
  set(4, 3, 'Crash')
  set(6, 5, 'Ride')
  set(8, 4, 'Chimbal', { hihat_pedal_channel: 10 })
  set(10, 6, 'Pedal Chimbal')
  set(11, 2, 'Chimbal Simples', { hihat_pedal_channel: 10 })
  set(12, 7, 'Pedal Óptico')

  return pads
}

function fieldsFor(pad: PadConfig | undefined): FieldSpec[] {
  if (!pad || !pad.primary) return []
  return PAD_TYPE_META[pad.pad_type].fields
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Envelope ilustrativo pra tela SIGNAL - o simulador não tem ADC de
// verdade, então gera uma curva de decaimento plausível só pra mostrar o
// layout da tela (eixo, faixa de scan/mask, linha de threshold).
function fakeEnvelope(seed: number, threshold: number): number[] {
  const points: number[] = []
  const peak = 60 + ((seed * 37) % 40)
  for (let i = 0; i < 60; i++) {
    const decay = Math.max(0, peak - i * (peak / 40))
    const wobble = Math.sin(i / 2 + seed) * 4
    points.push(clamp(Math.round(decay + wobble), 0, 100))
  }
  points[0] = Math.max(points[0], threshold + 5)
  return points
}

export default function HardwareSimulator() {
  const [pads, setPads] = useState<PadConfig[]>(() => createPreviewPads())
  const [global, setGlobalState] = useState<GlobalConfig>({ midi_channel: 10, midi_output: 2 })

  const [page, setPage] = useState<Page>('LIVE')
  const [padsListSelection, setPadsListSelection] = useState(0)
  const [padsListTop, setPadsListTop] = useState(0)
  const [editPadIndex, setEditPadIndex] = useState(0)
  const [editItemIndex, setEditItemIndex] = useState(0)
  const [editingValue, setEditingValue] = useState(false)
  const [globalSelection, setGlobalSelection] = useState(0)
  const [globalEditing, setGlobalEditing] = useState(false)
  const [toast, setToast] = useState<{ line1: string; line2: string } | null>(null)
  const [autoTune, setAutoTune] = useState<AutoTuneSimState | null>(null)
  const [padHitFlash, setPadHitFlash] = useState<number[]>(() => new Array(PAD_COUNT).fill(0))
  const [enc1Angle, setEnc1Angle] = useState(0)
  const [enc2Angle, setEnc2Angle] = useState(0)
  const [, forceTick] = useState(0)

  const holdFired1 = useRef(false)
  const holdFired2 = useRef(false)
  const holdTimer1 = useRef<ReturnType<typeof setTimeout>>()
  const holdTimer2 = useRef<ReturnType<typeof setTimeout>>()
  const lastEnc2StepMs = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const signalSeed = useRef(0)
  const autoTuneTimer = useRef<ReturnType<typeof setTimeout>>()
  const autoTuneHitCountRef = useRef(0) // fonte da verdade pro agendamento - autoTune (state) e' so' pra render

  const pad = pads[editPadIndex]
  const fields = fieldsFor(pad)

  function showToast(line1: string, line2: string): void {
    setToast({ line1, line2 })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 900)
  }

  function goToLive(): void {
    if (autoTuneTimer.current) clearTimeout(autoTuneTimer.current)
    setAutoTune(null)
    setPage('LIVE')
  }

  // Assistente de auto-calibração (Fase O) - versão ilustrativa, sem ADC
  // real: uma sequência de tempos fixos simula a fase de ruído e a
  // contagem de golpes, terminando num resultado plausível. Ver
  // docs/01-decisoes-arquiteturais.md.
  function startAutoTuneSim(): void {
    if (autoTuneTimer.current) clearTimeout(autoTuneTimer.current)
    autoTuneHitCountRef.current = 0
    setAutoTune({ phase: 'noise', hitCount: 0 })
    setPage('AUTOTUNE')

    autoTuneTimer.current = setTimeout(() => {
      setAutoTune({ phase: 'collecting', hitCount: 0 })
      scheduleAutoTuneHit()
    }, 2000)
  }

  function scheduleAutoTuneHit(): void {
    autoTuneTimer.current = setTimeout(() => {
      autoTuneHitCountRef.current += 1
      const hitCount = autoTuneHitCountRef.current

      if (hitCount >= AUTOTUNE_HIT_TARGET) {
        const current = pads[editPadIndex]
        const base = current?.primary ? current : blankPad(editPadIndex)
        setAutoTune({
          phase: 'done',
          hitCount,
          result: {
            sensitivity: clamp(base.sensitivity + Math.round((Math.random() - 0.5) * 10), 1, 100),
            threshold: clamp(base.threshold + Math.round((Math.random() - 0.5) * 6), 1, 100),
            scan_time: clamp(8 + Math.round(Math.random() * 6), 1, 100),
            mask_time: clamp(25 + Math.round(Math.random() * 10), 1, 100)
          }
        })
      } else {
        setAutoTune({ phase: 'collecting', hitCount })
        scheduleAutoTuneHit()
      }
    }, 600 + Math.random() * 300)
  }

  function cancelAutoTuneSim(): void {
    if (autoTuneTimer.current) clearTimeout(autoTuneTimer.current)
    setAutoTune(null)
    setPage('PAD_EDIT')
  }

  function applyAutoTuneSim(): void {
    if (autoTune?.phase !== 'done' || !autoTune.result) return
    const result = autoTune.result
    setPads((prev) => {
      const next = [...prev]
      const target = next[editPadIndex]
      if (!target.primary) return prev
      next[editPadIndex] = {
        ...target,
        sensitivity: result.sensitivity,
        threshold: result.threshold,
        scan_time: result.scan_time,
        mask_time: result.mask_time
      }
      return next
    })
    setAutoTune(null)
    setPage('PAD_EDIT')
  }

  function accelStep(min: number, max: number): number {
    const now = Date.now()
    const fast = now - lastEnc2StepMs.current < 125
    lastEnc2StepMs.current = now
    return max - min > 20 && fast ? 5 : 1
  }

  function onEnc1Rotate(delta: number): void {
    if (page === 'AUTOTUNE') return // sem navegacao durante o assistente
    setEnc1Angle((a) => a + delta * 36)

    if (page === 'PAD_EDIT' || page === 'SIGNAL') {
      setEditPadIndex((i) => (i + delta + PAD_COUNT) % PAD_COUNT)
      setEditItemIndex(0)
      setEditingValue(false)
      if (page === 'SIGNAL') signalSeed.current += 1
      return
    }

    const order = page === 'LIVE' ? 0 : page === 'PADS' ? 1 : 2
    const next = (order + delta + 3) % 3
    setPage(next === 0 ? 'LIVE' : next === 1 ? 'PADS' : 'GLOBAL')
  }

  function onEnc1Click(): void {
    if (page === 'AUTOTUNE') return
    if (page === 'PAD_EDIT') {
      signalSeed.current += 1
      setPage('SIGNAL')
    } else if (page === 'SIGNAL') {
      setPage('PAD_EDIT')
    }
  }

  function onEnc2Rotate(delta: number): void {
    setEnc2Angle((a) => a + delta * 36)

    if (page === 'PADS') {
      setPadsListSelection((sel) => {
        const next = clamp(sel + delta, 0, PAD_COUNT - 1)
        setPadsListTop((top) => {
          if (next < top) return next
          if (next > top + 7) return next - 7
          return top
        })
        return next
      })
      return
    }

    if (page === 'PAD_EDIT') {
      // Item 0 e' sempre o toggle "ATIVO" (nao e' um PadField, igual ao
      // FIELD_ENABLED do firmware - ver docs/01-decisoes-arquiteturais.md,
      // Fase N). Itens 1..fields.length sao os campos normais do tipo
      // (fields[i-1]). O ultimo item e' sempre "CALIBRAR" (FIELD_AUTOTUNE,
      // Fase O) - so' dispara no clique, nao entra em modo de edicao.
      const totalItems = 2 + fields.length
      if (!editingValue) {
        setEditItemIndex((i) => clamp(i + delta, 0, Math.max(0, totalItems - 1)))
        return
      }
      if (editItemIndex === 0) {
        setPads((prev) => {
          const next = [...prev]
          const target = next[editPadIndex]
          if (!target.primary) return prev
          const value = clamp((target.enabled ? 1 : 0) + delta, 0, 1)
          next[editPadIndex] = { ...target, enabled: value === 1 }
          return next
        })
        return
      }
      const spec = fields[editItemIndex - 1]
      if (!spec || !pad?.primary) return
      const step = accelStep(spec.min, spec.max) * (delta > 0 ? 1 : -1)
      setPads((prev) => {
        const next = [...prev]
        const target = next[editPadIndex]
        if (!target.primary) return prev
        const value = clamp(target[spec.field] + step, spec.min, spec.max)
        next[editPadIndex] = { ...target, [spec.field]: value }
        return next
      })
      return
    }

    if (page === 'GLOBAL') {
      if (!globalEditing) {
        setGlobalSelection((s) => clamp(s + delta, 0, GLOBAL_ROWS.length - 1))
        return
      }
      const step = delta > 0 ? 1 : -1
      setGlobalState((g) => {
        switch (globalSelection) {
          case 0:
            return { ...g, midi_channel: clamp(g.midi_channel + step, 1, 16) }
          case 1:
            return { ...g, midi_output: (((g.midi_output + step) % 3 + 3) % 3) as GlobalConfig['midi_output'] }
          default:
            return g
        }
      })
    }
  }

  function onEnc2Click(): void {
    if (page === 'PADS') {
      setEditPadIndex(padsListSelection)
      setEditItemIndex(0)
      setEditingValue(false)
      setPage('PAD_EDIT')
      return
    }
    if (page === 'PAD_EDIT') {
      if (editItemIndex === fields.length + 1) {
        if (pad?.primary && pad.enabled) {
          startAutoTuneSim()
        }
        return
      }
      setEditingValue((v) => !v)
      return
    }
    if (page === 'GLOBAL') {
      if (globalSelection === 2) {
        showToast('SALVO', '32 PADS (SIMULADO)')
      } else if (globalSelection === 3) {
        setPads(createPreviewPads())
        showToast('RESTAURADO', '32 PADS (SIMULADO)')
      } else {
        setGlobalEditing((v) => !v)
      }
    }
    if (page === 'AUTOTUNE' && autoTune?.phase === 'done') {
      applyAutoTuneSim()
    }
  }

  function onEnc1Hold(): void {
    goToLive()
  }

  function onEnc2Hold(): void {
    setEditingValue(false)
    setGlobalEditing(false)
    if (page === 'PAD_EDIT') setPage('PADS')
    else if (page === 'SIGNAL') setPage('PAD_EDIT')
    else if (page === 'AUTOTUNE') cancelAutoTuneSim()
  }

  function bindEncoder(
    holdFired: typeof holdFired1,
    holdTimer: typeof holdTimer1,
    onRotate: (delta: number) => void,
    onClick: () => void,
    onHold: () => void
  ) {
    return {
      onWheel: (event: React.WheelEvent) => onRotate(event.deltaY < 0 ? 1 : -1),
      onMouseDown: () => {
        holdFired.current = false
        holdTimer.current = setTimeout(() => {
          holdFired.current = true
          onHold()
        }, 600)
      },
      onMouseUp: () => {
        if (holdTimer.current) clearTimeout(holdTimer.current)
      },
      onMouseLeave: () => {
        if (holdTimer.current) clearTimeout(holdTimer.current)
      },
      onClick: () => {
        if (holdFired.current) {
          holdFired.current = false
          return
        }
        onClick()
      }
    }
  }

  const enc1Handlers = bindEncoder(holdFired1, holdTimer1, onEnc1Rotate, onEnc1Click, onEnc1Hold)
  const enc2Handlers = bindEncoder(holdFired2, holdTimer2, onEnc2Rotate, onEnc2Click, onEnc2Hold)

  function resetPreview(): void {
    if (autoTuneTimer.current) clearTimeout(autoTuneTimer.current)
    setAutoTune(null)
    setPads(createPreviewPads())
    setGlobalState({ midi_channel: 10, midi_output: 2 })
    setPage('LIVE')
    setPadsListSelection(0)
    setPadsListTop(0)
    setEditPadIndex(0)
    setEditItemIndex(0)
    setEditingValue(false)
    setGlobalSelection(0)
    setGlobalEditing(false)
    setPadHitFlash(new Array(PAD_COUNT).fill(0))
  }

  // Simula hits aleatórios nos pads primários - só pra exercitar o flash da
  // tela LIVE, não afeta as outras telas.
  useEffect(() => {
    const t = setInterval(() => {
      const primaryIndices = pads.map((p, i) => (p?.primary && p.enabled ? i : -1)).filter((i) => i >= 0)
      if (primaryIndices.length === 0) return
      const i = primaryIndices[Math.floor(Math.random() * primaryIndices.length)]
      setPadHitFlash((prev) => {
        const next = [...prev]
        next[i] = Date.now() + 180
        return next
      })
    }, 1200)
    return () => clearInterval(t)
  }, [pads])

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    return () => {
      if (autoTuneTimer.current) clearTimeout(autoTuneTimer.current)
    }
  }, [])

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'ArrowUp') onEnc1Rotate(1)
      else if (event.key === 'ArrowDown') onEnc1Rotate(-1)
      else if (event.key === 'ArrowRight') onEnc2Rotate(1)
      else if (event.key === 'ArrowLeft') onEnc2Rotate(-1)
      else if (event.key === 'Enter') onEnc1Click()
      else if (event.key === ' ') onEnc2Click()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, editingValue, globalEditing, editPadIndex, editItemIndex, padsListSelection, globalSelection, fields, pads])

  const now = Date.now()

  return (
    <div className="hw-sim">
      <div className="hw-sim-device">
        <div className="hw-sim-screen">
          <div className="hw-sim-titlebar">
            <span className="hw-sim-title-left">{page === 'AUTOTUNE' ? 'CALIBRAR' : page}</span>
            <span className="hw-sim-title-right">
              {page === 'LIVE' && 'USB · BLE'}
              {page === 'PADS' && `${padsListSelection + 1}/32`}
              {(page === 'PAD_EDIT' || page === 'SIGNAL' || page === 'AUTOTUNE') && `PAD ${editPadIndex + 1}`}
            </span>
          </div>

          {page === 'LIVE' && (
            <div className="hw-sim-grid">
              {Array.from({ length: PAD_COUNT }, (_, i) => {
                const off = pads[i]?.primary && !pads[i].enabled
                return (
                  <div key={i} className={`hw-sim-cell${now < padHitFlash[i] ? ' hot' : ''}${off ? ' off' : ''}`}>
                    {String(i + 1).padStart(2, '0')}
                  </div>
                )
              })}
            </div>
          )}

          {page === 'PADS' && (
            <div className="hw-sim-list">
              {Array.from({ length: 8 }, (_, row) => {
                const i = padsListTop + row
                const p = pads[i]
                const sel = i === padsListSelection
                const off = Boolean(p?.primary && !p.enabled)
                return (
                  <div key={i} className={`hw-sim-list-row${sel ? ' selected' : ''}`}>
                    <span className="hw-sim-list-idx">P{String(i + 1).padStart(2, '0')}</span>
                    <span className="hw-sim-list-type">{p?.primary ? PAD_TYPE_META[p.pad_type].label.split(' ')[0] : '--'}</span>
                    <span className={`hw-sim-list-note${off ? ' off' : ''}`}>{off ? 'OFF' : p?.primary ? `N${p.note}` : ''}</span>
                  </div>
                )
              })}
            </div>
          )}

          {page === 'PAD_EDIT' && (
            <div className="hw-sim-list">
              {!pad?.primary ? (
                <div className="hw-sim-consumed">
                  Canal ocupado
                  <br />
                  (2º canal do pad anterior)
                </div>
              ) : (
                <>
                  <div className="hw-sim-list-row hw-sim-list-row-info">
                    <span className="hw-sim-list-type">{PAD_TYPE_META[pad.pad_type].label}</span>
                  </div>
                  <div className={`hw-sim-list-row${editItemIndex === 0 ? ' selected' : ''}`}>
                    <span className="hw-sim-list-type">ATIVO</span>
                    <span className={`hw-sim-value-box${editItemIndex === 0 && editingValue ? ' editing' : ''}`}>
                      {pad.enabled ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  {fields.map((spec, i) => {
                    const sel = i + 1 === editItemIndex
                    const editingThis = sel && editingValue
                    return (
                      <div key={spec.field} className={`hw-sim-list-row${sel ? ' selected' : ''}`}>
                        <span className="hw-sim-list-type">{spec.label}</span>
                        <span className={`hw-sim-value-box${editingThis ? ' editing' : ''}`}>{pad[spec.field]}</span>
                      </div>
                    )
                  })}
                  <div className={`hw-sim-list-row${editItemIndex === fields.length + 1 ? ' selected' : ''}`}>
                    <span className="hw-sim-list-type">CALIBRAR</span>
                    <span className="hw-sim-value-box">INICIAR&gt;</span>
                  </div>
                </>
              )}
            </div>
          )}

          {page === 'SIGNAL' && pad?.primary && (
            <div className="hw-sim-signal">
              <svg viewBox="0 0 120 74" className="hw-sim-signal-plot">
                <line x1="2" y1="72" x2="118" y2="72" className="hw-sim-signal-axis" />
                <line x1="2" y1="0" x2="2" y2="72" className="hw-sim-signal-axis" />
                <polyline
                  className="hw-sim-signal-trace"
                  points={fakeEnvelope(signalSeed.current + editPadIndex, pad.threshold)
                    .map((v, i) => `${2 + i} ${72 - v * 0.6}`)
                    .join(' ')}
                />
              </svg>
              <div className="hw-sim-signal-stats">
                VEL <b>{40 + (editPadIndex * 7) % 88}</b> &nbsp; PEAK <b>{60 + (editPadIndex * 11) % 68}</b>
              </div>
              <div className="hw-sim-signal-footer">
                <span className="hw-sim-tag-accent">SCAN {pad.scan_time}</span>
                <span className="hw-sim-tag-line">MASK {pad.mask_time}</span>
                <span className="hw-sim-tag-edit">THR {pad.threshold}</span>
              </div>
            </div>
          )}

          {page === 'GLOBAL' && (
            <div className="hw-sim-list">
              {GLOBAL_ROWS.map((label, i) => {
                const sel = i === globalSelection
                const editingThis = sel && globalEditing
                const value =
                  i === 0
                    ? String(global.midi_channel)
                    : i === 1
                      ? MIDI_OUTPUT_LABELS[global.midi_output]
                      : '>'
                return (
                  <div key={label} className={`hw-sim-list-row${sel ? ' selected' : ''}`}>
                    <span className="hw-sim-list-type">{label}</span>
                    <span className={`hw-sim-value-box${editingThis ? ' editing' : ''}`}>{value}</span>
                  </div>
                )
              })}
            </div>
          )}

          {page === 'AUTOTUNE' && autoTune && (
            <div className="hw-sim-autotune">
              {autoTune.phase === 'noise' && (
                <>
                  <p className="hw-sim-autotune-title">OUÇA O RUÍDO</p>
                  <p className="hw-sim-autotune-sub">não toque no pad...</p>
                </>
              )}
              {autoTune.phase === 'collecting' && (
                <>
                  <p className="hw-sim-autotune-title">BATA NO PAD</p>
                  <p className="hw-sim-autotune-sub">intensidade normal/forte</p>
                  <p className="hw-sim-autotune-count">
                    {autoTune.hitCount}/{AUTOTUNE_HIT_TARGET}
                  </p>
                  <div className="hw-sim-autotune-bar">
                    <div
                      className="hw-sim-autotune-bar-fill"
                      style={{ width: `${(100 * autoTune.hitCount) / AUTOTUNE_HIT_TARGET}%` }}
                    />
                  </div>
                </>
              )}
              {autoTune.phase === 'done' && autoTune.result && (
                <>
                  <p className="hw-sim-autotune-title done">CALIBRADO!</p>
                  <div className="hw-sim-list-row">
                    <span className="hw-sim-list-type">SENSIB</span>
                    <span className="hw-sim-value-box">{autoTune.result.sensitivity}</span>
                  </div>
                  <div className="hw-sim-list-row">
                    <span className="hw-sim-list-type">THRESH</span>
                    <span className="hw-sim-value-box">{autoTune.result.threshold}</span>
                  </div>
                  <div className="hw-sim-list-row">
                    <span className="hw-sim-list-type">SCAN</span>
                    <span className="hw-sim-value-box">{autoTune.result.scan_time}</span>
                  </div>
                  <div className="hw-sim-list-row">
                    <span className="hw-sim-list-type">MASK</span>
                    <span className="hw-sim-value-box">{autoTune.result.mask_time}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {toast && (
            <div className="hw-sim-toast">
              <div className="hw-sim-toast-title">{toast.line1}</div>
              <div className="hw-sim-toast-subtitle">{toast.line2}</div>
            </div>
          )}

          {(page === 'PAD_EDIT' || page === 'GLOBAL') && (
            <div className="hw-sim-footer">
              <span>ENC2 GIRA VALOR</span>
              <span className="hw-sim-footer-accent">PUSH OK</span>
            </div>
          )}
          {page === 'AUTOTUNE' && (
            <div className="hw-sim-footer">
              <span>{autoTune?.phase === 'done' ? 'PUSH APLICA' : 'HOLD CANCELA'}</span>
              {autoTune?.phase === 'done' && <span className="hw-sim-footer-accent">HOLD SAI</span>}
            </div>
          )}
        </div>
      </div>

      <div className="hw-sim-controls">
        <div className="hw-sim-encoder">
          <button className="hw-sim-knob" style={{ transform: `rotate(${enc1Angle}deg)` }} {...enc1Handlers}>
            <span className="hw-sim-knob-mark" />
          </button>
          <span className="hw-sim-encoder-label">
            ENC1 — página / pad em foco
            <br />
            girar: roda do mouse · clique: PAD_EDIT⇄SIGNAL · manter: LIVE
          </span>
        </div>

        <div className="hw-sim-encoder">
          <button className="hw-sim-knob" style={{ transform: `rotate(${enc2Angle}deg)` }} {...enc2Handlers}>
            <span className="hw-sim-knob-mark" />
          </button>
          <span className="hw-sim-encoder-label">
            ENC2 — navegação / valor
            <br />
            girar: roda do mouse · clique: entrar/confirmar · manter: voltar
          </span>
        </div>
      </div>

      <p className="hw-sim-hint">
        Atalhos: <kbd>↑</kbd>/<kbd>↓</kbd> = ENC1, <kbd>←</kbd>/<kbd>→</kbd> = ENC2, <kbd>Enter</kbd> = clique ENC1,{' '}
        <kbd>Espaço</kbd> = clique ENC2. A tela SIGNAL mostra um envelope ilustrativo (não há ADC real no navegador).
      </p>

      <button className="hw-sim-reset" onClick={resetPreview}>
        Reiniciar dados de exemplo
      </button>
    </div>
  )
}
