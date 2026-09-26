import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { PadConfig, PadConfigPrimary } from '../protocol'
import {
  COPY_SECTIONS,
  CopySection,
  DEFAULT_COPY_SECTIONS,
  opsFromSnapshot,
  PadOp,
  padDisplayName,
  PadSnapshot,
  primaryPads,
  RESET_SECTIONS,
  resetOps,
  sectionLabel,
  snapshotPad
} from '../padActions'
import { padTypeLabel } from '../uiMeta'
import { useMidiMap } from '../midiMaps'

interface Props {
  pad: PadConfigPrimary
  allPads: Array<PadConfig | undefined>
  clipboard: PadSnapshot | null
  busy: boolean
  onCopy: (snap: PadSnapshot) => void
  onRun: (ops: PadOp[], label: string) => void
}

type Mode = 'paste' | 'copyTo' | 'reset'

const MODE_TITLE: Record<Mode, string> = {
  paste: 'Colar configuração',
  copyTo: 'Copiar para outros pads',
  reset: 'Restaurar padrões'
}

export default function PadActions({ pad, allPads, clipboard, busy, onCopy, onRun }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState<Mode | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Fecha o menu ao clicar fora.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && e.target !== buttonRef.current) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menuOpen])

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setMenuOpen(false)
      buttonRef.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }

  function pick(action: 'copy' | Mode): void {
    setMenuOpen(false)
    if (action === 'copy') onCopy(snapshotPad(pad))
    else setMode(action)
  }

  const clipboardFromOtherType = clipboard && clipboard.sourceType !== pad.pad_type

  return (
    <div className="pad-actions">
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Ações do pad"
        title="Ações do pad"
        disabled={busy}
        onClick={() => setMenuOpen((o) => !o)}
      >
        ⋯
      </button>

      {menuOpen && (
        <div className="menu" role="menu" ref={menuRef} onKeyDown={onMenuKey}>
          <button type="button" role="menuitem" onClick={() => pick('copy')}>
            Copiar configuração
          </button>
          <button type="button" role="menuitem" disabled={!clipboard} onClick={() => pick('paste')}>
            Colar configuração
            {clipboard && <span className="menu-hint">do Pad {clipboard.sourcePad + 1}</span>}
            {clipboardFromOtherType && <span className="menu-hint warn">outro tipo</span>}
          </button>
          <button type="button" role="menuitem" onClick={() => pick('copyTo')}>
            Copiar para outros pads…
          </button>
          <div className="menu-sep" role="separator" />
          <button type="button" role="menuitem" onClick={() => pick('reset')}>
            Restaurar padrões…
          </button>
        </div>
      )}

      {mode && (
        <PadActionDialog
          mode={mode}
          pad={pad}
          allPads={allPads}
          clipboard={clipboard}
          onClose={() => {
            setMode(null)
            buttonRef.current?.focus()
          }}
          onRun={onRun}
        />
      )}
    </div>
  )
}

