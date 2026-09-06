import { useEffect, useRef, useState } from 'react'

// Monitor de mensagens MIDI recebidas via Web MIDI API - independente da
// conexao Web Serial (protocolo NDJSON) usada nas abas Pads/Global/Firmware.
// O modulo aparece tanto pela porta USB-MIDI nativa (descriptor "DRUMCORE",
// ver TinyUSBDevice.setProductDescriptor() em firmware/src/main.cpp) quanto,
// se pareado, por BLE-MIDI - o SO expoe os dois como portas MIDI de entrada
// comuns, entao um unico <select> cobre ambos os transportes.

const MAX_LOG = 200
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

interface MidiLogEntry {
  id: number
  time: string
  type: string
  channel: number
  label: string
}

function noteName(note: number): string {
  const octave = Math.floor(note / 12) - 1
  return `${NOTE_NAMES[note % 12]}${octave}`
}

function decodeMessage(data: Uint8Array): { type: string; channel: number; label: string } {
  const status = data[0]
  const channel = (status & 0x0f) + 1
  const command = status & 0xf0
  const d1 = data[1]
  const d2 = data[2]

  switch (command) {
    case 0x80:
      return { type: 'Note Off', channel, label: `${noteName(d1)} (${d1}) vel ${d2}` }
    case 0x90:
      return d2 === 0
        ? { type: 'Note Off', channel, label: `${noteName(d1)} (${d1}) vel 0` }
        : { type: 'Note On', channel, label: `${noteName(d1)} (${d1}) vel ${d2}` }
    case 0xa0:
      return { type: 'Aftertouch', channel, label: `${noteName(d1)} (${d1}) pressão ${d2}` }
    case 0xb0:
      return { type: 'Control Change', channel, label: `CC${d1} = ${d2}` }
    case 0xc0:
      return { type: 'Program Change', channel, label: `programa ${d1}` }
    case 0xd0:
      return { type: 'Channel Pressure', channel, label: `pressão ${d1}` }
    case 0xe0:
      return { type: 'Pitch Bend', channel, label: `valor ${((d2 << 7) | d1) - 8192}` }
    default:
      return {
        type: 'Outro',
        channel: 0,
        label: Array.from(data)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ')
      }
  }
}

function inputsToArray(map: MIDIInputMap): MIDIInput[] {
  const list: MIDIInput[] = []
  map.forEach((input) => list.push(input))
  return list
}

function pickDefaultInputId(list: MIDIInput[]): string {
  const drumcore = list.find((input) => input.name?.toLowerCase().includes('drumcore'))
  return drumcore?.id ?? list[0]?.id ?? ''
}

export default function MidiMonitor(): JSX.Element {
  const supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  const [accessGranted, setAccessGranted] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [inputs, setInputs] = useState<MIDIInput[]>([])
  const [selectedInputId, setSelectedInputId] = useState('')
  const [paused, setPaused] = useState(false)
  const [messages, setMessages] = useState<MidiLogEntry[]>([])

  const pausedRef = useRef(paused)
  const nextIdRef = useRef(1)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  async function requestAccess(): Promise<void> {
    setRequesting(true)
    setErrorMessage('')
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      const list = inputsToArray(access.inputs)
      setInputs(list)
      setSelectedInputId((prev) => prev || pickDefaultInputId(list))
      access.onstatechange = () => {
        setInputs(inputsToArray(access.inputs))
      }
      setAccessGranted(true)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setRequesting(false)
    }
  }

  // Re-selecionar automaticamente se o dispositivo escolhido sumir da lista
  // (desconectado) e um novo aparecer.
  useEffect(() => {
    if (inputs.length === 0) return
    if (inputs.some((input) => input.id === selectedInputId)) return
    setSelectedInputId(pickDefaultInputId(inputs))
  }, [inputs, selectedInputId])

  useEffect(() => {
    const input = inputs.find((candidate) => candidate.id === selectedInputId)
    if (!input) return

    function handleMessage(event: MIDIMessageEvent): void {
      if (pausedRef.current || !event.data) return
      const decoded = decodeMessage(event.data)
      const entry: MidiLogEntry = {
        id: nextIdRef.current++,
        time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
        ...decoded
      }
      setMessages((prev) => [...prev.slice(-(MAX_LOG - 1)), entry])
    }

    input.onmidimessage = handleMessage
    return () => {
      input.onmidimessage = null
    }
  }, [inputs, selectedInputId])

  if (!supported) {
    return (
      <div className="midi-monitor">
        <p className="pad-hint">
          Este navegador não suporta a Web MIDI API — abra essa aba no Chrome ou Edge.
        </p>
      </div>
    )
  }

  return (
    <div className="midi-monitor">
      <div className="midi-monitor-controls">
        {!accessGranted ? (
          <button onClick={requestAccess} disabled={requesting}>
            {requesting ? 'Solicitando acesso...' : 'Conectar ao MIDI do sistema'}
          </button>
        ) : inputs.length === 0 ? (
          <p className="pad-hint">
            Acesso concedido, mas nenhuma porta MIDI encontrada. Conecte o módulo (USB, ou BLE
            já pareado) — a lista atualiza sozinha.
          </p>
        ) : (
          <select value={selectedInputId} onChange={(event) => setSelectedInputId(event.target.value)}>
            {inputs.map((input) => (
              <option key={input.id} value={input.id}>
                {input.name ?? input.id}
              </option>
            ))}
          </select>
        )}

        <button onClick={() => setPaused((prev) => !prev)} disabled={!selectedInputId}>
          {paused ? 'Retomar' : 'Pausar'}
        </button>
        <button onClick={() => setMessages([])} disabled={messages.length === 0}>
          Limpar
        </button>
      </div>

      {errorMessage && <p className="pad-hint">Erro pedindo acesso MIDI: {errorMessage}</p>}

      <div className="midi-log">
        {messages.length === 0 ? (
          <p className="pad-hint">Nenhuma mensagem MIDI recebida ainda.</p>
        ) : (
          messages
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} className="midi-log-row">
                <span className="midi-log-time">{entry.time}</span>
                <span className="midi-log-channel">Ch{entry.channel}</span>
                <span className={`midi-log-type midi-log-type-${entry.type === 'Note On' ? 'on' : entry.type === 'Note Off' ? 'off' : entry.type === 'Control Change' ? 'cc' : 'other'}`}>
                  {entry.type}
                </span>
                <span className="midi-log-label">{entry.label}</span>
              </div>
            ))
        )}
      </div>
    </div>
  )
}
