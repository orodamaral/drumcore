import { useEffect, useRef } from 'react'

// Resumo do kit de fábrica - espelha applyFactoryPreset() no firmware
// (main.cpp) e no mockDevice.ts. Notas do keymap do Addictive Drums 2.
const KIT: Array<[string, string, string]> = [
  ['1', 'desligado', 'HH Pedal (CC4, sem chick)'],
  ['2', 'HiHat (nota 8)', 'desligado'],
  ['3', 'Kick', 'desligado'],
  ['4', 'Snare 3 zonas', '(borda / aro)'],
  ['5–8', 'Tom 1–4 (pele)', '(aro)'],
  ['9–12', 'Cym 1–4', 'Choke 1–4'],
  ['13', 'Ride 1 3 zonas (corpo)', '(borda / cup)'],
  ['14–16', 'desligado', 'desligado']
]

export default function FactoryResetDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="factory-title">
      <h2 id="factory-title">Restaurar padrão de fábrica</h2>
      <p className="dialog-sub">
        Apaga a configuração atual de <strong>todos os 32 canais</strong> (tipos, nomes, notas, calibração, crosstalk) e
        grava o kit de fábrica abaixo na memória do módulo, com as notas do Addictive Drums 2. Não dá para desfazer.
      </p>

      <table className="factory-table">
        <thead>
          <tr>
            <th>Jack</th>
            <th>Tip</th>
            <th>Ring</th>
          </tr>
        </thead>
        <tbody>
          {KIT.map(([jack, tip, ring]) => (
            <tr key={jack}>
              <td>{jack}</td>
              <td>{tip}</td>
              <td>{ring}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dialog-foot">
        <span className="dialog-summary">Dica: salve antes o que quiser guardar (ex: anote as notas dos pads).</span>
        <button type="button" onClick={() => ref.current?.close()} autoFocus>
          Cancelar
        </button>
        <button
          type="button"
          className="btn-danger solid"
          onClick={() => {
            onConfirm()
            ref.current?.close()
          }}
        >
          Restaurar fábrica
        </button>
      </div>
    </dialog>
  )
}