function PadActionDialog({
  mode,
  pad,
  allPads,
  clipboard,
  onClose,
  onRun
}: {
  mode: Mode
  pad: PadConfigPrimary
  allPads: Array<PadConfig | undefined>
  clipboard: PadSnapshot | null
  onClose: () => void
  onRun: (ops: PadOp[], label: string) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const midiMap = useMidiMap()
  const availableSections = mode === 'reset' ? RESET_SECTIONS : COPY_SECTIONS
  const [sections, setSections] = useState<CopySection[]>(mode === 'reset' ? RESET_SECTIONS : DEFAULT_COPY_SECTIONS)
  const others = primaryPads(allPads).filter((p) => p.pad !== pad.pad)
  const [targets, setTargets] = useState<number[]>([])

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const snap = mode === 'paste' ? clipboard : mode === 'copyTo' ? snapshotPad(pad) : null

  const ops = useMemo(() => {
    if (mode === 'reset') return resetOps(pad, sections)
    if (!snap) return []
    if (mode === 'paste') return opsFromSnapshot(pad, snap, sections)
    return others.filter((p) => targets.includes(p.pad)).flatMap((p) => opsFromSnapshot(p, snap, sections))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pad, snap?.sourcePad, sections, targets, allPads])

  const padsTouched = new Set(ops.map((o) => o.pad)).size
  const sourceType = snap?.sourceType ?? pad.pad_type
  const typeMismatch =
    mode === 'paste'
      ? sourceType !== pad.pad_type
      : mode === 'copyTo' && others.some((p) => targets.includes(p.pad) && p.pad_type !== pad.pad_type)

  function toggle<T>(list: T[], item: T): T[] {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
  }

  function confirm(): void {
    const label =
      mode === 'reset'
        ? `Padrões restaurados no pad ${pad.pad + 1}`
        : mode === 'paste'
          ? `Configuração do pad ${snap!.sourcePad + 1} colada no pad ${pad.pad + 1}`
          : `Configuração do pad ${pad.pad + 1} copiada para ${padsTouched} pad${padsTouched === 1 ? '' : 's'}`
    onRun(ops, label)
    dialogRef.current?.close()
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="pad-action-title">
      <h2 id="pad-action-title">{MODE_TITLE[mode]}</h2>
      <p className="dialog-sub">
        {mode === 'reset' && <>Volta os valores do {padDisplayName(pad)} ao padrão de fábrica. Nome, tipo e notas não mudam.</>}
        {mode === 'paste' && snap && (
          <>
            Do Pad {snap.sourcePad + 1} para o {padDisplayName(pad)}.
          </>
        )}
        {mode === 'copyTo' && <>Leva a configuração do {padDisplayName(pad)} para os pads escolhidos.</>}
      </p>

      <fieldset className="dialog-group">
        <legend>O que {mode === 'reset' ? 'restaurar' : 'copiar'}</legend>
        <div className="check-row">
          {availableSections.map((s) => (
            <label key={s} className="check">
              <input type="checkbox" checked={sections.includes(s)} onChange={() => setSections((l) => toggle(l, s))} />
              {sectionLabel(s)}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'copyTo' && (
        <fieldset className="dialog-group">
          <legend>
            Pads de destino
            <span className="legend-actions">
              <button type="button" className="link-btn" onClick={() => setTargets(others.map((p) => p.pad))}>
                todos
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => setTargets(others.filter((p) => p.pad_type === pad.pad_type).map((p) => p.pad))}
              >
                mesmo tipo
              </button>
              <button type="button" className="link-btn" onClick={() => setTargets([])}>
                nenhum
              </button>
            </span>
          </legend>
          <div className="target-grid">
            {others.map((p) => (
              <label
                key={p.pad}
                className={`check target${p.enabled ? '' : ' off'}`}
                title={`${padTypeLabel(p.pad_type)}${p.enabled ? '' : ' · desligado'}`}
              >
                <input type="checkbox" checked={targets.includes(p.pad)} onChange={() => setTargets((l) => toggle(l, p.pad))} />
                <span className="target-num">{p.pad + 1}</span>
                <span className={`target-name${p.label ? '' : ' dim'}`}>{p.label || midiMap.names[p.note] || 'Sem nome'}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {typeMismatch && (
        <p className="dialog-warn">
          Tipos de sensor diferentes: os ajustes da 2ª zona (aro/borda/cup) não são copiados entre tipos diferentes, e
          campos que o destino não tem são ignorados.
        </p>
      )}

      <div className="dialog-foot">
        <span className="dialog-summary" aria-live="polite">
          {ops.length === 0
            ? mode === 'copyTo' && targets.length === 0
              ? 'Escolha ao menos um pad.'
              : 'Nada a mudar.'
            : `${ops.length} alteraç${ops.length === 1 ? 'ão' : 'ões'}${mode === 'copyTo' ? ` em ${padsTouched} pad${padsTouched === 1 ? '' : 's'}` : ''}`}
        </span>
        <button type="button" onClick={() => dialogRef.current?.close()}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={ops.length === 0} onClick={confirm}>
          {mode === 'reset' ? 'Restaurar' : mode === 'paste' ? 'Colar' : 'Copiar'}
        </button>
      </div>
    </dialog>
  )
}
