import { ReactNode, useEffect, useState } from 'react'
import {
  AUTOTUNE_HH_HOLD_MS,
  AUTOTUNE_TIER_WINDOW_MS,
  autoTuneShapeFor,
  autoTuneZonesFor,
  AutoTuneShape,
  AutoTuneStatus,
  FieldSpec,
  PadConfig,
  PadConfigPrimary,
  PadField,
  PadType,
  PAD_LABEL_MAX_LEN,
  PAD_TYPE_META,
  PAD_TYPES,
  HIDDEN_PAD_TYPES
} from '../protocol'
import { CURVE_NAMES, FIELD_UI, NOTE_FIELDS, padTypeLabel, SectionKey, SECTION_TITLES } from '../uiMeta'
import { noteName, useMidiMap } from '../midiMaps'
import MidiMapSelect from './MidiMapSelect'
import { canStartTwoChannel, crossesJacks, jackLabel, jackOf, jackPos, twoChannelZones } from '../jacks'
import PadActions from './PadActions'
import { PadOp, PadSnapshot } from '../padActions'
import ParamSlider, { InfoTip } from './ParamSlider'
import NoteField from './NoteField'
import CurveField from './CurveField'
import HitMonitor from './HitMonitor'

interface Props {
  pad?: PadConfig
  allPads: Array<PadConfig | undefined>
  hitHistory: number[]
  onSimulateHit?: () => void
  onPrev: () => void
  onNext: () => void
  clipboard: PadSnapshot | null
  batchBusy: boolean
  onCopyPad: (snap: PadSnapshot) => void
  onRunOps: (ops: PadOp[], label: string) => void
  onOpenApplyMap: () => void
  /** Rótulo do que Ctrl+Z desfaria / Ctrl+Shift+Z refaria (undefined = nada). */
  undoLabel?: string
  redoLabel?: string
  onUndo: () => void
  onRedo: () => void
  onChange: (field: PadField, value: number) => void
  onRename: (label: string) => void
  onChangeType: (type: PadType) => void
  onChangeHihatLink: (channel: number) => void
  onChangeEnabled: (enabled: boolean) => void
  onChangeHihatInvert: (invert: boolean) => void
  onChangePedalNote: (enabled: boolean) => void
  /** Status do assistente de auto-calibração pra ESTE pad - null se não estiver rodando aqui. */
  autoTune: AutoTuneStatus | null
  onStartAutoTune: () => void
  onCancelAutoTune: () => void
  onApplyAutoTune: () => void
  /** Aplica só parte da calibração: cancel_autotune + set_pad dos campos escolhidos. */
  onApplyAutoTunePartial: (ops: PadOp[], label: string) => void
}

type Primary = PadConfigPrimary

// Campos que o resultado do auto-tune pode trazer (mesmos nomes do pad_config).
const AUTOTUNE_FIELDS = [
  'sensitivity',
  'threshold',
  'scan_time',
  'mask_time',
  'rim_sensitivity',
  'rim_threshold',
  'curve_type',
  'retrigger'
] as const satisfies readonly PadField[]

// apply_autotune no firmware também força gain = 100 (o resultado foi medido
// com gain neutro - ver applyAutoTuneResult() em main.cpp), mesmo sem esse
// campo vir no autotune_status. O app mostra isso explicitamente.
const AUTOTUNE_FORCED_GAIN = 100

function proposalsFrom(status: AutoTuneStatus | null, pad?: PadConfig): Partial<Record<PadField, number>> {
  if (!status || status.state !== 'done') return {}
  const out: Partial<Record<PadField, number>> = {}
  for (const f of AUTOTUNE_FIELDS) {
    const v = status[f]
    if (v !== undefined) out[f] = v
  }
  if (pad?.primary && pad.gain !== AUTOTUNE_FORCED_GAIN) out.gain = AUTOTUNE_FORCED_GAIN
  return out
}

function primaryPads(all: Array<PadConfig | undefined>): Primary[] {
  return all.filter((p): p is Primary => Boolean(p?.primary))
}

