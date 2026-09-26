interface Props {
  /** Velocities mais recentes do pad selecionado (mais antiga primeiro). */
  history: number[]
  onSimulate?: () => void
}

// Monitor "nível A": só usa os eventos "hit" que o módulo já envia pela
// serial. Um gráfico do sinal bruto do piezo (nível B) exigiria um comando
// novo no firmware - fora do escopo.
export default function HitMonitor({ history, onSimulate }: Props) {
  const last = history.length ? history[history.length - 1] : null
  const min = history.length ? Math.min(...history) : null
  const max = history.length ? Math.max(...history) : null
  const avg = history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : null

  return (
    <div className="hit-monitor">
      <div className="hit-monitor-main">
        <span className="hit-monitor-title">Última batida</span>
        <div className="hit-meter" aria-hidden>
          <div className="hit-meter-fill" style={{ width: `${((last ?? 0) / 127) * 100}%` }} />
        </div>
        <span className="hit-monitor-value" aria-live="polite">
          {last ?? '—'}
          <small>/127</small>
        </span>
      </div>

      <div className="hit-monitor-history" aria-hidden>
        {Array.from({ length: 20 }, (_, i) => {
          const v = history[history.length - 20 + i]
          return <span key={i} style={{ height: v === undefined ? 0 : `${Math.max(4, (v / 127) * 100)}%` }} />
        })}
      </div>

      <dl className="hit-monitor-stats">
        <div>
          <dt>mín</dt>
          <dd>{min ?? '—'}</dd>
        </div>
        <div>
          <dt>méd</dt>
          <dd>{avg ?? '—'}</dd>
        </div>
        <div>
          <dt>máx</dt>
          <dd>{max ?? '—'}</dd>
        </div>
      </dl>

      {onSimulate && (
        <button type="button" className="btn-ghost" onClick={onSimulate}>
          Simular batida
        </button>
      )}
      {!history.length && !onSimulate && <span className="hit-monitor-empty">Bata no pad para ver a velocity.</span>}
    </div>
  )
}
