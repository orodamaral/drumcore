// Marca "DRUMCORE": grade de pixels 8x4 (ver design/LOGOS.md, direcao 1A) -
// mesmo bitmap usado no silkscreen da jackboard (hardware/jackboard/...),
// aqui como SVG pra reusar no site e no app.
const COLS = 8
const ROWS = 4
const CELL = 10
const GAP = 2
const STEP = CELL + GAP
const LIT = new Set([1, 2, 5, 6, 9, 11, 12, 14, 17, 18, 21, 22, 25, 26, 29, 30])
const ACCENT = 12

export default function Logo(): JSX.Element {
  const cells = []
  for (let i = 0; i < COLS * ROWS; i++) {
    const row = Math.floor(i / COLS)
    const col = i % COLS
    const fill = i === ACCENT ? 'var(--accent)' : LIT.has(i) ? 'var(--txt)' : 'var(--line)'
    cells.push(
      <rect key={i} x={col * STEP} y={row * STEP} width={CELL} height={CELL} rx={2} fill={fill} />
    )
  }

  return (
    <svg
      className="brand-logo"
      viewBox={`0 0 ${COLS * STEP - GAP} ${ROWS * STEP - GAP}`}
      width="30"
      height="15"
      aria-hidden="true"
      focusable="false"
    >
      {cells}
    </svg>
  )
}
