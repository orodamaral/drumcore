// Aba Global > Crosstalk entre pads (2026-10-25): assistente que mede quanto
// cada pad "vaza" para os outros (start_xtalk_cal / stop_xtalk_cal) e a
// tabela que o módulo usa para descartar os disparos falsos.
import { PadConfig, PadConfigPrimary, XtalkCalStatus, XtalkMatrix } from '../protocol'

interface Props {
  pads: Record<number, PadConfig>
  cal: XtalkCalStatus | null
  matrix: XtalkMatrix | null
  /** firmware sem o recurso (respondeu unknown_cmd) */
  unsupported: boolean
  onSend: (obj: Record<string, unknown>) => void
}

// Pedal (6/7) e choke (9) não entram: não são "golpes".
const EXCLUDED_TYPES = [6, 7, 9]

function padName(pads: Record<number, PadConfig>, i: number): string {
  const p = pads[i]
  if (!p || !p.primary) return `Pad ${i + 1}`
  return p.label || p.name || `Pad ${i + 1}`
}

const RESULT_TEXT: Record<string, string> = {
  weak: 'golpe fraco demais para medir — bata mais forte',
  multi: 'dois pads soaram juntos — bata em um de cada vez'
}

export default function XtalkPanel({ pads, cal, matrix, unsupported, onSend }: Props) {
  const running = cal?.state === 'running'
  const eligible = Object.values(pads)
    .filter((p): p is PadConfigPrimary => p.primary)
    .filter((p) => p.enabled && !EXCLUDED_TYPES.includes(p.pad_type))
    .map((p) => p.pad)
    .sort((a, b) => a - b)
  const hitCount = (i: number) => cal?.hits?.[i] ?? 0
  const missing = eligible.filter((i) => hitCount(i) === 0)
  const pairs = [...(matrix?.pairs ?? [])].filter((p) => p[2] >= 3).sort((a, b) => b[2] - a[2])

  if (unsupported) {
    return (
      <section className="editor-section">
        <h3 className="section-title">Crosstalk entre pads</h3>
        <p className="pad-hint">Este firmware não tem a calibração de crosstalk — atualize o firmware.</p>
      </section>
    )
  }

  return (
    <section className="editor-section">
      <h3 className="section-title">Crosstalk entre pads</h3>
      <p className="pad-hint">
        Quando uma batida forte num pad faz outro disparar sozinho (por exemplo, o bumbo disparando os toms), o módulo
        pode medir quanto cada pad "vaza" para os outros e descartar esses disparos falsos. Faça com a bateria montada
        do jeito que você toca.
      </p>

      {!running ? (
        <div className="global-actions">
          <button className="btn-primary" onClick={() => onSend({ cmd: 'start_xtalk_cal' })}>
            {matrix?.calibrated ? 'Calibrar de novo' : 'Calibrar crosstalk'}
          </button>
          {matrix?.calibrated && (
            <button
              onClick={() => {
                if (window.confirm('Apagar a calibração de crosstalk? Os disparos falsos voltam a passar.'))
                  onSend({ cmd: 'clear_xtalk' })
              }}
            >
              Apagar calibração
            </button>
          )}
        </div>
      ) : (
        <div className="xtalk-cal">
          <p className="autotune-tier">Bata forte em cada pad, um de cada vez, 3 a 5 vezes</p>
          <p className="pad-hint">
            Use a força máxima que você usa tocando — os disparos falsos aparecem justamente nas batidas mais fortes.
            Pode repetir um pad para corrigir; vale o maior vazamento medido.
          </p>
          <div className="xtalk-hits">
            {eligible.map((i) => (
              <span key={i} className={`xtalk-chip ${hitCount(i) >= 3 ? 'done' : hitCount(i) > 0 ? 'some' : ''}`}>
                {padName(pads, i)} <b>{hitCount(i)}</b>
              </span>
            ))}
          </div>
          {cal?.last && (
            <p className="pad-hint xtalk-last">
              Último golpe: <strong>{padName(pads, cal.last.source)}</strong>
              {cal.last.result !== 'ok' ? (
                <> — {RESULT_TEXT[cal.last.result] ?? cal.last.result}</>
              ) : cal.last.victims.length === 0 ? (
                <> — não vazou para nenhum pad</>
              ) : (
                <>
                  {' '}
                  — vazou para{' '}
                  {[...cal.last.victims]
                    .sort((a, b) => b[1] - a[1])
                    .map(([v, pct]) => `${padName(pads, v)} ${pct}%`)
                    .join(', ')}
                </>
              )}
            </p>
          )}
          <div className="global-actions">
            <button
              className="btn-primary"
              onClick={() => onSend({ cmd: 'stop_xtalk_cal', apply: true })}
              disabled={eligible.every((i) => hitCount(i) === 0)}
            >
              Concluir e salvar
            </button>
            <button onClick={() => onSend({ cmd: 'stop_xtalk_cal', apply: false })}>Cancelar</button>
          </div>
          {missing.length > 0 && eligible.some((i) => hitCount(i) > 0) && (
            <p className="pad-hint">
              Ainda sem golpe: {missing.map((i) => padName(pads, i)).join(', ')}. Pads não tocados mantêm a calibração
              anterior.
            </p>
          )}
        </div>
      )}

      {!running && matrix && (
        <>
          {!matrix.calibrated ? (
            <p className="pad-hint">Ainda sem calibração — nenhum disparo é descartado por crosstalk calibrado.</p>
          ) : pairs.length === 0 ? (
            <p className="pad-hint">Calibrado: nenhum pad vaza 3% ou mais para outro.</p>
          ) : (
            <>
              <p className="pad-hint">
                Calibrado. Vazamentos medidos (de 3% para cima) — um disparo do pad atingido é descartado quando fica
                abaixo de 1,5× esse vazamento (ajuste a margem de cada pad no campo <strong>Crosstalk</strong> dele):
              </p>
              <div className="table-scroll">
                <table className="xtalk-table">
                  <thead>
                    <tr>
                      <th>Batida em</th>
                      <th>Aparece em</th>
                      <th>Vazamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.slice(0, 20).map(([victim, source, pct]) => (
                      <tr key={`${victim}-${source}`}>
                        <td>{padName(pads, source)}</td>
                        <td>{padName(pads, victim)}</td>
                        <td>{pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
