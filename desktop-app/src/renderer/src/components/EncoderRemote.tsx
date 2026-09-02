import { useRef } from 'react'

// Controle remoto dos 2 encoders físicos via protocolo serial (comando
// "enc_input" - ver docs/04-protocolo-serial.md), pra navegar/testar a tela
// real do módulo pelo app desktop antes dos encoders físicos estarem
// conectados (Fase Q). Sem estado/tela própria (diferente do
// HardwareSimulator, que é uma maquete local desconectada do hardware) - o
// resultado de cada ação aparece direto na tela física do módulo, que é a
// única fonte da verdade de navegação.
const HOLD_MS = 600

interface Props {
  send: (obj: Record<string, unknown>) => void
}

export default function EncoderRemote({ send }: Props) {
  const holdFired1 = useRef(false)
  const holdFired2 = useRef(false)
  const holdTimer1 = useRef<ReturnType<typeof setTimeout>>()
  const holdTimer2 = useRef<ReturnType<typeof setTimeout>>()

  function bindEncoder(enc: 1 | 2, holdFired: typeof holdFired1, holdTimer: typeof holdTimer1) {
    return {
      onWheel: (event: React.WheelEvent) => {
        send({ cmd: 'enc_input', enc, action: 'rotate', delta: event.deltaY < 0 ? 1 : -1 })
      },
      onMouseDown: () => {
        holdFired.current = false
        holdTimer.current = setTimeout(() => {
          holdFired.current = true
          send({ cmd: 'enc_input', enc, action: 'hold' })
        }, HOLD_MS)
      },
      onMouseUp: () => {
        if (holdTimer.current) clearTimeout(holdTimer.current)
      },
      onMouseLeave: () => {
        if (holdTimer.current) clearTimeout(holdTimer.current)
      },
      onClick: () => {
        if (holdFired.current) {
          holdFired.current = false
          return
        }
        send({ cmd: 'enc_input', enc, action: 'click' })
      }
    }
  }

  const enc1Handlers = bindEncoder(1, holdFired1, holdTimer1)
  const enc2Handlers = bindEncoder(2, holdFired2, holdTimer2)

  return (
    <div className="encoder-remote">
      <span className="encoder-remote-title">Controle remoto dos encoders</span>
      <div className="hw-sim-controls">
        <div className="hw-sim-encoder">
          <button className="hw-sim-knob" {...enc1Handlers}>
            <span className="hw-sim-knob-mark" />
          </button>
          <span className="hw-sim-encoder-label">
            ENC1 — página / pad em foco
            <br />
            girar: roda do mouse · clique: PAD_EDIT⇄SIGNAL · manter: LIVE
          </span>
        </div>

        <div className="hw-sim-encoder">
          <button className="hw-sim-knob" {...enc2Handlers}>
            <span className="hw-sim-knob-mark" />
          </button>
          <span className="hw-sim-encoder-label">
            ENC2 — navegação / valor
            <br />
            girar: roda do mouse · clique: entrar/confirmar · manter: voltar
          </span>
        </div>
      </div>
      <p className="encoder-remote-hint">Veja o resultado na tela física do módulo.</p>
    </div>
  )
}
