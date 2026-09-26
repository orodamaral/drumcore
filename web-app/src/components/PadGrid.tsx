import { KeyboardEvent, useEffect, useRef } from 'react'
import { PadConfig } from '../protocol'
import { noteName, useMidiMap } from '../midiMaps'

export interface HitEvent {
  pad: number
  velocity: number
  /** Incrementa a cada batida - reinicia a animação mesmo se o pad repetir. */
  seq: number
}

interface Props {
  pads: Array<PadConfig | undefined>
  selectedPad: number
  lastHit: HitEvent | null
  followHits: boolean
  onFollowHitsChange: (follow: boolean) => void
  onSelect: (pad: number) => void
}

export function isSelectable(pad: PadConfig | undefined): boolean {
  return !pad || pad.primary
}

/** Próximo pad selecionável na direção dada (pula canais consumidos). */
export function stepPad(pads: Array<PadConfig | undefined>, from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < pads.length; i += dir) {
    if (isSelectable(pads[i])) return i
  }
  return from
}

export default function PadGrid({ pads, selectedPad, lastHit, followHits, onFollowHitsChange, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const map = useMidiMap()

  // Mantém o item selecionado visível (troca por teclado / "seguir pad tocado").
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-pad="${selectedPad}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedPad])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.altKey) return // Alt+↑/↓ é tratado globalmente no App
    const key = event.key
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'ArrowLeft' && key !== 'ArrowRight') return
    event.preventDefault()
    const next = stepPad(pads, selectedPad, key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1)
    onSelect(next)
    listRef.current?.querySelector<HTMLElement>(`[data-pad="${next}"]`)?.focus()
  }

  return (
    <aside className="pad-list-panel">
      <div className="pad-list-header">
        <span className="section-title">Pads</span>
        <label className="switch small" title="Seleciona automaticamente o pad que você tocar">
          <input type="checkbox" checked={followHits} onChange={(e) => onFollowHitsChange(e.target.checked)} />
          <span className="switch-track" aria-hidden />
          Seguir pad tocado
        </label>
      </div>

      <div className="pad-list" ref={listRef} role="listbox" aria-label="Pads" onKeyDown={onKeyDown}>
        {pads.map((pad, i) => {
          const consumed = Boolean(pad && !pad.primary)
          const off = Boolean(pad?.primary && !pad.enabled)
          const selected = i === selectedPad
          const hit = lastHit?.pad === i ? lastHit : null
          const gm = pad?.primary ? map.names[pad.note] : undefined

          return (
            <button
              key={i}
              data-pad={i}
              role="option"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={`pad-row${selected ? ' selected' : ''}${consumed ? ' consumed' : ''}${off ? ' off' : ''}`}
              onClick={() => onSelect(i)}
              disabled={consumed}
              title={
                consumed
                  ? 'Canal usado como 2ª zona de outro pad'
                  : off
                    ? 'Canal desligado — o módulo ignora este slot'
                    : undefined
              }
            >
              {hit && (
                <span
                  key={hit.seq}
                  className="pad-row-flash"
                  style={{ '--vel': (hit.velocity / 127).toFixed(2) } as React.CSSProperties}
                  aria-hidden
                />
              )}
              <span className="pad-row-number">{i + 1}</span>

              {consumed ? (
                <span className="pad-row-consumed">↳ 2ª zona do Pad {(pad as { consumed_by: number }).consumed_by + 1}</span>
              ) : (
                <>
                  <span className={`pad-row-name${pad?.primary && pad.label ? '' : ' unnamed'}`}>
                    {pad?.primary ? pad.label || gm || 'Sem nome' : '…'}
                  </span>
                  <span className="pad-row-note">
                    {off ? (
                      <span className="pad-row-off">⏻ desligado</span>
                    ) : pad?.primary ? (
                      <>
                        {pad.note} <span className="dim">· {noteName(pad.note, map)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>

      <p className="pad-list-legend">
        <span className="legend-flash" aria-hidden /> pisca ao receber batida (mais forte = mais intenso)
      </p>
    </aside>
  )
}
