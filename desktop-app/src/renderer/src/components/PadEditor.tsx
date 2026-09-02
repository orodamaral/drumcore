import { useEffect, useState } from 'react'
import {
  AUTOTUNE_HH_HOLD_MS,
  AUTOTUNE_HIT_TARGET,
  autoTuneShapeFor,
  autoTuneZonesFor,
  AutoTuneShape,
  AutoTuneStatus,
  PadConfig,
  PadField,
  PadType,
  PAD_LABEL_MAX_LEN,
  PAD_TYPE_META,
  PAD_TYPES
} from '../protocol'

interface Props {
  pad?: PadConfig
  allPads: Array<PadConfig | undefined>
  onChange: (field: PadField, value: number) => void
  onRename: (label: string) => void
  onChangeType: (type: PadType) => void
  onChangeHihatLink: (channel: number) => void
  onChangeEnabled: (enabled: boolean) => void
  onChangeHihatInvert: (invert: boolean) => void
  /** Status do assistente de auto-calibração pra ESTE pad - null se não estiver rodando aqui. */
  autoTune: AutoTuneStatus | null
  onStartAutoTune: () => void
  onCancelAutoTune: () => void
  onApplyAutoTune: () => void
}

export default function PadEditor({
  pad,
  allPads,
  onChange,
  onRename,
  onChangeType,
  onChangeHihatLink,
  onChangeEnabled,
  onChangeHihatInvert,
  autoTune,
  onStartAutoTune,
  onCancelAutoTune,
  onApplyAutoTune
}: Props) {
  const [draftLabel, setDraftLabel] = useState(pad?.primary ? pad.label : '')

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

  const availablePedals = allPads.filter(
    (p): p is PadConfig & { primary: true } => Boolean(p?.primary) && PAD_TYPE_META[(p as { pad_type: PadType }).pad_type].isHihatPedal
  )

  return (
    <div className="pad-editor">
      <div className="pad-rename">
        <span className="pad-number-badge">{activePad.pad + 1}</span>
        <input
          type="text"
          className="pad-rename-input"
          value={draftLabel}
          maxLength={PAD_LABEL_MAX_LEN}
          placeholder="Nome do pad (ex: Caixa)"
          onChange={(event) => setDraftLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitLabel()
              event.currentTarget.blur()
            }
          }}
        />
      </div>

      <label className="pad-enabled-toggle">
        <input
          type="checkbox"
          checked={activePad.enabled}
          onChange={(event) => onChangeEnabled(event.target.checked)}
        />
        Canal ativo
      </label>
      {!activePad.enabled && (
        <p className="pad-hint">
          Canal desligado — o módulo ignora esse slot por completo (nenhum hit, nenhuma nota). Use pra slots sem
          sensor físico conectado, pra evitar ruído/interferência sendo lido como pancada.
        </p>
      )}

      {meta.isHihatPedal && (
        <>
          <label className="pad-enabled-toggle">
            <input
              type="checkbox"
              checked={activePad.hihat_invert}
              onChange={(event) => onChangeHihatInvert(event.target.checked)}
            />
            Inverter
          </label>
          <p className="pad-hint">
            Alguns sensores mandam a posição invertida (pedal fechado = CC baixo, quando deveria ser alto, ou
            vice-versa) — liga isso pra corrigir. Não precisa recalibrar depois de mudar.
          </p>
        </>
      )}

      <div className="field-row">
        <label htmlFor="pad-type-select">Tipo de sensor</label>
        <select
          id="pad-type-select"
          className="pad-type-select"
          value={activePad.pad_type}
          onChange={(event) => onChangeType(Number(event.target.value) as PadType)}
        >
          {PAD_TYPES.map((type) => (
            <option key={type} value={type}>
              {PAD_TYPE_META[type].label} ({PAD_TYPE_META[type].channels} canal{PAD_TYPE_META[type].channels > 1 ? 'is' : ''})
            </option>
          ))}
        </select>
      </div>

      {meta.channels === 2 && (
        <p className="pad-hint">
          Esse tipo usa 2 canais (esse + o Pad {activePad.pad + 2}) — o canal seguinte fica reservado, sem configuração própria.
        </p>
      )}

      {meta.isHihatCymbal && (
        <div className="field-row">
          <label htmlFor="hihat-link-select">Pedal linkado</label>
          <select
            id="hihat-link-select"
            className="pad-type-select"
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

      {meta.fields.map((spec) => (
        <div className="field-row" key={spec.field}>
          <label htmlFor={`field-${spec.field}`}>{spec.label}</label>
          <input
            id={`field-${spec.field}`}
            type="range"
            min={spec.min}
            max={spec.max}
            value={activePad[spec.field]}
            onChange={(event) => onChange(spec.field, Number(event.target.value))}
          />
          <span className="field-value">{activePad[spec.field]}</span>
        </div>
      ))}

      <AutoTunePanel
        enabled={activePad.enabled}
        padType={activePad.pad_type}
        status={autoTune}
        onStart={onStartAutoTune}
        onCancel={onCancelAutoTune}
        onApply={onApplyAutoTune}
      />
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
  enabled,
  padType,
  status,
  onStart,
  onCancel,
  onApply
}: {
  enabled: boolean
  padType: PadType
  status: AutoTuneStatus | null
  onStart: () => void
  onCancel: () => void
  onApply: () => void
}) {
  const running = status !== null && status.state !== 'idle'
  const shape: AutoTuneShape = autoTuneShapeFor(padType)
  const zones = autoTuneZonesFor(padType)
  const extraZoneLabels = zones.slice(1).map((z) => ZONE_LABEL_PT[z] ?? z)
  const isHihatPedal = PAD_TYPE_META[padType].isHihatPedal

  if (!running) {
    return (
      <div className="autotune-panel">
        <button className="autotune-start" onClick={onStart} disabled={!enabled}>
          Calibrar automaticamente
        </button>
        {isHihatPedal ? (
          <p className="pad-hint">
            Pede pra segurar o pedal <strong>solto</strong> e depois <strong>pressionado até o fim</strong>, uns
            segundos cada, e o módulo calcula o range (min/max) sozinho — o CC vai variar de 0 a 127 no percurso
            real do seu pedal, não só numa faixa parcial dele.
            {!enabled && ' Ative o canal pra poder calibrar.'}
          </p>
        ) : (
          <p className="pad-hint">
            Bate no pad <strong>{AUTOTUNE_HIT_TARGET}x fraco</strong>, <strong>{AUTOTUNE_HIT_TARGET}x médio</strong>{' '}
            e <strong>{AUTOTUNE_HIT_TARGET}x forte</strong> e o módulo calcula sensibilidade, threshold, scan e
            mask sozinho.
            {shape !== 'single' &&
              ` Esse pad tem ${extraZoneLabels.length > 1 ? 'mais zonas' : 'mais uma zona'} — depois repete os 3 níveis batendo ${extraZoneLabels
                .map((l) => `no ${l}`)
                .join(' e depois ')}, pra calibrar isso também.`}
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
        <button className="autotune-cancel" onClick={onCancel}>
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
          <div
            className="autotune-progress-bar"
            style={{ width: `${Math.min(100, (100 * elapsed) / target)}%` }}
          />
        </div>
        <button className="autotune-cancel" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    )
  }

  if (status.state === 'collecting') {
    const tierLabel =
      status.tier === 'weak' ? 'fraco' : status.tier === 'strong' ? 'forte' : 'médio'
    const zoneHitPhrase = status.zone ? (ZONE_HIT_PHRASE[status.zone] ?? 'no pad') : 'no pad'
    return (
      <div className="autotune-panel active">
        {status.tier_index && status.tier_count && (
          <p className="autotune-tier">
            {status.zone && `${(ZONE_LABEL_PT[status.zone] ?? status.zone).toUpperCase()} — `}
            Nível {status.tier_index}/{status.tier_count}
          </p>
        )}
        <p className="autotune-instruction">Bata {zoneHitPhrase} com toque {tierLabel}</p>
        <div className="autotune-progress">
          <div className="autotune-progress-bar" style={{ width: `${(100 * status.hit_count) / status.hit_target}%` }} />
        </div>
        <span className="field-value">
          {status.hit_count}/{status.hit_target}
        </span>
        <button className="autotune-cancel" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    )
  }

  if (status.state === 'done') {
    // Reaproveita os mesmos rótulos dos sliders de rim_sensitivity/
    // rim_threshold pro tipo desse pad (ver PAD_TYPE_META) em vez de um
    // texto fixo "aro" - pra prato/caixa 3 zonas esses campos são na
    // verdade os thresholds de edge/cup, não de aro.
    const fields = PAD_TYPE_META[padType].fields
    const rimSensLabel = fields.find((f) => f.field === 'rim_sensitivity')?.label ?? 'Sensib. 2ª zona'
    const rimThreshLabel = fields.find((f) => f.field === 'rim_threshold')?.label ?? 'Threshold 2ª zona'
    const isHihatRange = status.mode === 'hihat_range'
    return (
      <div className="autotune-panel active done">
        <p className="autotune-instruction">Calibrado! Novos valores:</p>
        <ul className="autotune-result">
          {isHihatRange ? (
            <>
              <li>Máximo (fechado): {status.sensitivity}</li>
              <li>Mínimo (aberto): {status.threshold}</li>
            </>
          ) : (
            <>
              <li>Sensibilidade: {status.sensitivity}</li>
              <li>Threshold: {status.threshold}</li>
              <li>Scan time: {status.scan_time}</li>
              <li>Mask time: {status.mask_time}</li>
            </>
          )}
          {status.rim_sensitivity !== undefined && (
            <li>
              {rimSensLabel}: {status.rim_sensitivity}
            </li>
          )}
          {status.rim_threshold !== undefined && (
            <li>
              {rimThreshLabel}: {status.rim_threshold}
            </li>
          )}
        </ul>
        <div className="autotune-actions">
          <button className="autotune-apply" onClick={onApply}>
            Aplicar
          </button>
          <button className="autotune-cancel" onClick={onCancel}>
            Descartar
          </button>
        </div>
      </div>
    )
  }

  // aborted
  return (
    <div className="autotune-panel active aborted">
      <p className="autotune-instruction">
        {status.reason === 'channel_disabled'
          ? 'Canal desligado — ative o canal pra poder calibrar.'
          : 'Cancelado — nenhuma pancada detectada a tempo.'}
      </p>
      <button className="autotune-cancel" onClick={onCancel}>
        OK
      </button>
    </div>
  )
}
