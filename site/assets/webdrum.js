// WebDrum - prototipo de modulo de bateria pelo navegador (Web MIDI + Web Audio).
//
// Nao existe um parser SFZ aqui de proposito: pra este primeiro teste, cada
// peca usa 1 unico microfone (o "close mic" da propria peca, ou o overhead
// pros toms/chimbal, ja que o kit nao tem microfone dedicado pra eles) em vez
// da mixagem multi-mic completa que o kit original suporta via SFZ - ver
// PIECES abaixo. As amostras sao servidas direto do repositorio original via
// jsDelivr (fixado na tag v1.001), sem copiar nada pro repo do DrumCore.
const KIT_BASE = 'https://cdn.jsdelivr.net/gh/sfzinstruments/karoryfer.gogodze-phu-vol-ii@v1.001/Samples'

const PIECES = [
  { id: 'kick', label: 'Bumbo', note: 36, mic: 'kick_mic', prefix: 'ks', layers: 6, rr: 4, defaultGain: 0.9 },
  { id: 'snare', label: 'Caixa', note: 38, mic: 'snare_mic', prefix: 'sc', layers: 6, rr: 4, defaultGain: 0.85 },
  { id: 'hihat_closed', label: 'Chimbal (fechado)', note: 42, mic: 'oh_mic', prefix: 'hc', layers: 4, rr: 4, defaultGain: 0.75 },
  { id: 'hihat_pedal', label: 'Chimbal (pedal)', note: 44, mic: 'oh_mic', prefix: 'hf', layers: 3, rr: 4, defaultGain: 0.7 },
  { id: 'hihat_open', label: 'Chimbal (aberto)', note: 46, mic: 'oh_mic', prefix: 'ho', layers: 5, rr: 3, defaultGain: 0.75 },
  { id: 'tom_low', label: 'Tom grave', note: 45, mic: 'oh_mic', prefix: 'tl', layers: 5, rr: 4, defaultGain: 0.8 },
  { id: 'tom_mid', label: 'Tom médio', note: 47, mic: 'oh_mic', prefix: 'tm', layers: 5, rr: 4, defaultGain: 0.8 },
  { id: 'tom_high', label: 'Tom agudo', note: 50, mic: 'oh_mic', prefix: 'th', layers: 5, rr: 4, defaultGain: 0.8 }
]

const NOTE_TO_PIECE = new Map(PIECES.map((p) => [p.note, p]))

let audioCtx = null
let masterGain = null
const bufferCache = new Map() // url -> Promise<AudioBuffer>
const rrCounters = Object.create(null) // piece.id -> proximo round-robin (0-based)
const pieceGains = Object.create(null) // piece.id -> GainNode
const mutedPieces = new Set()

function sampleUrlFor(piece, velocity) {
  const layerIdx = Math.min(piece.layers - 1, Math.floor((velocity / 128) * piece.layers))
  const rrIdx = rrCounters[piece.id] || 0
  rrCounters[piece.id] = (rrIdx + 1) % piece.rr
  return `${KIT_BASE}/${piece.mic}/${piece.prefix}_vl${layerIdx + 1}_rr${rrIdx + 1}.wav`
}

async function loadBuffer(url) {
  if (!bufferCache.has(url)) {
    bufferCache.set(
      url,
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`falha ao baixar ${url}: HTTP ${res.status}`)
          return res.arrayBuffer()
        })
        .then((data) => audioCtx.decodeAudioData(data))
    )
  }
  return bufferCache.get(url)
}

function ensureAudioGraph() {
  if (audioCtx) return
  audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  masterGain = audioCtx.createGain()
  masterGain.gain.value = 0.9
  masterGain.connect(audioCtx.destination)
  for (const piece of PIECES) {
    const gain = audioCtx.createGain()
    gain.gain.value = piece.defaultGain
    gain.connect(masterGain)
    pieceGains[piece.id] = gain
  }
}

async function triggerPiece(piece, velocity, onHit) {
  ensureAudioGraph()
  if (audioCtx.state === 'suspended') await audioCtx.resume()
  const url = sampleUrlFor(piece, velocity)
  let buffer
  try {
    buffer = await loadBuffer(url)
  } catch (err) {
    console.error(err)
    return
  }
  const source = audioCtx.createBufferSource()
  source.buffer = buffer
  const hitGain = audioCtx.createGain()
  hitGain.gain.value = Math.max(0.05, velocity / 127)
  source.connect(hitGain)
  hitGain.connect(pieceGains[piece.id])
  source.start(0)
  if (onHit) onHit()
}

