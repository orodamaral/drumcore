import { ReactNode, useEffect, useRef, useState } from 'react'

// Debounce do envio durante o arraste - cada set_pad grava na EEPROM do
// módulo, então arrastar sem isso gerava dezenas de gravações por segundo.
// O valor final é sempre enviado no "change" (soltar o slider / sair do campo).
const SEND_DEBOUNCE_MS = 120

interface Props {
  id: string
  label: string
  help?: string
  min: number
  max: number
  step?: number
  value: number
  defaultValue?: number
  unit?: string
  zeroLabel?: string
  disabled?: boolean
  /** Valor proposto pela calibração automática (marca fantasma na trilha). */
  proposed?: number
  onCommit: (value: number) => void
  /** Conteúdo extra abaixo do slider (ex: aviso). */
  children?: ReactNode
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function pct(v: number, min: number, max: number): number {
  return max === min ? 0 : ((v - min) / (max - min)) * 100
}

// O centro do thumb (16px) vai de 8px até (largura - 8px), não de 0 a 100%.
function tickLeft(v: number, min: number, max: number): string {
  const p = pct(v, min, max)
  return `calc(${p}% + ${8 - p * 0.16}px)`
}

export function InfoTip({ id, text }: { id: string; text: string }) {
  return (
    <span className="info-tip">
      <button type="button" className="info-tip-btn" aria-describedby={id} aria-label="Ajuda">
        i
      </button>
      <span role="tooltip" id={id} className="info-tip-text">
        {text}
      </span>
    </span>
  )
}

export default function ParamSlider({
  id,
  label,
  help,
  min,
  max,
  step = 1,
  value,
  defaultValue,
  unit,
  zeroLabel,
  disabled,
  proposed,
  onCommit,
  children
}: Props) {
  const [local, setLocal] = useState(value)
  const [draftText, setDraftText] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSent = useRef(value)
  const dragging = useRef(false)

  // Ressincroniza com o módulo (ack/pad_config) quando não há interação em curso.
  useEffect(() => {
    lastSent.current = value
    if (!dragging.current && !timer.current) setLocal(value)
  }, [value])

  // Ao desmontar (ex: troca de pad), um envio ainda no debounce sai na hora
  // em vez de se perder.
  const flushRef = useRef<() => void>(() => undefined)
  flushRef.current = () => {
    if (timer.current) send(local)
  }
  useEffect(() => () => flushRef.current(), [])

  function send(v: number): void {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (v !== lastSent.current) {
      lastSent.current = v
      onCommit(v)
    }
  }

  function schedule(v: number): void {
    setLocal(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => send(v), SEND_DEBOUNCE_MS)
  }

  function commitText(): void {
    if (draftText === null) return
    const parsed = Number(draftText)
    setDraftText(null)
    if (draftText.trim() === '' || Number.isNaN(parsed)) return
    const v = clamp(Math.round(parsed / step) * step, min, max)
    setLocal(v)
    send(v)
  }

  function reset(): void {
    if (defaultValue === undefined || disabled) return
    setLocal(defaultValue)
    send(defaultValue)
  }

  const helpId = `${id}-help`
  const isDefault = defaultValue === undefined || local === defaultValue
  const hasProposal = proposed !== undefined && proposed !== local

  return (
    <div className={`param${disabled ? ' disabled' : ''}`}>
      <div className="param-head">
        <label htmlFor={id} className="param-label" onDoubleClick={reset} title={defaultValue !== undefined ? 'Duplo clique restaura o padrão' : undefined}>
          {label}
        </label>
        {help && <InfoTip id={helpId} text={help} />}
        {!isDefault && (
          <button
            type="button"
            className="param-reset"
            onClick={reset}
            disabled={disabled}
            aria-label={`Restaurar ${label} para o padrão (${defaultValue})`}
            title={`Restaurar padrão (${defaultValue})`}
          >
            ↺
          </button>
        )}
        {hasProposal && <span className="param-proposed-badge">proposto: {proposed}</span>}
      </div>

      <div className="param-body">
        <div className="param-track-wrap">
          <input
            id={id}
            className="param-range"
            type="range"
            min={min}
            max={max}
            step={step}
            value={local}
            disabled={disabled}
            aria-describedby={help ? helpId : undefined}
            style={{ '--fill': `${pct(local, min, max)}%` } as React.CSSProperties}
            onPointerDown={() => (dragging.current = true)}
            onPointerUp={() => (dragging.current = false)}
            onInput={(event) => schedule(Number(event.currentTarget.value))}
            onChange={(event) => schedule(Number(event.currentTarget.value))}
            onBlur={() => {
              dragging.current = false
              if (timer.current) send(local)
            }}
            onKeyUp={() => send(local)}
            onMouseUp={() => send(local)}
            onTouchEnd={() => send(local)}
          />
          {defaultValue !== undefined && (
            <span className="param-default-tick" style={{ left: tickLeft(defaultValue, min, max) }} aria-hidden />
          )}
          {hasProposal && (
            <span className="param-ghost-tick" style={{ left: tickLeft(proposed!, min, max) }} aria-hidden />
          )}
        </div>

        <div className="param-value">
          <input
            type="number"
            className="param-number"
            min={min}
            max={max}
            step={step}
            value={draftText ?? String(local)}
            disabled={disabled}
            aria-label={`${label} (valor)`}
            onChange={(event) => setDraftText(event.target.value)}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitText()
              if (event.key === 'Escape') setDraftText(null)
            }}
          />
          <span className="param-unit">{local === 0 && zeroLabel ? zeroLabel : unit ?? ''}</span>
        </div>
      </div>
      {children}
    </div>
  )
}
