import { useEffect, useRef } from 'react'

const GROUPS: Array<{ title: string; items: Array<[string[], string]> }> = [
  {
    title: 'Pads',
    items: [
      [['↑ / ↓'], 'Trocar de pad (com a lista em foco)'],
      [['Alt', '↑ / ↓'], 'Trocar de pad de qualquer lugar da aba'],
      [['Ctrl', 'Z'], 'Desfazer a última alteração de valores'],
      [['Ctrl', 'Shift', 'Z'], 'Refazer (também Ctrl+Y)']
    ]
  },
  {
    title: 'Sliders e campos',
    items: [
      [['← / →'], 'Ajustar 1 passo (slider em foco)'],
      [['PgUp / PgDn'], 'Ajustar 10% da faixa'],
      [['Home / End'], 'Ir para o mínimo / máximo'],
      [['Enter'], 'Confirmar valor digitado'],
      [['Esc'], 'Cancelar valor digitado'],
      [['Duplo clique'], 'No nome do parâmetro: restaurar o padrão']
    ]
  },
  {
    title: 'Geral',
    items: [
      [['Esc'], 'Fechar diálogo / descartar resultado da calibração'],
      [['?'], 'Abrir esta lista']
    ]
  }
]

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="shortcuts-title">
      <h2 id="shortcuts-title">Atalhos de teclado</h2>
      {GROUPS.map((g) => (
        <section key={g.title} className="shortcuts-group">
          <h3 className="section-title">{g.title}</h3>
          <dl>
            {g.items.map(([keys, desc]) => (
              <div key={desc} className="shortcut-row">
                <dt>
                  {keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && <span className="kbd-plus">+</span>}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{desc}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <div className="dialog-foot">
        <span className="dialog-summary">No Mac, use ⌘ no lugar de Ctrl.</span>
        <button type="button" className="btn-primary" onClick={() => ref.current?.close()}>
          Fechar
        </button>
      </div>
    </dialog>
  )
}
