import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MockDevice } from './mockDevice'
import {
  AutoTuneStatus,
  GlobalConfig,
  MidiOutput,
  MIDI_OUTPUT_LABELS,
  MIDI_OUTPUTS,
  PadConfig,
  PadField,
  PadType,
  PAD_FIELDS,
  parseIncoming
} from './protocol'
import PadGrid, { HitEvent, stepPad } from './components/PadGrid'
import PadEditor from './components/PadEditor'
import ParamSlider from './components/ParamSlider'
import LogPanel, { LogEntry, LogLevel } from './components/LogPanel'
import MidiMapSelect from './components/MidiMapSelect'
import ApplyMapDialog from './components/ApplyMapDialog'
import ShortcutsDialog from './components/ShortcutsDialog'
import FactoryResetDialog from './components/FactoryResetDialog'
import ImportConfigDialog from './components/ImportConfigDialog'
import { BatchOp, buildConfigFile, configFileName, ParsedConfig, parseConfigFile, repliesWithPadConfig } from './configFile'
import { PadOp, PadSnapshot } from './padActions'
import { changesFor, fieldLabel, HistoryEntry, pushEntry, redoOps, undoOps } from './history'
import { loadMidiMapId, MidiMapContext, MidiMapId, MIDI_MAPS, saveMidiMapId } from './midiMaps'
import FirmwareManager from './components/FirmwareManager'
import MidiMonitor from './components/MidiMonitor'
import Logo from './components/Logo'
import type { PortInfo } from './env'

const PAD_COUNT = 32

const DEFAULT_GLOBAL: GlobalConfig = { midi_channel: 10, midi_output: 2 }

type Tab = 'config' | 'global' | 'midi' | 'firmware'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'config', label: 'Pads' },
  { key: 'global', label: 'Global' },
  { key: 'midi', label: 'MIDI Monitor' },
  { key: 'firmware', label: 'Firmware' }
]

const LOG_MAX = 200
const HIT_HISTORY_MAX = 20