/** Outros pads/zonas (habilitados) que já usam a mesma nota. */
function notesSharedWith(all: Array<PadConfig | undefined>, self: Primary, selfField: PadField, note: number): string[] {
  const out: string[] = []
  for (const p of primaryPads(all)) {
    if (!p.enabled) continue
    for (const spec of PAD_TYPE_META[p.pad_type].fields) {
      if (!NOTE_FIELDS.includes(spec.field)) continue
      if (p.pad === self.pad && spec.field === selfField) continue
      if (p[spec.field] !== note) continue
      out.push(p.pad === self.pad ? spec.label : spec.field === 'note' ? `Pad ${p.pad + 1}` : `Pad ${p.pad + 1} (${spec.label})`)
    }
  }
  return out
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="editor-section">
      <div className="section-head">
        <h3 className="section-title">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export default function PadEditor({
  pad,
  allPads,
  hitHistory,
  onSimulateHit,
  onPrev,
  onNext,
  clipboard,
  batchBusy,
  onCopyPad,
  onRunOps,
  onOpenApplyMap,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  onChange,
  onRename,
  onChangeType,
  onChangeHihatLink,
  onChangeEnabled,
  onChangeHihatInvert,
  onChangePedalNote,
  autoTune,
  onStartAutoTune,
  onCancelAutoTune,
  onApplyAutoTune,
  onApplyAutoTunePartial
}: Props) {
  const [draftLabel, setDraftLabel] = useState(pad?.primary ? pad.label : '')
  const midiMap = useMidiMap()

  // Ressincroniza o campo com o que veio do módulo sempre que trocar de pad
  // ou quando a confirmação do rename chegar (pad.label mudou de fora).
  useEffect(() => {
    setDraftLabel(pad?.primary ? pad.label : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad?.pad, pad?.primary && pad.label])

  if (!pad) {
    return <div className="pad-editor empty">Carregando configuração do pad...</div>
  }

  if (!pad.primary) {
    return (
      <div className="pad-editor empty">
        Este canal é o 2º canal do <strong>Pad {pad.consumed_by + 1}</strong> (tipo de sensor de 2 canais) — não tem
        configuração própria. Mude o tipo do Pad {pad.consumed_by + 1} pra "1 canal" se quiser liberar esse canal.
      </div>
    )
  }

  const activePad = pad // narrowing (pad.primary === true) fica retido nessa const pros closures abaixo

  function commitLabel(): void {
    if (draftLabel !== activePad.label) {
      onRename(draftLabel)
    }
  }

  const meta = PAD_TYPE_META[activePad.pad_type]
  const disabled = !activePad.enabled
  const proposed = proposalsFrom(autoTune, activePad)
  const gmName = midiMap.names[activePad.note]

  const availablePedals = primaryPads(allPads).filter((p) => PAD_TYPE_META[p.pad_type].isHihatPedal)

  // Agrupa os campos do tipo atual nas seções (a ordem de envio não muda -
  // cada campo continua sendo um set_pad independente).
  const bySection: Record<SectionKey, FieldSpec[]> = { detection: [], response: [], xtalk: [], midi: [] }
  for (const spec of meta.fields) bySection[FIELD_UI[spec.field].section].push(spec)
  for (const list of Object.values(bySection)) list.sort((a, b) => FIELD_UI[a.field].order - FIELD_UI[b.field].order)

  function renderField(spec: FieldSpec): ReactNode {
    const ui = FIELD_UI[spec.field]
    const id = `field-${spec.field}`

    if (NOTE_FIELDS.includes(spec.field)) {
      return (
        <NoteField
          key={spec.field}
          id={id}
          label={spec.label}
          help={ui.help}
          value={activePad[spec.field]}
          // Pedal com o chick desligado: a nota não é enviada - campo fica inativo.
          disabled={disabled || (meta.isHihatPedal && spec.field === 'note' && !activePad.pedal_note)}
          sharedWith={notesSharedWith(allPads, activePad, spec.field, activePad[spec.field])}
          onCommit={(v) => onChange(spec.field, v)}
        />
      )
    }

    if (spec.field === 'curve_type') {
      return (
        <CurveField
          key={spec.field}
          value={activePad.curve_type}
          proposed={proposed.curve_type}
          disabled={disabled}
          help={ui.help}
          onCommit={(v) => onChange('curve_type', v)}
        />
      )
    }

    if (spec.field === 'xtalk_group') {
      const members = primaryPads(allPads)
        .filter((p) => p.xtalk_group === activePad.xtalk_group && p.xtalk_group > 0)
        .map((p) => p.pad + 1)
      return (
        <div key={spec.field} className={`param${disabled ? ' disabled' : ''}`}>
          <div className="param-head">
            <span className="param-label" id="xtalk-group-label">
              {spec.label}
            </span>
            <InfoTip id="xtalk-group-help" text={ui.help} />
          </div>
          <div className="segmented" role="radiogroup" aria-labelledby="xtalk-group-label" aria-describedby="xtalk-group-help">
            {Array.from({ length: spec.max - spec.min + 1 }, (_, k) => spec.min + k).map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={activePad.xtalk_group === g}
                className={activePad.xtalk_group === g ? 'active' : ''}
                disabled={disabled}
                onClick={() => activePad.xtalk_group !== g && onChange('xtalk_group', g)}
              >
                {g === 0 ? 'Nenhum' : g}
              </button>
            ))}
          </div>
          <p className="param-note">
            {activePad.xtalk_group === 0
              ? 'Sem grupo — o crosstalk abaixo não tem efeito.'
              : `Pads neste grupo: ${members.join(', ')}`}
          </p>
        </div>
      )
    }

    return (
      <ParamSlider
        key={spec.field}
        id={id}
        label={spec.label}
        help={ui.help}
        min={spec.min}
        max={spec.max}
        value={activePad[spec.field]}
        defaultValue={ui.defaultValue}
        unit={ui.unit}
        zeroLabel={ui.zeroLabel}
        disabled={disabled}
        proposed={proposed[spec.field]}
        onCommit={(v) => onChange(spec.field, v)}
      />
    )
  }

  const showMonitor = activePad.pad_type !== 9 && !meta.isHihatPedal

  return (
    <div className={`pad-editor${disabled ? ' is-off' : ''}`}>
      <header className="editor-header">
        <div className="editor-title-row">
          <button type="button" className="icon-btn" onClick={onPrev} aria-label="Pad anterior" title="Pad anterior (Alt+↑)">
            ◀
          </button>
          <span className="editor-title-prefix">Pad {activePad.pad + 1}</span>
          <span className="editor-title-sep" aria-hidden>
            ·
          </span>
          <input
            type="text"
            className="editor-title-input"
            value={draftLabel}
            maxLength={PAD_LABEL_MAX_LEN}
            placeholder={gmName ?? 'Nome do pad (ex: Caixa)'}
            aria-label="Nome do pad"
            title="Clique para renomear"
            onChange={(event) => setDraftLabel(event.target.value)}
            onBlur={commitLabel}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitLabel()
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                setDraftLabel(activePad.label)
                event.currentTarget.blur()
              }
            }}
          />
          <span className="editor-title-edit" aria-hidden>
            ✎
          </span>
          <div className="history-btns">
            <button
              type="button"
              className="icon-btn"
              onClick={onUndo}
              disabled={!undoLabel || batchBusy}
              aria-label={undoLabel ? `Desfazer: ${undoLabel}` : 'Desfazer'}
              title={undoLabel ? `Desfazer: ${undoLabel} (Ctrl+Z)` : 'Nada para desfazer'}
            >
              ↶
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onRedo}
              disabled={!redoLabel || batchBusy}
              aria-label={redoLabel ? `Refazer: ${redoLabel}` : 'Refazer'}
              title={redoLabel ? `Refazer: ${redoLabel} (Ctrl+Shift+Z)` : 'Nada para refazer'}
            >
              ↷
            </button>
          </div>
          <PadActions
            pad={activePad}
            allPads={allPads}
            clipboard={clipboard}
            busy={batchBusy}
            onCopy={onCopyPad}
            onRun={onRunOps}
          />
          <button type="button" className="icon-btn" onClick={onNext} aria-label="Próximo pad" title="Próximo pad (Alt+↓)">
            ▶
          </button>
        </div>

        <div className="editor-chips">
          <label className="switch">
            <input type="checkbox" checked={activePad.enabled} onChange={(event) => onChangeEnabled(event.target.checked)} />
            <span className="switch-track" aria-hidden />
            {activePad.enabled ? 'Ativo' : 'Inativo'}
          </label>
          <span className="chip">
            nota {activePad.note} · {noteName(activePad.note, midiMap)}
          </span>
          <span className="chip">{padTypeLabel(activePad.pad_type)}</span>
          <span className="chip" title="Onde plugar o cabo na jackboard">
            {crossesJacks(activePad)
              ? `⚠ ${jackLabel(jackOf(activePad.pad))} ring + ${jackLabel(jackOf(activePad.pad) + 1)} tip`
              : `${jackLabel(jackOf(activePad.pad))} · ${meta.channels === 2 ? 'tip + ring' : jackPos(activePad.pad)}`}
          </span>
        </div>

        {disabled && (
          <p className="pad-hint">
            Canal desligado — o módulo ignora esse slot por completo (nenhum hit, nenhuma nota). Use pra slots sem sensor
            físico conectado, pra evitar ruído/interferência sendo lido como pancada.
          </p>
        )}
      </header>

      {activePad.pad_type !== 9 && (
        // PAD_CHOKE (fita de contato): gatilho binario, sem envelope de
        // piezo pra calibrar - o assistente de auto-tune nao se aplica
        // (firmware/mockDevice recusam start_autotune pra esse tipo).
        <AutoTunePanel
          pad={activePad}
          status={autoTune}
          onStart={onStartAutoTune}
          onCancel={onCancelAutoTune}
          onApply={onApplyAutoTune}
          onApplyPartial={onApplyAutoTunePartial}
        />
      )}

      {/* key: recria os campos ao trocar de pad - sem isso um rascunho
          digitado num campo numérico "vazava" pro pad seguinte. */}
      <div className="editor-columns" key={activePad.pad}>
        <div className="editor-col">
          <Section title="Identificação">
            <div className="param">
              <div className="param-head">
                <label htmlFor="pad-type-select" className="param-label">
                  Tipo de sensor
                </label>
              </div>
              <select
                id="pad-type-select"
                className="full-select"
                value={activePad.pad_type}
                onChange={(event) => onChangeType(Number(event.target.value) as PadType)}
              >
                {PAD_TYPES.filter((type) => !HIDDEN_PAD_TYPES.includes(type) || type === activePad.pad_type).map((type) => {
                  // Sensor de 2 canais só no tip (pad ímpar): no ring a 2ª
                  // zona cairia no jack seguinte - ver jacks.ts.
                  const blocked =
                    PAD_TYPE_META[type].channels === 2 && !canStartTwoChannel(activePad.pad) && type !== activePad.pad_type
                  return (
                    <option key={type} value={type} disabled={blocked}>
                      {padTypeLabel(type)}
                      {blocked ? ' — só no tip (pad ímpar)' : ''}
                    </option>
                  )
                })}
              </select>
              {crossesJacks(activePad) ? (
                <p className="dialog-warn">
                  Este sensor usa 2 canais começando no <strong>ring</strong> do {jackLabel(jackOf(activePad.pad))}, e a
                  2ª zona cai no Pad {activePad.pad + 2}, que já é o tip do {jackLabel(jackOf(activePad.pad) + 1)}. Pele
                  e aro precisam estar no mesmo cabo estéreo: configure este sensor no Pad {activePad.pad} (tip deste
                  jack) ou troque o tipo.
                </p>
              ) : meta.channels === 2 ? (
                <p className="param-note">
                  Usa o {jackLabel(jackOf(activePad.pad))} inteiro: <strong>tip</strong> (Pad {activePad.pad + 1}) ={' '}
                  {twoChannelZones(activePad.pad_type)[0]}, <strong>ring</strong> (Pad {activePad.pad + 2}) ={' '}
                  {twoChannelZones(activePad.pad_type)[1]}.
                </p>
              ) : !canStartTwoChannel(activePad.pad) ? (
                <p className="param-note">
                  Ring do {jackLabel(jackOf(activePad.pad))} — sensores de 2 zonas só podem começar no tip (pad ímpar).
                </p>
              ) : null}
            </div>

            {meta.isHihatCymbal && (
              <div className="param">
                <div className="param-head">
                  <label htmlFor="hihat-link-select" className="param-label">
                    Pedal linkado
                  </label>
                </div>
                <select
                  id="hihat-link-select"
                  className="full-select"
                  value={activePad.hihat_pedal_channel}
                  onChange={(event) => onChangeHihatLink(Number(event.target.value))}
                >
                  <option value={-1}>Nenhum (sempre "aberto")</option>
                  {availablePedals.map((p) => (
                    <option key={p.pad} value={p.pad}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {meta.isHihatPedal && (
              <div className="param">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={activePad.hihat_invert}
                    onChange={(event) => onChangeHihatInvert(event.target.checked)}
                  />
                  <span className="switch-track" aria-hidden />
                  Inverter
                </label>
                <p className="param-note">
                  Alguns sensores mandam a posição invertida (pedal fechado = CC baixo, quando deveria ser alto, ou
                  vice-versa) — liga isso pra corrigir. Não precisa recalibrar depois de mudar.
                </p>
                <label className="switch pedal-note-switch">
                  <input
                    type="checkbox"
                    checked={activePad.pedal_note}
                    onChange={(event) => onChangePedalNote(event.target.checked)}
                  />
                  <span className="switch-track" aria-hidden />
                  Enviar nota ao fechar (chick)
                </label>
                <p className="param-note">
                  {activePad.pedal_note
                    ? 'Ao fechar o pedal rápido, manda a nota de chick (seção MIDI), além do CC de posição.'
                    : 'Só o CC de posição é enviado — o software (ex: Addictive Drums 2) decide o chick e a abertura do chimbal.'}
                </p>
              </div>
            )}
          </Section>

          {bySection.detection.length > 0 && (
            <Section title={SECTION_TITLES.detection}>
              {showMonitor && <HitMonitor history={hitHistory} onSimulate={onSimulateHit} />}
              {bySection.detection.map(renderField)}
            </Section>
          )}
        </div>

        <div className="editor-col">
          {(['response', 'xtalk', 'midi'] as const).map(
            (key) =>
              bySection[key].length > 0 && (
                <Section key={key} title={SECTION_TITLES[key]} aside={
                    key === 'midi' ? (
                      <span className="section-aside">
                        <button
                          type="button"
                          className="link-btn"
                          onClick={onOpenApplyMap}
                          disabled={batchBusy}
                          title="Preencher as notas de todos os pads pelo mapa"
                        >
                          Aplicar a todos…
                        </button>
                        <MidiMapSelect compact />
                      </span>
                    ) : undefined
                  }>
                  {bySection[key].map(renderField)}
                </Section>
              )
          )}
        </div>
      </div>
    </div>
  )
}

const ZONE_LABEL_PT: Record<string, string> = {
  head: 'pele',
  rim: 'aro',
  bow: 'bow',
  edge: 'edge',
  cup: 'cup'
}

// "Bata {ZONE_HIT_PHRASE[zone]}" - inclui a preposição certa pro genero de
// cada termo (pele=fem, resto=masc/estrangeirismo tratado como masc).
const ZONE_HIT_PHRASE: Record<string, string> = {
  head: 'na pele',
  rim: 'no aro',
  bow: 'no bow',
  edge: 'no edge',
  cup: 'no cup'
}

// Assistente de auto-calibração (Fase O) - bate no pad algumas vezes e o
// firmware calcula sensibilidade/threshold/scan/mask sozinho, em vez de
// ajustar cada slider por tentativa e erro. Ver docs/01-decisoes-
// arquiteturais.md (inspirado no "Auto Tune" do microDRUM/nanoDRUM).
//
// Fase U/V: pads de 2 canais rodam 1 (PAD_DUAL) ou 2 (prato/caixa 3
// zonas) passadas extras (mais 3 níveis cada) pra também calibrar
// rim_sensitivity/rim_threshold - ver autoTuneShapeFor()/autoTuneZonesFor()
// em protocol.ts, fonte única desse mapeamento.
function AutoTunePanel({
  pad,
  status,
  onStart,
  onCancel,
  onApply,
  onApplyPartial
}: {
  pad: Primary
  status: AutoTuneStatus | null
  onStart: () => void
  onCancel: () => void
  onApply: () => void
  onApplyPartial: (ops: PadOp[], label: string) => void
}) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  // Linhas desmarcadas pelo usuário (por padrão tudo que muda vai marcado).
  const [excluded, setExcluded] = useState<PadField[]>([])
  useEffect(() => {
    if (status?.state === 'done') setExcluded([])
  }, [status?.state])
  const padType = pad.pad_type
  const enabled = pad.enabled
  const running = status !== null && status.state !== 'idle'
  const shape: AutoTuneShape = autoTuneShapeFor(padType)
  const zones = autoTuneZonesFor(padType)
  const extraZoneLabels = zones.slice(1).map((z) => ZONE_LABEL_PT[z] ?? z)
  const isHihatPedal = PAD_TYPE_META[padType].isHihatPedal

  // Esc descarta a proposta (não é destrutivo - só não aplica).
  useEffect(() => {
    if (status?.state !== 'done') return
    // Ignora o Esc que fecha um diálogo aberto por cima (ex: ações do pad).
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('dialog[open]') && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status?.state, onCancel])

  if (!running) {
    return (
      <div className="autotune-panel idle">
        <button className="btn-primary" onClick={onStart} disabled={!enabled}>
          Calibrar automaticamente
        </button>
        {isHihatPedal ? (
          <p className="autotune-desc">
            Segure o pedal <strong>solto</strong> e depois <strong>pressionado até o fim</strong>, uns segundos cada — o
            módulo calcula o range sozinho, pra o CC ir de 0 a 127 no percurso real do seu pedal.
            {!enabled && ' Ative o canal pra poder calibrar.'}
          </p>
        ) : (
          <p className="autotune-desc">
            Bata <strong>fraco</strong>, <strong>médio</strong> e <strong>forte</strong>, {AUTOTUNE_TIER_WINDOW_MS / 1000}s
            cada — o módulo calcula sensibilidade, threshold, scan, mask, curva e retrigger.
            {shape !== 'single' &&
              ` Depois repete ${extraZoneLabels.map((l) => `no ${l}`).join(' e depois ')}.`}
            {!enabled && ' Ative o canal pra poder calibrar.'}
          </p>
        )}
      </div>
    )
  }

  if (status.state === 'noise') {
    return (
      <div className="autotune-panel active">
        <p className="autotune-instruction">Medindo ruído de fundo — não toque no pad...</p>
        <button className="btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    )
  }

  if (status.state === 'collecting' && status.phase) {
    const isOpenPhase = status.phase === 'hh_open'
    const elapsed = status.hold_elapsed_ms ?? 0
    const target = status.hold_target_ms ?? AUTOTUNE_HH_HOLD_MS
    const remainSec = Math.max(0, Math.ceil((target - elapsed) / 1000))
    return (
      <div className="autotune-panel active">
        <p className="autotune-tier">{isOpenPhase ? 'POSIÇÃO ABERTA' : 'POSIÇÃO FECHADA'}</p>
        <p className="autotune-instruction">
          {isOpenPhase ? 'Solte o pedal totalmente' : 'Pressione o pedal até o fim'} — {remainSec}s
        </p>
        <div className="autotune-progress">
          <div className="autotune-progress-bar" style={{ width: `${Math.min(100, (100 * elapsed) / target)}%` }} />
        </div>
        <button className="btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    )
  }

  if (status.state === 'collecting') {
    const tierLabel = status.tier === 'weak' ? 'fraco' : status.tier === 'strong' ? 'forte' : 'médio'
    const zoneHitPhrase = status.zone ? (ZONE_HIT_PHRASE[status.zone] ?? 'no pad') : 'no pad'
    // Fase AA: nível agora é uma janela de TEMPO (era uma meta fixa de
    // golpes) - mesmo padrão do bloco HHC acima (hold_elapsed_ms/
    // hold_target_ms). hit_count vira só info complementar.
    const elapsed = status.tier_elapsed_ms ?? 0
    const target = status.tier_target_ms ?? AUTOTUNE_TIER_WINDOW_MS
    const remainSec = Math.max(0, Math.ceil((target - elapsed) / 1000))
    return (
      <div className="autotune-panel active">
        {status.tier_index && status.tier_count && (
          <p className="autotune-tier">
            {status.zone && `${(ZONE_LABEL_PT[status.zone] ?? status.zone).toUpperCase()} — `}
            Nível {status.tier_index}/{status.tier_count}
          </p>
        )}
        <p className="autotune-instruction">
          Bata {zoneHitPhrase} com toque <strong>{tierLabel}</strong> — {remainSec}s
        </p>
        <div className="autotune-progress">
          <div className="autotune-progress-bar" style={{ width: `${Math.min(100, (100 * elapsed) / target)}%` }} />
        </div>
        <div className="autotune-footer">
          <span className="autotune-count">{status.hit_count} batidas</span>
          <button className="btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  if (status.state === 'done') {
    // Reaproveita os mesmos rótulos dos campos do tipo desse pad (ver
    // PAD_TYPE_META) - pra prato/caixa 3 zonas rim_sensitivity/rim_threshold
    // são na verdade os thresholds de edge/cup, não de aro.
    const fields = PAD_TYPE_META[padType].fields
    const labelOf = (f: PadField, fallback: string) => fields.find((s) => s.field === f)?.label ?? fallback
    const isHihatRange = status.mode === 'hihat_range'
    const rows: Array<{ field: PadField; label: string }> = isHihatRange
      ? [
          { field: 'sensitivity', label: 'Máximo (fechado)' },
          { field: 'threshold', label: 'Mínimo (aberto)' }
        ]
      : [
          { field: 'sensitivity', label: 'Sensibilidade' },
          { field: 'threshold', label: 'Threshold' },
          { field: 'scan_time', label: 'Scan time' },
          { field: 'mask_time', label: 'Mask time' }
        ]
    rows.push(
      { field: 'rim_sensitivity', label: labelOf('rim_sensitivity', 'Sensib. 2ª zona') },
      { field: 'rim_threshold', label: labelOf('rim_threshold', 'Threshold 2ª zona') },
      { field: 'curve_type', label: 'Curva' },
      { field: 'retrigger', label: 'Retrigger' }
    )
    const fmt = (f: PadField, v: number) =>
      f === 'curve_type' ? (CURVE_NAMES[v] ?? String(v)) : `${v}${FIELD_UI[f].unit ? ` ${FIELD_UI[f].unit}` : ''}`
    const diff: Array<{ field: PadField; label: string; current: number; next: number; note?: string }> = rows
      .map((r) => ({ ...r, current: pad[r.field], next: status[r.field as keyof AutoTuneStatus] as number | undefined }))
      .filter((r): r is typeof r & { next: number } => r.next !== undefined)
    if (pad.gain !== AUTOTUNE_FORCED_GAIN) {
      diff.push({
        field: 'gain',
        label: 'Gain (calibração)',
        current: pad.gain,
        next: AUTOTUNE_FORCED_GAIN,
        note: 'os valores acima foram medidos com gain 100%'
      })
    }
    const changed = diff.filter((r) => r.next !== r.current)
    const shown = showUnchanged ? diff : changed
    const selected = changed.filter((r) => !excluded.includes(r.field))
    const partial = selected.length < changed.length
    // Sensibilidade/threshold calculados com gain 100% mas gain antigo mantido.
    const gainMismatch =
      excluded.includes('gain') &&
      changed.some((r) => r.field === 'gain') &&
      selected.some((r) => ['sensitivity', 'threshold', 'rim_sensitivity', 'rim_threshold'].includes(r.field))

    function toggle(field: PadField): void {
      setExcluded((l) => (l.includes(field) ? l.filter((f) => f !== field) : [...l, field]))
    }

    function apply(): void {
      if (!partial) return onApply()
      const n = selected.length
      onApplyPartial(
        selected.map((r) => ({ pad: pad.pad, field: r.field, value: r.next })),
        `${n} valor${n === 1 ? '' : 'es'} da calibração aplicado${n === 1 ? '' : 's'} ao pad ${pad.pad + 1}`
      )
    }

    return (
      <div className="autotune-panel done" role="region" aria-label="Resultado da calibração">
        <div className="autotune-done-head">
          <p className="autotune-instruction">
            <strong>Calibração do pad {pad.pad + 1}</strong> — {changed.length} de {diff.length} valores mudam
          </p>
          {diff.length > changed.length && (
            <button type="button" className="link-btn" onClick={() => setShowUnchanged((s) => !s)}>
              {showUnchanged ? 'Ocultar sem mudança' : 'Mostrar todos'}
            </button>
          )}
        </div>
        <table className="diff-table">
          <thead>
            <tr>
              <th className="diff-check">
                {changed.length > 1 && (
                  <input
                    type="checkbox"
                    aria-label="Marcar todos"
                    checked={!partial}
                    ref={(el) => {
                      if (el) el.indeterminate = partial && selected.length > 0
                    }}
                    onChange={() => setExcluded(partial ? [] : changed.map((r) => r.field))}
                  />
                )}
              </th>
              <th>Parâmetro</th>
              <th>Atual</th>
              <th>Proposto</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const same = r.next === r.current
              const on = !same && !excluded.includes(r.field)
              const arrow = same || r.field === 'curve_type' ? '' : r.next > r.current ? ' ↑' : ' ↓'
              return (
                <tr key={r.field} className={same ? 'same' : on ? '' : 'skipped'}>
                  <td className="diff-check">
                    {!same && (
                      <input type="checkbox" checked={on} aria-label={`Aplicar ${r.label}`} onChange={() => toggle(r.field)} />
                    )}
                  </td>
                  <td>
                    {r.label}
                    {r.note && <div className="diff-note">{r.note}</div>}
                  </td>
                  <td>{fmt(r.field, r.current)}</td>
                  <td className="diff-next">
                    {fmt(r.field, r.next)}
                    {arrow && <span className="diff-arrow">{arrow}</span>}
                    {same && <span className="diff-same"> sem mudança</span>}
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr className="same">
                <td colSpan={4}>Nenhum valor muda — a configuração atual já bate com a calibração.</td>
              </tr>
            )}
          </tbody>
        </table>
        {gainMismatch && (
          <p className="dialog-warn">
            A sensibilidade e o threshold foram calculados com gain 100%. Mantendo o gain atual ({pad.gain}%), a resposta
            do pad pode ficar diferente do que a calibração mediu.
          </p>
        )}
        <div className="autotune-actions">
          <button className="btn-primary" onClick={apply} disabled={changed.length > 0 && selected.length === 0}>
            {partial ? `Aplicar selecionados (${selected.length})` : 'Aplicar'}
          </button>
          <button className="btn-ghost" onClick={onCancel} title="Esc">
            Descartar
          </button>
        </div>
      </div>
    )
  }

  // aborted
  return (
    <div className="autotune-panel aborted">
      <p className="autotune-instruction">
        {status.reason === 'channel_disabled'
          ? 'Canal desligado — ative o canal pra poder calibrar.'
          : 'Cancelado — nenhuma pancada detectada a tempo.'}
      </p>
      <button className="btn-ghost" onClick={onCancel}>
        OK
      </button>
    </div>
  )
}
