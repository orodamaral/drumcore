import { useEffect, useMemo, useRef, useState } from 'react'
import { GlobalConfig, MIDI_OUTPUT_LABELS, MidiOutput, PadConfig } from '../protocol'
import { BatchOp, ParsedConfig, planImport } from '../configFile'
import { MIDI_MAPS, MidiMapId, useMidiMap, useSetMidiMap } from '../midiMaps'

interface Props {
  fileName: string
  parsed: ParsedConfig
  pads: Array<PadConfig | undefined>
  global: GlobalConfig
  onClose: () => void
  onRun: (ops: BatchOp[], label: string) => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ImportConfigDialog({ fileName, parsed, pads, global, onClose, onRun }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const currentMap = useMidiMap()
  const setMapId = useSetMidiMap()
  const { file } = parsed
  const fileMap: MidiMapId | undefined = file.app?.midi_map
  const [names, setNames] = useState(true)
  const [withGlobal, setWithGlobal] = useState(true)
  const [useFileMap, setUseFileMap] = useState(Boolean(fileMap && fileMap !== currentMap.id))

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const plan = useMemo(
    () => planImport(file, pads, global, { names, global: withGlobal }),
    [file, pads, global, names, withGlobal]
  )
  const warnings = [...parsed.warnings, ...plan.warnings]
  const named = file.pads.filter((p) => p.label).map((p) => p.label)

  const mapChange = Boolean(useFileMap && fileMap && fileMap !== currentMap.id)

  function apply(): void {
    if (mapChange && fileMap) setMapId(fileMap)
    if (plan.ops.length > 0) onRun(plan.ops, `Configuração importada de ${fileName}`)
    ref.current?.close()
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="import-title">
      <h2 id="import-title">Importar configuração</h2>
      <p className="dialog-sub">
        <strong>{fileName}</strong> — exportado em {formatDate(file.exported_at)}
        {file.firmware_version && <> · firmware {file.firmware_version}</>}
      </p>

      <dl className="import-summary">
        <div>
          <dt>Pads no arquivo</dt>
          <dd>{file.pads.length}</dd>
        </div>
        <div>
          <dt>Canal / saída MIDI</dt>
          <dd>
            {file.global.midi_channel > 0 ? file.global.midi_channel : '—'} ·{' '}
            {file.global.midi_output >= 0 ? MIDI_OUTPUT_LABELS[file.global.midi_output as MidiOutput] : '—'}
          </dd>
        </div>
        <div>
          <dt>Mapa MIDI</dt>
          <dd>{fileMap ? MIDI_MAPS[fileMap].label : '—'}</dd>
        </div>
      </dl>
      {named.length > 0 && (
        <p className="import-names">
          {named.slice(0, 12).join(' · ')}
          {named.length > 12 && ` · +${named.length - 12}`}
        </p>
      )}

      <fieldset className="dialog-group">
        <legend>O que importar</legend>
        <div className="check-row">
          <label className="check">
            <input type="checkbox" checked disabled />
            Tipos, valores e notas
          </label>
          <label className="check">
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />
            Nomes dos pads
          </label>
          <label className="check">
            <input type="checkbox" checked={withGlobal} onChange={(e) => setWithGlobal(e.target.checked)} />
            Canal e saída MIDI
          </label>
          {fileMap && fileMap !== currentMap.id && (
            <label className="check">
              <input type="checkbox" checked={useFileMap} onChange={(e) => setUseFileMap(e.target.checked)} />
              Usar o mapa {MIDI_MAPS[fileMap].label}
            </label>
          )}
        </div>
      </fieldset>

      {warnings.length > 0 && (
        <div className="dialog-warn import-warnings">
          <strong>{warnings.length === 1 ? '1 aviso' : `${warnings.length} avisos`}</strong>
          <ul>
            {warnings.slice(0, 8).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {warnings.length > 8 && <li>… e mais {warnings.length - 8}.</li>}
          </ul>
        </div>
      )}

      <div className="dialog-foot">
        <span className="dialog-summary" aria-live="polite">
          {plan.ops.length === 0
            ? 'O módulo já está com essa configuração.'
            : `${plan.ops.length} alteraç${plan.ops.length === 1 ? 'ão' : 'ões'}${plan.padsTouched ? ` em ${plan.padsTouched} pad${plan.padsTouched === 1 ? '' : 's'}` : ''} · não dá para desfazer`}
        </span>
        <button type="button" onClick={() => ref.current?.close()}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={plan.ops.length === 0 && !mapChange} onClick={apply}>
          Importar
        </button>
      </div>
    </dialog>
  )
}
