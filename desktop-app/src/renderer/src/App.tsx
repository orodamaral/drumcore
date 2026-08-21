import { useEffect, useMemo, useRef, useState } from 'react'
import { MockDevice } from './mockDevice'
import {
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
import PadGrid from './components/PadGrid'
import PadEditor from './components/PadEditor'
import HardwareSimulator from './components/HardwareSimulator'
import type { PortInfo } from './env'

const PAD_COUNT = 32

const DEFAULT_GLOBAL: GlobalConfig = { midi_channel: 10, midi_output: 2, brightness: 80 }

type Tab = 'config' | 'global' | 'simulator'

export default function App() {
  const [tab, setTab] = useState<Tab>('config')
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [connected, setConnected] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [pads, setPads] = useState<Record<number, PadConfig>>({})
  const [selectedPad, setSelectedPad] = useState(0)
  const [lastHit, setLastHit] = useState<{ pad: number; velocity: number } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [bleConnected, setBleConnected] = useState(false)
  const [global, setGlobal] = useState<GlobalConfig>(DEFAULT_GLOBAL)

  const mockDeviceRef = useRef<MockDevice | null>(null)

  function appendLog(message: string): void {
    setLog((prev) => [...prev.slice(-49), message])
  }

  function handleLine(line: string): void {
    const message = parseIncoming(line)
    if (!message) return

    switch (message.type) {
      case 'device_info':
        setBleConnected(message.ble_connected)
        setGlobal({
          midi_channel: message.midi_channel,
          midi_output: message.midi_output,
          brightness: message.brightness
        })
        break
      case 'pad_config':
        setPads((prev) => ({ ...prev, [message.pad]: message }))
        break
      case 'hit':
        setLastHit({ pad: message.pad, velocity: message.velocity })
        break
      case 'log':
        appendLog(message.message)
        break
      case 'error':
        appendLog(`Erro (${message.cmd}): ${message.message}`)
        break
      case 'ack': {
        appendLog(`OK: pad ${message.pad + 1} ${message.field} = ${message.value}`)

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
    const unsubscribeError = window.drumCore.onError((message) => appendLog(`Erro serial: ${message}`))
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
    if (demoMode) {
      mockDeviceRef.current?.send(line)
    } else {
      window.drumCore.send(line)
    }
  }

  async function connect(): Promise<void> {
    if (demoMode) {
      const mock = new MockDevice(PAD_COUNT)
      mock.onMessage(handleLine)
      mock.start()
      mockDeviceRef.current = mock
      setConnected(true)
      send({ cmd: 'get_all_pads' })
      send({ cmd: 'get_device_info' })
      return
    }

    if (!selectedPort) return
    await window.drumCore.connect(selectedPort)
    setConnected(true)
    send({ cmd: 'get_all_pads' })
    send({ cmd: 'get_device_info' })
  }

  async function disconnect(): Promise<void> {
    if (demoMode) {
      mockDeviceRef.current?.stop()
      mockDeviceRef.current = null
    } else {
      await window.drumCore.disconnect()
    }
    setConnected(false)
    setPads({})
    setLastHit(null)
    setBleConnected(false)
    setGlobal(DEFAULT_GLOBAL)
  }

  function updatePadField(pad: number, field: PadField, value: number): void {
    send({ cmd: 'set_pad', pad, field, value })
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

  function updateGlobalField(field: keyof GlobalConfig, value: number): void {
    send({ cmd: 'set_global', field, value })
  }

  function saveAll(): void {
    send({ cmd: 'save_all' })
  }

  function restoreAll(): void {
    send({ cmd: 'restore_all' })
  }

  const padList = useMemo(
    () => Array.from({ length: PAD_COUNT }, (_, i) => pads[i]),
    [pads]
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>DRUMCORE</h1>

        <div className="connection-controls">
          <label className="demo-toggle">
            <input
              type="checkbox"
              checked={demoMode}
              disabled={connected}
              onChange={(event) => setDemoMode(event.target.checked)}
            />
            Modo demo (sem hardware)
          </label>

          {!demoMode && (
            <select
              value={selectedPort}
              disabled={connected}
              onChange={(event) => setSelectedPort(event.target.value)}
            >
              <option value="">Selecione a porta...</option>
              {ports.map((port) => (
                <option key={port.path} value={port.path}>
                  {port.path}
                  {port.manufacturer ? ` (${port.manufacturer})` : ''}
                </option>
              ))}
            </select>
          )}

          {!connected ? (
            <button onClick={connect} disabled={!demoMode && !selectedPort}>
              Conectar
            </button>
          ) : (
            <button onClick={disconnect}>Desconectar</button>
          )}

          <span className={`status-dot ${connected ? 'online' : 'offline'}`} title="Conexão serial (USB)" />

          {connected && (
            <span
              className={`ble-badge ${bleConnected ? 'online' : 'offline'}`}
              title={bleConnected ? 'Dispositivo pareado via BLE-MIDI' : 'Sem dispositivo pareado via BLE-MIDI'}
            >
              BLE {bleConnected ? '●' : '○'}
            </span>
          )}
        </div>
      </header>

      <nav className="tabbar">
        <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>
          Pads
        </button>
        <button className={tab === 'global' ? 'active' : ''} onClick={() => setTab('global')}>
          Global
        </button>
        <button className={tab === 'simulator' ? 'active' : ''} onClick={() => setTab('simulator')}>
          Simulador do módulo (LCD + encoders)
        </button>
      </nav>

      {tab === 'simulator' ? (
        <HardwareSimulator />
      ) : !connected ? (
        <main className="content empty-state">
          <p>Conecte o módulo (ou ative o modo demo) para começar.</p>
        </main>
      ) : tab === 'global' ? (
        <main className="content">
          <div className="global-panel">
            <div className="field-row">
              <label htmlFor="global-midi-ch">Canal MIDI</label>
              <input
                id="global-midi-ch"
                type="range"
                min={1}
                max={16}
                value={global.midi_channel}
                onChange={(event) => updateGlobalField('midi_channel', Number(event.target.value))}
              />
              <span className="field-value">{global.midi_channel}</span>
            </div>

            <div className="field-row">
              <label htmlFor="global-output">Saída MIDI</label>
              <select
                id="global-output"
                className="pad-type-select"
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

            <div className="field-row">
              <label htmlFor="global-brightness">Brilho da tela</label>
              <input
                id="global-brightness"
                type="range"
                min={10}
                max={100}
                step={10}
                value={global.brightness}
                onChange={(event) => updateGlobalField('brightness', Number(event.target.value))}
              />
              <span className="field-value">{global.brightness}%</span>
            </div>

            <div className="global-actions">
              <button onClick={saveAll}>Salvar tudo na memória</button>
              <button onClick={restoreAll}>Restaurar da memória</button>
            </div>
            <p className="pad-hint">
              O app desktop já salva cada campo assim que você muda (ver docs/01-decisoes-arquiteturais.md) — estes
              botões espelham SALVAR/RESTAURAR da tela do módulo, úteis pra descartar edições feitas ali antes de
              salvar.
            </p>
          </div>
        </main>
      ) : (
        <main className="content">
          <PadGrid pads={padList} selectedPad={selectedPad} lastHit={lastHit} onSelect={setSelectedPad} />
          <PadEditor
            pad={pads[selectedPad]}
            allPads={padList}
            onChange={(field, value) => updatePadField(selectedPad, field, value)}
            onRename={(label) => renamePad(selectedPad, label)}
            onChangeType={(type) => changePadType(selectedPad, type)}
            onChangeHihatLink={(channel) => changeHihatLink(selectedPad, channel)}
          />
        </main>
      )}

      {tab !== 'simulator' && (
        <footer className="log">
          {log.map((entry, i) => (
            <div key={i}>{entry}</div>
          ))}
        </footer>
      )}
    </div>
  )
}
