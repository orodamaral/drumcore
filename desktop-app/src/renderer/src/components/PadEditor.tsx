import { useEffect, useState } from 'react'
import {
  AUTOTUNE_HIT_TARGET,
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
        status={autoTune}
        onStart={onStartAutoTune}
        onCancel={onCancelAutoTune}
        onApply={onApplyAutoTune}
      />
    </div>
  )
}

// Assistente de auto-calibração (Fase O) - bate no pad algumas vezes e o
// firmware calcula sensibilidade/threshold/scan/mask sozinho, em vez de
// ajustar cada slider por tentativa e erro. Ver docs/01-decisoes-
// arquiteturais.md (inspirado no "Auto Tune" do microDRUM/nanoDRUM).
function AutoTunePanel({
  enabled,
  status,
  onStart,
  onCancel,
  onApply
}: {
  enabled: boolean
  status: AutoTuneStatus | null
  onStart: () => void
  onCancel: () => void
  onApply: () => void
}) {
  const running = status !== null && status.state !== 'idle'

  if (!running) {
    return (
      <div className="autotune-panel">
        <button className="autotune-start" onClick={onStart} disabled={!enabled}>
          Calibrar automaticamente
        </button>
        <p className="pad-hint">
          Bate no pad <strong>{AUTOTUNE_HIT_TARGET}x</strong> com intensidade normal/forte e o módulo calcula
          sensibilidade, threshold, scan e mask sozinho.
          {!enabled && ' Ative o canal pra poder calibrar.'}
        </p>
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

  if (status.state === 'collecting') {
    return (
      <div className="autotune-panel active">
        <p className="autotune-instruction">Bata no pad com intensidade normal/forte</p>
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
    return (
      <div className="autotune-panel active done">
        <p className="autotune-instruction">Calibrado! Novos valores:</p>
        <ul className="autotune-result">
          <li>Sensibilidade: {status.sensitivity}</li>
          <li>Threshold: {status.threshold}</li>
          <li>Scan time: {status.scan_time}</li>
          <li>Mask time: {status.mask_time}</li>
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
