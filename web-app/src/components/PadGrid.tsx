import { Fragment, KeyboardEvent, useEffect, useRef } from 'react'
import { PadConfig, PAD_TYPE_META } from '../protocol'
import { boardOf, crossesJacks, jackLabel, jackPos, JACKS_PER_BOARD, twoChannelZones } from '../jacks'
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
  /** Apelidos dos jacks (tela LIVE) - aparecem no cabeçalho de cada bloco. */
  jackLabels: Record<number, string>
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

export default function PadGrid({ pads, selectedPad, lastHit, followHits, onFollowHitsChange, onSelect, jackLabels }: Props) {
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

  function renderRow(i: number, merged: boolean) {
    const pad = pads[i]
    const consumed = Boolean(pad && !pad.primary)
    const off = Boolean(pad?.primary && !pad.enabled)
    const selected = i === selectedPad
    const hit = lastHit?.pad === i ? lastHit : null
    const gm = pad?.primary ? map.names[pad.note] : undefined
    const zones = merged && pad?.primary ? twoChannelZones(pad.pad_type) : null

    return (
      <button
        key={i}
        data-pad={i}
        role="option"
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        className={`pad-row${selected ? ' selected' : ''}${consumed ? ' consumed' : ''}${off ? ' off' : ''}${merged ? ' merged' : ''}`}
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
        {!merged && <span className="jack-pos">{jackPos(i)}</span>}

        {consumed ? (
          <span className="pad-row-consumed">↳ 2ª zona do Pad {(pad as { consumed_by: number }).consumed_by + 1}</span>
        ) : (
          <>
            <span className="pad-row-main">
              <span className={`pad-row-name${pad?.primary && pad.label ? '' : ' unnamed'}`}>
                {/* Canal desligado sem nome: "livre" - o nome do instrumento
                    da nota que sobrou nele só confundia. */}
                {pad?.primary ? pad.label || (off ? 'livre' : gm) || 'Sem nome' : '…'}
              </span>
              {zones && (
                <span className="pad-row-sub">
                  <span className="jack-pos">tip</span> {zones[0]} <span className="jack-pos">ring</span> {zones[1]}
                </span>
              )}
            </span>
            <span className="pad-row-note">
              {off ? (
                <span className="pad-row-off">⏻ desligado</span>
              ) : pad?.primary ? (
                merged ? (
                  <>
                    {pad.note} <span className="dim">/</span> {pad.note_rim}
                  </>
                ) : (
                  <>
                    {pad.note} <span className="dim">· {noteName(pad.note, map)}</span>
                  </>
                )
              ) : (
                '—'
              )}
            </span>
          </>
        )}
      </button>
    )
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
        {Array.from({ length: Math.ceil(pads.length / 2) }, (_, j) => {
          const tip = 2 * j
          const ring = tip + 1
          const head = pads[tip]
          // Sensor de 2 canais no tip: ocupa o jack inteiro, vira um item só.
          const merged = Boolean(head?.primary && PAD_TYPE_META[head.pad_type].channels === 2)
          // Configuração que atravessa jacks (2 canais começando num ring).
          const crossIn = crossesJacks(pads[tip - 1])
          const crossOut = crossesJacks(pads[ring])
          const warn = crossIn
            ? `O tip deste jack está sendo usado como 2ª zona do Pad ${tip} (${jackLabel(j - 1)}) — pele e aro precisam estar no mesmo jack.`
            : crossOut
              ? `O Pad ${ring + 1} usa 2 canais começando no ring — a 2ª zona cai no ${jackLabel(j + 1)}. Sensores de 2 zonas precisam começar no tip (pad ímpar).`
              : undefined

          return (
            <Fragment key={j}>
              {j % JACKS_PER_BOARD === 0 && (
                <div className="board-sep" aria-hidden>
                  Placa {boardOf(j)} · jacks {j + 1}–{j + JACKS_PER_BOARD}
                </div>
              )}
              <div
                className={`jack-block${merged ? ' merged' : ''}${warn ? ' warn' : ''}`}
                role="group"
                aria-label={jackLabel(j)}
              >
                <div className="jack-head">
                  <span>{jackLabel(j)}</span>
                  {jackLabels[j] && <span className="jack-nick">{jackLabels[j]}</span>}
                  {warn && (
                    <span className="jack-warn" title={warn} aria-label={warn}>
                      ⚠
                    </span>
                  )}
                </div>
                {renderRow(tip, merged)}
                {!merged && ring < pads.length && renderRow(ring, false)}
              </div>
            </Fragment>
          )
        })}
      </div>

      <p className="pad-list-legend">
        <span className="legend-flash" aria-hidden /> pisca ao receber batida (mais forte = mais intenso)
      </p>
    </aside>
  )
}