function setupMidi(statusEl, lastHitEl, onHit) {
  if (!navigator.requestMIDIAccess) {
    statusEl.innerHTML = '<span class="warn">Web MIDI não suportado neste navegador — use Chrome ou Edge.</span>'
    return
  }

  const renderInputs = (access) => {
    const names = Array.from(access.inputs.values()).map((i) => i.name || i.id)
    statusEl.innerHTML = names.length
      ? `<span class="ok">MIDI conectado:</span> ${names.join(', ')}`
      : '<span class="warn">Nenhum dispositivo MIDI encontrado.</span> Conecte o controlador e recarregue, ou verifique se o navegador pediu permissão.'
  }

  navigator.requestMIDIAccess({ sysex: false }).then(
    (access) => {
      const attachListeners = () => {
        for (const input of access.inputs.values()) {
          input.onmidimessage = (event) => {
            const [status, note, velocity] = event.data
            const isNoteOn = (status & 0xf0) === 0x90 && velocity > 0
            if (!isNoteOn) return
            const piece = NOTE_TO_PIECE.get(note)
            lastHitEl.textContent = piece
              ? `nota ${note} (${piece.label}) · velocity ${velocity}`
              : `nota ${note} · velocity ${velocity} · sem peça mapeada nessa nota`
            if (piece && !mutedPieces.has(piece.id)) {
              triggerPiece(piece, velocity, () => onHit(piece.id))
            }
          }
        }
      }
      attachListeners()
      renderInputs(access)
      access.onstatechange = () => {
        attachListeners()
        renderInputs(access)
      }
    },
    () => {
      statusEl.innerHTML = '<span class="warn">Acesso MIDI negado pelo navegador.</span>'
    }
  )
}

function flashChannel(el) {
  el.classList.add('hit')
  setTimeout(() => el.classList.remove('hit'), 130)
}

function buildChannelStrip(piece) {
  const el = document.createElement('div')
  el.className = 'channel'
  el.innerHTML = `
    <div class="channel-head">
      <span class="channel-name">${piece.label}</span>
      <span class="channel-note mono">nota MIDI ${piece.note}</span>
    </div>
    <div class="channel-fader">
      <input type="range" min="0" max="100" value="${Math.round(piece.defaultGain * 100)}" aria-label="Volume — ${piece.label}" />
      <output>${Math.round(piece.defaultGain * 100)}%</output>
    </div>
    <div class="channel-buttons">
      <button type="button" class="chip-btn mute-btn" aria-pressed="false" title="Mudo">M</button>
      <button type="button" class="chip-btn hit-btn" title="Testar sem MIDI">▶</button>
    </div>
  `

  const fader = el.querySelector('input[type="range"]')
  const readout = el.querySelector('output')
  const muteBtn = el.querySelector('.mute-btn')
  const hitBtn = el.querySelector('.hit-btn')

  fader.addEventListener('input', () => {
    readout.textContent = `${fader.value}%`
    ensureAudioGraph()
    pieceGains[piece.id].gain.value = mutedPieces.has(piece.id) ? 0 : Number(fader.value) / 100
  })

  muteBtn.addEventListener('click', () => {
    const isMuted = mutedPieces.has(piece.id)
    if (isMuted) {
      mutedPieces.delete(piece.id)
      muteBtn.classList.remove('mute-on')
      muteBtn.setAttribute('aria-pressed', 'false')
    } else {
      mutedPieces.add(piece.id)
      muteBtn.classList.add('mute-on')
      muteBtn.setAttribute('aria-pressed', 'true')
    }
    ensureAudioGraph()
    pieceGains[piece.id].gain.value = mutedPieces.has(piece.id) ? 0 : Number(fader.value) / 100
  })

  hitBtn.addEventListener('click', () => {
    triggerPiece(piece, 100, () => flashChannel(el))
  })

  return el
}

function buildMasterStrip() {
  const el = document.createElement('div')
  el.className = 'channel master'
  el.innerHTML = `
    <div class="channel-head">
      <span class="channel-name">Master</span>
    </div>
    <div class="channel-fader">
      <input type="range" min="0" max="100" value="90" aria-label="Volume master" />
      <output>90%</output>
    </div>
  `
  const fader = el.querySelector('input[type="range"]')
  const readout = el.querySelector('output')
  fader.addEventListener('input', () => {
    readout.textContent = `${fader.value}%`
    ensureAudioGraph()
    masterGain.gain.value = Number(fader.value) / 100
  })
  return el
}

function init() {
  const mixerGrid = document.getElementById('wd-mixer')
  const startBtn = document.getElementById('wd-start')
  const midiStatus = document.getElementById('wd-midi-status')
  const lastHit = document.getElementById('wd-last-hit')

  mixerGrid.appendChild(buildMasterStrip())
  const channelEls = new Map()
  for (const piece of PIECES) {
    const strip = buildChannelStrip(piece)
    channelEls.set(piece.id, strip)
    mixerGrid.appendChild(strip)
  }

  startBtn.addEventListener('click', () => {
    ensureAudioGraph()
    audioCtx.resume()
    startBtn.textContent = 'Áudio ativado ✓'
    startBtn.disabled = true
    setupMidi(midiStatus, lastHit, (pieceId) => {
      const strip = channelEls.get(pieceId)
      if (strip) flashChannel(strip)
    })
  })
}

document.addEventListener('DOMContentLoaded', init)
