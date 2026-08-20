import { useEffect, useMemo, useRef, useState } from 'react'
import { MockDevice } from './mockDevice'
import { PadConfig, PadField, parseIncoming } from './protocol'
import PadGrid from './components/PadGrid'
import PadEditor from './components/PadEditor'
import type { PortInfo } from './env'

const PAD_COUNT = 32

export default function App() {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [connected, setConnected] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [pads, setPads] = useState<Record<number, PadConfig>>({})
  const [selectedPad, setSelectedPad] = useState(0)
  const [lastHit, setLastHit] = useState<{ pad: number; velocity: number } | null>(null)
  const [log, setLog] = useState<string[]>([])

  const mockDeviceRef = useRef<MockDevice | null>(null)

  function appendLog(message: string): void {
    setLog((prev) => [...prev.slice(-49), message])
  }

  function handleLine(line: string): void {
    const message = parseIncoming(line)
    if (!message) return

    switch (message.type) {
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
      case 'ack':
        appendLog(`OK: pad ${message.pad + 1} ${message.field} = ${message.value}`)
        break
      default:
        break
    }
  }

  useEffect(() => {
    if (!connected || demoMode) return
    const unsubscribeMessage = window.helloDrum.onMessage(handleLine)
    const unsubscribeError = window.helloDrum.onError((message) => appendLog(`Erro serial: ${message}`))
    return () => {
      unsubscribeMessage()
      unsubscribeError()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, demoMode])

  useEffect(() => {
    window.helloDrum.listPorts().then(setPorts)
  }, [])

  function send(obj: Record<string, unknown>): void {
    const line = JSON.stringify(obj)
    if (demoMode) {
      mockDeviceRef.current?.send(line)
    } else {
      window.helloDrum.send(line)
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
      return
    }

    if (!selectedPort) return
    await window.helloDrum.connect(selectedPort)
    setConnected(true)
    send({ cmd: 'get_all_pads' })
  }

  async function disconnect(): Promise<void> {
    if (demoMode) {
      mockDeviceRef.current?.stop()
      mockDeviceRef.current = null
    } else {
      await window.helloDrum.disconnect()
    }
    setConnected(false)
    setPads({})
    setLastHit(null)
  }

  function updatePadField(pad: number, field: PadField, value: number): void {
    send({ cmd: 'set_pad', pad, field, value })
  }

  function renamePad(pad: number, label: string): void {
    send({ cmd: 'set_pad', pad, field: 'label', value: label })
  }

  const padList = useMemo(
    () => Array.from({ length: PAD_COUNT }, (_, i) => pads[i]),
    [pads]
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>HelloDrum</h1>

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

          <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
        </div>
      </header>

      {connected ? (
        <main className="content">
          <PadGrid pads={padList} selectedPad={selectedPad} lastHit={lastHit} onSelect={setSelectedPad} />
          <PadEditor
            pad={pads[selectedPad]}
            onChange={(field, value) => updatePadField(selectedPad, field, value)}
            onRename={(label) => renamePad(selectedPad, label)}
          />
        </main>
      ) : (
        <main className="content empty-state">
          <p>Conecte o módulo (ou ative o modo demo) para começar.</p>
        </main>
      )}

      <footer className="log">
        {log.map((entry, i) => (
          <div key={i}>{entry}</div>
        ))}
      </footer>
    </div>
  )
}
