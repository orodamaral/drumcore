import { useEffect, useRef, useState } from 'react'

export type LogLevel = 'info' | 'error'

export interface LogEntry {
  id: number
  time: Date
  level: LogLevel
  text: string
  /** Repetições consecutivas idênticas agrupadas nesta linha. */
  count: number
}

interface Props {
  entries: LogEntry[]
  onClear: () => void
}

function hhmmss(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour12: false })
}

export default function LogPanel({ entries, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [seenId, setSeenId] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  const last = entries[entries.length - 1]
  const lastId = last?.id ?? 0

  // Erros abrem o painel sozinhos.
  useEffect(() => {
    if (last?.level === 'error') setOpen(true)
  }, [lastId, last?.level])

  useEffect(() => {
    if (open) {
      setSeenId(lastId)
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
    }
  }, [open, lastId, entries.length])

  const unseen = open ? 0 : entries.filter((e) => e.id > seenId).length
  const visible = errorsOnly ? entries.filter((e) => e.level === 'error') : entries

  function copy(): void {
    const text = visible
      .map((e) => `${hhmmss(e.time)} [${e.level}] ${e.text}${e.count > 1 ? ` ×${e.count}` : ''}`)
      .join('\n')
    navigator.clipboard?.writeText(text).catch(() => undefined)
  }

  return (
    <footer className={`log-panel${open ? ' open' : ''}`}>
      <div className="log-bar">
        <button type="button" className="log-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="log-caret" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          Log
          {unseen > 0 && <span className="log-count">{unseen}</span>}
        </button>

        {!open && last && (
          <span className={`log-last level-${last.level}`}>
            <time>{hhmmss(last.time)}</time> {last.text}
            {last.count > 1 && <span className="log-repeat">×{last.count}</span>}
          </span>
        )}

        {open && (
          <div className="log-actions">
            <label className="log-filter">
              <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
              Só erros
            </label>
            <button type="button" className="btn-ghost small" onClick={copy}>
              Copiar
            </button>
            <button type="button" className="btn-ghost small" onClick={onClear}>
              Limpar
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="log-body" ref={bodyRef}>
          {visible.length === 0 && <div className="log-line muted">Nenhuma mensagem.</div>}
          {visible.map((e) => (
            <div key={e.id} className={`log-line level-${e.level}`}>
              <time>{hhmmss(e.time)}</time>
              <span className="log-level">{e.level === 'error' ? 'erro' : 'info'}</span>
              <span className="log-text">{e.text}</span>
              {e.count > 1 && <span className="log-repeat">×{e.count}</span>}
            </div>
          ))}
        </div>
      )}
    </footer>
  )
}