export default function App() {
  const [tab, setTab] = useState<Tab>('config')
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [pads, setPads] = useState<Record<number, PadConfig>>({})
  const [selectedPad, setSelectedPad] = useState(0)
  const [lastHit, setLastHit] = useState<HitEvent | null>(null)
  const [hitHistory, setHitHistory] = useState<Record<number, number[]>>({})
  const [followHits, setFollowHits] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [midiMapId, setMidiMapId] = useState<MidiMapId>(loadMidiMapId)
  const [clipboard, setClipboard] = useState<PadSnapshot | null>(null)
  const [applyMapOpen, setApplyMapOpen] = useState(false)
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [factoryOpen, setFactoryOpen] = useState(false)
  const [jackLabels, setJackLabels] = useState<Record<number, string>>({})
  const [importing, setImporting] = useState<{ fileName: string; parsed: ParsedConfig } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const [batch, setBatch] = useState<{ label: string; done: number; total: number } | null>(null)
  const [bleConnected, setBleConnected] = useState(false)
  const [global, setGlobal] = useState<GlobalConfig>(DEFAULT_GLOBAL)
  const [autoTune, setAutoTune] = useState<AutoTuneStatus | null>(null)
  const [firmwareVersion, setFirmwareVersion] = useState<string | undefined>(undefined)

  const mockDeviceRef = useRef<MockDevice | null>(null)
  // Espelho síncrono de demoMode - connect() liga o demo e já envia comandos
  // na mesma chamada, antes do re-render que atualizaria o state.
  const demoRef = useRef(false)
  const hitSeq = useRef(0)
  const logSeq = useRef(0)
  const followRef = useRef(followHits)
  followRef.current = followHits
  // Fila de ações em lote: cada set_pad grava na flash do módulo e sempre
  // responde com exatamente uma resposta - ack (campos numéricos),
  // pad_config (label/pad_type/enabled/hihat_*) ou error; set_global responde
  // ack. O próximo comando só sai depois dessa resposta (ou do timeout), pra
  // não estourar o buffer serial.
  const pendingReply = useRef<{ expect: 'ack' | 'config' | 'global' | 'jack'; pad: number; resolve: () => void } | null>(null)
  const batchErrors = useRef(0)
  const padsRef = useRef(pads)
  padsRef.current = pads
  const batchCancel = useRef(false)

  function appendLog(message: string, level: LogLevel = 'info'): void {
    setLog((prev) => {
      const last = prev[prev.length - 1]
      // Agrupa repetições consecutivas idênticas numa linha só (×N).
      if (last && last.text === message && last.level === level) {
        return [...prev.slice(0, -1), { ...last, count: last.count + 1, time: new Date() }]
      }
      return [...prev.slice(-(LOG_MAX - 1)), { id: ++logSeq.current, time: new Date(), level, text: message, count: 1 }]
    })
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  function resolveReply(kind?: 'ack' | 'config' | 'global' | 'jack' | 'error', pad?: number): void {
    const r = pendingReply.current
    if (!r) return
    if (kind && kind !== 'error' && (kind !== r.expect || ((kind === 'config' || kind === 'jack') && pad !== r.pad))) return
    if (kind === 'error') batchErrors.current++
    pendingReply.current = null
    r.resolve()
  }

  function handleLine(line: string): void {
    const message = parseIncoming(line)
    if (!message) return

    switch (message.type) {
      case 'device_info':
        setBleConnected(message.ble_connected)
        setFirmwareVersion(message.firmware_version)
        setGlobal({
          midi_channel: message.midi_channel,
          midi_output: message.midi_output
        })
        break
      case 'pad_config':
        setPads((prev) => ({ ...prev, [message.pad]: message }))
        resolveReply('config', message.pad)
        break
      case 'hit':
        setLastHit({ pad: message.pad, velocity: message.velocity, seq: ++hitSeq.current })
        setHitHistory((prev) => ({
          ...prev,
          [message.pad]: [...(prev[message.pad] ?? []).slice(-(HIT_HISTORY_MAX - 1)), message.velocity]
        }))
        if (followRef.current) setSelectedPad(message.pad)
        break
      case 'jack_config':
        setJackLabels((prev) => ({ ...prev, [message.jack]: message.label }))
        resolveReply('jack', message.jack)
        break
      case 'autotune_status':
        setAutoTune(message)
        break
      case 'log':
        appendLog(message.message)
        break
      case 'error':
        appendLog(`Erro (${message.cmd}): ${message.message}`, 'error')
        if (message.cmd === 'set_pad' || message.cmd === 'set_global' || message.cmd === 'set_jack') resolveReply('error')
        break
      case 'ack': {
        appendLog(`OK: pad ${message.pad + 1} ${message.field} = ${message.value}`)
        if (message.cmd === 'set_pad') resolveReply('ack')
        if (message.cmd === 'set_global') resolveReply('global')

        // set_pad em campos numericos (sensitivity, threshold, etc) responde
        // com ack, nao com pad_config - sem isso, o slider correspondente no
        // editor fica "voltando" pro valor antigo, porque o estado local
        // (pads) nunca era atualizado depois do ack.
        const field = message.field as PadField
        if (message.cmd === 'set_pad' && (PAD_FIELDS as readonly string[]).includes(field)) {
          setPads((prev) => {
            const existing = prev[message.pad]
            if (!existing || !existing.primary) return prev
            return { ...prev, [message.pad]: { ...existing, [field]: message.value } }
          })
        }
        break
      }
      default:
        break
    }
  }

  useEffect(() => {
    if (!connected || demoMode) return
    const unsubscribeMessage = window.drumCore.onMessage(handleLine)
    const unsubscribeError = window.drumCore.onError((message) => appendLog(`Erro serial: ${message}`, 'error'))
    return () => {
      unsubscribeMessage()
      unsubscribeError()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, demoMode])

  useEffect(() => {
    window.drumCore.listPorts().then(setPorts)
  }, [])

  function send(obj: Record<string, unknown>): void {
    const line = JSON.stringify(obj)
    if (demoRef.current) {
      mockDeviceRef.current?.send(line)
    } else {
      window.drumCore.send(line)
    }
  }

  async function connect(demo = false): Promise<void> {
    demoRef.current = demo
    setDemoMode(demo)
    if (demo) {
      const mock = new MockDevice(PAD_COUNT)
      mock.onMessage(handleLine)
      mock.start()
      mockDeviceRef.current = mock
      setConnected(true)
      send({ cmd: 'get_all_pads' })
      send({ cmd: 'get_jacks' })
      send({ cmd: 'get_device_info' })
      return
    }

    // Com Web Serial, nunca existe uma porta pre-selecionada - listPorts()
    // sempre retorna [] (ver botao Conectar acima) e connect() abre o
    // seletor nativo do navegador direto. Esta checagem so' importa se um
    // dia existir uma implementacao de DrumCoreApi com lista real de
    // portas pra escolher.
    if (ports.length > 0 && !selectedPort) return
    setConnecting(true)
    try {
      await window.drumCore.connect(selectedPort)
    } catch (err) {
      appendLog(`Não foi possível conectar: ${err instanceof Error ? err.message : String(err)}`, 'error')
      return
    } finally {
      setConnecting(false)
    }
    setConnected(true)
    send({ cmd: 'get_all_pads' })
    send({ cmd: 'get_jacks' })
    send({ cmd: 'get_device_info' })
  }

  async function disconnect(): Promise<void> {
    if (demoRef.current) {
      mockDeviceRef.current?.stop()
      mockDeviceRef.current = null
    } else {
      await window.drumCore.disconnect()
    }
    demoRef.current = false
    setDemoMode(false)
    setConnected(false)
    setPads({})
    setLastHit(null)
    setHitHistory({})
    setJackLabels({})
    setUndoStack([])
    setRedoStack([])
    setBleConnected(false)
    setGlobal(DEFAULT_GLOBAL)
    setAutoTune(null)
    setFirmwareVersion(undefined)
    batchCancel.current = true
    resolveReply()
  }

  function record(label: string, ops: PadOp[]): void {
    const changes = changesFor(ops, padsRef.current)
    if (changes.length === 0) return
    setUndoStack((s) => pushEntry(s, { label, changes, time: Date.now() }))
    setRedoStack([])
  }

  function updatePadField(pad: number, field: PadField, value: number): void {
    record(`${fieldLabel(padsRef.current, pad, field)} do pad ${pad + 1}`, [{ pad, field, value }])
    send({ cmd: 'set_pad', pad, field, value })
  }

  function stepHistory(dir: 'undo' | 'redo'): void {
    if (batch) return
    const from = dir === 'undo' ? undoStack : redoStack
    const entry = from[from.length - 1]
    if (!entry) return
    if (dir === 'undo') {
      setUndoStack((s) => s.slice(0, -1))
      setRedoStack((s) => [...s, entry])
    } else {
      setRedoStack((s) => s.slice(0, -1))
      setUndoStack((s) => [...s, entry])
    }
    // Mostra o pad afetado (quando a entrada mexe num pad só).
    const touched = new Set(entry.changes.map((c) => c.pad))
    if (touched.size === 1) setSelectedPad(entry.changes[0].pad)
    void runOps(dir === 'undo' ? undoOps(entry) : redoOps(entry), `${dir === 'undo' ? 'Desfeito' : 'Refeito'}: ${entry.label}`, false)
  }

  function renamePad(pad: number, label: string): void {
    send({ cmd: 'set_pad', pad, field: 'label', value: label })
  }

  function changePadType(pad: number, padType: PadType): void {
    send({ cmd: 'set_pad', pad, field: 'pad_type', value: padType })
  }

  function changeHihatLink(pad: number, channel: number): void {
    send({ cmd: 'set_pad', pad, field: 'hihat_pedal_channel', value: channel })
  }

  function setPadEnabled(pad: number, enabled: boolean): void {
    send({ cmd: 'set_pad', pad, field: 'enabled', value: enabled ? 1 : 0 })
  }

  function setPadHihatInvert(pad: number, invert: boolean): void {
    send({ cmd: 'set_pad', pad, field: 'hihat_invert', value: invert ? 1 : 0 })
  }

  function setJackLabel(jack: number, label: string): void {
    send({ cmd: 'set_jack', jack, field: 'label', value: label })
  }

  function setPadPedalNote(pad: number, enabled: boolean): void {
    send({ cmd: 'set_pad', pad, field: 'pedal_note', value: enabled ? 1 : 0 })
  }

  function startAutoTune(pad: number): void {
    send({ cmd: 'start_autotune', pad })
  }

  const cancelAutoTune = useCallback(() => {
    send({ cmd: 'cancel_autotune' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Aplicação parcial: cancel_autotune devolve o gain original (o firmware
  // força 100% durante a calibração) e sai do assistente; depois só os
  // campos escolhidos vão por set_pad, pela mesma fila das ações em lote.
  function applyAutoTunePartial(ops: PadOp[], label: string): void {
    send({ cmd: 'cancel_autotune' })
    setAutoTune(null)
    void runOps(ops, label)
  }

  function applyAutoTune(): void {
    // Registra o que o apply vai mudar (incluindo o gain forçado em 100 -
    // ver applyAutoTuneResult() no firmware) pra dar pra desfazer.
    if (autoTune?.state === 'done') {
      const fields: PadField[] = [
        'sensitivity', 'threshold', 'scan_time', 'mask_time', 'rim_sensitivity', 'rim_threshold', 'curve_type', 'retrigger'
      ]
      const ops: PadOp[] = fields
        .filter((f) => autoTune[f as keyof AutoTuneStatus] !== undefined)
        .map((f) => ({ pad: autoTune.pad, field: f, value: autoTune[f as keyof AutoTuneStatus] as number }))
      ops.push({ pad: autoTune.pad, field: 'gain', value: 100 })
      record(`Calibração do pad ${autoTune.pad + 1}`, ops)
    }
    send({ cmd: 'apply_autotune' })
    if (autoTune) setToast(`Valores da calibração aplicados ao pad ${autoTune.pad + 1}`)
    setAutoTune(null)
  }

  async function runOps(ops: BatchOp[], label: string, recordHistory = true): Promise<void> {
    if (ops.length === 0 || batch) return
    // Histórico só dos campos numéricos (ver history.ts).
    if (recordHistory) {
      record(
        label,
        ops.filter((o): o is PadOp => (o.cmd ?? 'set_pad') === 'set_pad' && (PAD_FIELDS as readonly string[]).includes(o.field) && typeof o.value === 'number')
      )
    }
    batchCancel.current = false
    batchErrors.current = 0
    setBatch({ label, done: 0, total: ops.length })
    let done = 0
    for (const op of ops) {
      if (batchCancel.current) break
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          pendingReply.current = null
          resolve()
        }, 1500)
        const cmd = op.cmd ?? 'set_pad'
        pendingReply.current = {
          expect: cmd === 'set_global' ? 'global' : cmd === 'set_jack' ? 'jack' : repliesWithPadConfig(op.field) ? 'config' : 'ack',
          pad: op.pad,
          resolve: () => {
            clearTimeout(timer)
            resolve()
          }
        }
        send(
          cmd === 'set_global'
            ? { cmd, field: op.field, value: op.value }
            : cmd === 'set_jack'
              ? { cmd, jack: op.pad, field: op.field, value: op.value }
              : { cmd, pad: op.pad, field: op.field, value: op.value }
        )
      })
      done++
      setBatch((b) => (b ? { ...b, done } : b))
    }
    setBatch(null)
    const errs = batchErrors.current
    setToast(
      batchCancel.current
        ? `Interrompido: ${done} de ${ops.length} alterações enviadas`
        : errs > 0
          ? `${label} — ${errs} alteraç${errs === 1 ? 'ão recusada' : 'ões recusadas'} pelo módulo (ver log)`
          : label
    )
  }

  function updateGlobalField(field: keyof GlobalConfig, value: number): void {
    send({ cmd: 'set_global', field, value })
  }

  function saveAll(): void {
    send({ cmd: 'save_all' })
  }

  function restoreAll(): void {
    send({ cmd: 'restore_all' })
    // Os valores voltam da memória por fora do histórico - desfazer
    // depois disso mandaria valores que já não batem.
    setUndoStack([])
    setRedoStack([])
  }

  function exportConfig(): void {
    const data = buildConfigFile(padList, global, firmwareVersion, midiMapId, jackLabels)
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = configFileName()
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setToast(`Configuração exportada (${data.pads.length} pads)`)
  }

  async function pickImportFile(file: File | undefined): Promise<void> {
    if (!file) return
    const text = await file.text().catch(() => null)
    if (text === null) {
      appendLog(`Não foi possível ler ${file.name}.`, 'error')
      return
    }
    const result = parseConfigFile(text, PAD_COUNT)
    if (!result.ok) {
      appendLog(`Importar ${file.name}: ${result.error}`, 'error')
      return
    }
    setImporting({ fileName: file.name, parsed: result.value })
  }

  function runImport(ops: BatchOp[], label: string): void {
    // Valores mudam por fora do histórico (tipos, nomes...) - desfazer
    // depois disso mandaria valores que já não batem.
    setUndoStack([])
    setRedoStack([])
    setClipboard(null)
    void runOps(ops, label, false)
  }

  function factoryReset(): void {
    send({ cmd: 'factory_reset', confirm: true })
    setUndoStack([])
    setRedoStack([])
    setClipboard(null)
    setToast('Padrão de fábrica restaurado')
  }

  const padList = useMemo(
    () => Array.from({ length: PAD_COUNT }, (_, i) => pads[i]),
    [pads]
  )

  const goPad = useCallback((dir: 1 | -1) => setSelectedPad((cur) => stepPad(padList, cur, dir)), [padList])

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y - fora de campos de texto/número (lá o
  // desfazer nativo do navegador continua valendo).
  const stepHistoryRef = useRef(stepHistory)
  stepHistoryRef.current = stepHistory
  useEffect(() => {
    if (!connected) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const isUndo = key === 'z' && !e.shiftKey
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y'
      if (!isUndo && !isRedo) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input[type="text"], input[type="number"], textarea, [contenteditable="true"]')) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      stepHistoryRef.current(isUndo ? 'undo' : 'redo')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connected])

  // "?" abre a lista de atalhos (fora de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      setShortcutsOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Alt+↑/↓ troca de pad de qualquer lugar da aba Pads.
  useEffect(() => {
    if (tab !== 'config' || !connected) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      e.preventDefault()
      goPad(e.key === 'ArrowDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, connected, goPad])

  const connectDisabled = ports.length > 0 && !selectedPort

  const midiMapState = useMemo(
    () => ({
      map: MIDI_MAPS[midiMapId],
      setMapId: (id: MidiMapId) => {
        setMidiMapId(id)
        saveMidiMapId(id)
      }
    }),
    [midiMapId]
  )

  return (
    <MidiMapContext.Provider value={midiMapState}>
      <nav className="topnav">
        <div className="wrap">
          <a className="brand" href="./">
            <Logo />
            DRUMCORE
          </a>
          <ul className="navlinks">
            <li><a href="../index.html">Visão geral</a></li>
            <li><a href="../hardware.html">Hardware</a></li>
            <li><a className="active" href="./">ConfigTool</a></li>
            <li><a href="../webdrum.html">WebDrum</a></li>
            <li>
              <a className="nav-gh" href="https://github.com/orodamaral/drumcore" target="_blank" rel="noopener">
                GitHub ↗
              </a>
            </li>
          </ul>
        </div>
      </nav>

      <div className="app">
        <header className="statusbar">
          <nav className="tabbar" aria-label="Seções do ConfigTool">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'active' : ''}
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="connection-controls">
            <button
              type="button"
              className="icon-btn help-btn"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Atalhos de teclado"
              title="Atalhos de teclado (?)"
            >
              ?
            </button>
            {!connected && ports.length > 0 && (
              <select value={selectedPort} disabled={connecting} onChange={(event) => setSelectedPort(event.target.value)}>
                <option value="">Selecione a porta...</option>
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.path}
                    {port.manufacturer ? ` (${port.manufacturer})` : ''}
                  </option>
                ))}
              </select>
            )}

            {/* No build web (Web Serial), listPorts() sempre retorna [] - o
                dropdown acima nem aparece, e o proprio navegador.serial.requestPort()
                mostra o seletor de dispositivo ao clicar em Conectar, sem precisar
                de porta pre-selecionada. */}
            {connecting ? (
              <span className="conn-chip connecting">
                <span className="conn-dot" aria-hidden /> Conectando…
              </span>
            ) : !connected ? (
              <>
                <span className="conn-chip offline">
                  <span className="conn-dot" aria-hidden /> Desconectado
                </span>
                <button className="link-btn" onClick={() => connect(true)}>
                  Experimentar sem hardware
                </button>
                <button className="btn-primary" onClick={() => connect(false)} disabled={connectDisabled}>
                  Conectar
                </button>
              </>
            ) : demoMode ? (
              <>
                <span className="conn-chip demo" title="Módulo simulado — nada é enviado a hardware real">
                  <span className="conn-dot" aria-hidden /> DEMO · sem hardware
                </span>
                <button onClick={disconnect}>Sair do demo</button>
              </>
            ) : (
              <>
                <span className="conn-chip online" title={firmwareVersion ? `Firmware ${firmwareVersion}` : undefined}>
                  <span className="conn-dot" aria-hidden /> Conectado · USB
                  {firmwareVersion && <span className="conn-meta">fw {firmwareVersion}</span>}
                </span>
                <button onClick={disconnect}>Desconectar</button>
              </>
            )}

            {connected && (
              <span
                className={`ble-badge ${bleConnected ? 'online' : 'offline'}`}
                title={bleConnected ? 'Dispositivo pareado via BLE-MIDI' : 'Sem dispositivo pareado via BLE-MIDI'}
              >
                BLE-MIDI {bleConnected ? 'pareado' : 'sem pareamento'}
              </span>
            )}
          </div>
        </header>

        {demoMode && connected && (
          <div className="demo-banner" role="status">
            Você está no <strong>modo demo</strong>: nenhuma alteração é enviada a um módulo real.
          </div>
        )}

        {tab === 'firmware' ? (
          <main className="content">
            <FirmwareManager
              appConnected={connected}
              connectedFirmwareVersion={connected ? firmwareVersion : undefined}
              onDisconnectApp={disconnect}
            />
          </main>
        ) : tab === 'midi' ? (
          <main className="content">
            <MidiMonitor />
          </main>
        ) : !connected ? (
          <main className="content empty-state">
            <div className="empty-card">
              <h2>Nenhum módulo conectado</h2>
              <p>
                Ligue o DrumCore no USB e clique em <strong>Conectar</strong>, ou experimente a interface sem hardware.
              </p>
              <div className="empty-actions">
                <button className="btn-primary" onClick={() => connect(false)} disabled={connectDisabled || connecting}>
                  Conectar
                </button>
                <button onClick={() => connect(true)} disabled={connecting}>
                  Experimentar sem hardware
                </button>
              </div>
            </div>
          </main>
        ) : tab === 'global' ? (
          <main className="content">
            <div className="global-panel">
              <section className="editor-section">
                <h3 className="section-title">Saída MIDI</h3>
                <ParamSlider
                  id="global-midi-ch"
                  label="Canal MIDI"
                  help="Canal em que o módulo envia as notas. Bateria General MIDI usa o canal 10."
                  min={1}
                  max={16}
                  value={global.midi_channel}
                  defaultValue={DEFAULT_GLOBAL.midi_channel}
                  onCommit={(v) => updateGlobalField('midi_channel', v)}
                />

                <MidiMapSelect />
                <div className="param">
                  <button type="button" onClick={() => setApplyMapOpen(true)} disabled={batch !== null}>
                    Aplicar mapa aos pads…
                  </button>
                  <p className="param-note">Preenche as notas de todos os pads a partir do instrumento de cada um.</p>
                </div>

                <div className="param">
                  <div className="param-head">
                    <label htmlFor="global-output" className="param-label">
                      Saída MIDI
                    </label>
                  </div>
                  <select
                    id="global-output"
                    className="full-select"
                    value={global.midi_output}
                    onChange={(event) => updateGlobalField('midi_output', Number(event.target.value) as MidiOutput)}
                  >
                    {MIDI_OUTPUTS.map((v) => (
                      <option key={v} value={v}>
                        {MIDI_OUTPUT_LABELS[v]}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="editor-section">
                <h3 className="section-title">Backup e compartilhamento</h3>
                <div className="global-actions">
                  <button onClick={exportConfig} disabled={padList.some((p) => !p)}>
                    Exportar configuração (.json)
                  </button>
                  <button onClick={() => importInputRef.current?.click()} disabled={batch !== null}>
                    Importar configuração…
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={(e) => {
                      void pickImportFile(e.target.files?.[0])
                      e.target.value = '' // permite escolher o mesmo arquivo de novo
                    }}
                  />
                </div>
                <p className="pad-hint">
                  Salva tipos, nomes, notas, calibração e crosstalk dos 32 canais, mais canal/saída MIDI e o mapa MIDI
                  escolhido, num arquivo que você pode guardar de backup ou mandar pra outra pessoa importar no módulo
                  dela.
                </p>
              </section>

              <section className="editor-section">
                <h3 className="section-title">Memória do módulo</h3>
                <div className="global-actions">
                  <button onClick={saveAll}>Salvar tudo na memória</button>
                  <button onClick={restoreAll}>Restaurar da memória</button>
                  <button className="btn-danger" onClick={() => setFactoryOpen(true)} disabled={batch !== null}>
                    Restaurar padrão de fábrica…
                  </button>
                </div>
                <p className="pad-hint">
                  O app já salva cada campo assim que você muda (ver docs/01-decisoes-arquiteturais.md) — estes botões
                  espelham SALVAR/RESTAURAR da tela do módulo, úteis pra descartar edições feitas ali antes de salvar.
                </p>
              </section>
            </div>
          </main>
        ) : (
          <main className="content">
            <PadGrid
              pads={padList}
              selectedPad={selectedPad}
              lastHit={lastHit}
              followHits={followHits}
              onFollowHitsChange={setFollowHits}
              onSelect={setSelectedPad}
              jackLabels={jackLabels}
            />
            <PadEditor
              pad={pads[selectedPad]}
              allPads={padList}
              hitHistory={hitHistory[selectedPad] ?? []}
              onSimulateHit={demoMode ? () => mockDeviceRef.current?.simulateHit(selectedPad) : undefined}
              onPrev={() => goPad(-1)}
              onNext={() => goPad(1)}
              clipboard={clipboard}
              batchBusy={batch !== null}
              onCopyPad={(snap) => {
                setClipboard(snap)
                setToast(`Configuração do pad ${snap.sourcePad + 1} copiada`)
              }}
              onRunOps={runOps}
              onOpenApplyMap={() => setApplyMapOpen(true)}
              undoLabel={undoStack[undoStack.length - 1]?.label}
              redoLabel={redoStack[redoStack.length - 1]?.label}
              onUndo={() => stepHistory('undo')}
              onRedo={() => stepHistory('redo')}
              onChange={(field, value) => updatePadField(selectedPad, field, value)}
              onRename={(label) => renamePad(selectedPad, label)}
              onChangeType={(type) => changePadType(selectedPad, type)}
              onChangeHihatLink={(channel) => changeHihatLink(selectedPad, channel)}
              onChangeEnabled={(enabled) => setPadEnabled(selectedPad, enabled)}
              onChangeHihatInvert={(invert) => setPadHihatInvert(selectedPad, invert)}
              onChangePedalNote={(enabled) => setPadPedalNote(selectedPad, enabled)}
              jackLabels={jackLabels}
              onRenameJack={setJackLabel}
              autoTune={autoTune?.pad === selectedPad ? autoTune : null}
              onStartAutoTune={() => startAutoTune(selectedPad)}
              onCancelAutoTune={cancelAutoTune}
              onApplyAutoTune={applyAutoTune}
              onApplyAutoTunePartial={applyAutoTunePartial}
            />
          </main>
        )}

        {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}

        {importing && connected && (
          <ImportConfigDialog
            fileName={importing.fileName}
            parsed={importing.parsed}
            pads={padList}
            global={global}
            jackLabels={jackLabels}
            onClose={() => setImporting(null)}
            onRun={runImport}
          />
        )}

        {factoryOpen && connected && (
          <FactoryResetDialog onClose={() => setFactoryOpen(false)} onConfirm={factoryReset} />
        )}

        {applyMapOpen && connected && (
          <ApplyMapDialog allPads={padList} onClose={() => setApplyMapOpen(false)} onRun={runOps} />
        )}

        {batch && (
          <div className="batch-bar" role="status" aria-live="polite">
            <span>
              Enviando ao módulo… {batch.done}/{batch.total}
            </span>
            <div className="batch-progress" aria-hidden>
              <div style={{ width: `${(100 * batch.done) / batch.total}%` }} />
            </div>
            <button type="button" className="btn-ghost small" onClick={() => (batchCancel.current = true)}>
              Parar
            </button>
          </div>
        )}

        {toast && !batch && (
          <div className="toast" role="status">
            ✓ {toast}
          </div>
        )}

        <LogPanel entries={log} onClear={() => setLog([])} />
      </div>
    </MidiMapContext.Provider>
  )
}
