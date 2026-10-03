import {
  autoTuneZonesFor,
  AutoTuneHihatPhase,
  AutoTuneStatus,
  AutoTuneTier,
  AUTOTUNE_HH_HOLD_MS,
  AUTOTUNE_TIER_WINDOW_MS,
  PadConfigPrimary,
  PadField,
  PAD_FIELDS,
  PAD_LABEL_MAX_LEN,
  PadType,
  PAD_TYPE_META,
  IncomingMessage
} from './protocol'

function nameFor(pad: number, label: string): string {
  return label ? `${pad + 1} - ${label}` : `Pad ${pad + 1}`
}

function usesSecondChannel(type: PadType): boolean {
  return PAD_TYPE_META[type].channels === 2
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface MockPad extends PadConfigPrimary {
  openHH: boolean // estado simulado do pedal (so relevante pros tipos "pedal")
}

// Simula o firmware (protocolo NDJSON) inteiramente no renderer, sem tocar
// em nenhuma porta serial - permite testar/demonstrar a UI antes de ter o
// hardware montado. Ver docs/04-protocolo-serial.md e
// docs/05-tipos-de-sensor.md pro contrato real.
export class MockDevice {
  private listeners: Array<(line: string) => void> = []
  private pads: MockPad[]
  private primary: boolean[]
  private hitTimer: ReturnType<typeof setInterval> | null = null
  private bleTimer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null
  private bleConnected = false
  private global = { midi_channel: 10, midi_output: 2 as 0 | 1 | 2 }
  // Apelidos dos jacks (tela LIVE) - espelho de jackLabels[] no firmware.
  private jackLabels: string[] = Array.from({ length: 16 }, () => '')

  // Simulacao do assistente de auto-tune (Fase O) - so' pra demonstrar a UI,
  // nao ha' ADC de verdade pra medir. Ver docs/01-decisoes-arquiteturais.md.
  private static readonly AUTOTUNE_TIERS: AutoTuneTier[] = ['weak', 'medium', 'strong']
  private autoTuneTimer: ReturnType<typeof setTimeout> | null = null
  private autoTunePad = -1
  private autoTuneTierIndex = 0
  private autoTuneHitCount = 0
  // [Fase AA] Inicio da janela de tempo do nivel atual (Date.now()) - o
  // nivel nao fecha mais numa meta fixa de golpes, fecha depois de
  // AUTOTUNE_TIER_WINDOW_MS. autoTuneHitCount vira so' contador informativo.
  private autoTuneTierStartMs = 0
  // Fase U/V: pads de 2 canais rodam 1 (PAD_DUAL) ou 2 (prato/caixa 3 zonas)
  // passadas extras (3 níveis de novo cada) depois da passada normal na
  // zona principal - ver autoTuneZonesFor() em protocol.ts (fonte única do
  // mapeamento pad_type -> sequência de zonas) e docs/01-decisoes-
  // arquiteturais.md. Índice na lista de autoTuneZonesFor(pad.pad_type).
  private autoTuneZoneIndex = 0
  // Fase X: controlador de pedal (HHC) usa um fluxo totalmente diferente
  // (sensor de posição contínua) - sem tier/zona, só 2 fases seguradas por
  // AUTOTUNE_HH_HOLD_MS cada. null fora desse fluxo.
  private autoTuneHhPhase: AutoTuneHihatPhase | null = null
  private autoTuneHhPhaseStartMs = 0
  private autoTuneResult: {
    sensitivity: number
    threshold: number
    scan_time: number
    mask_time: number
    rim_sensitivity?: number
    rim_threshold?: number
    curve_type?: number
    retrigger?: number
  } | null = null

  constructor(padCount = 32) {
    this.pads = Array.from({ length: padCount }, (_, i) => this.freshPad(i))
    this.primary = Array.from({ length: padCount }, () => true)
    // Demo começa como uma placa nova: com o mapeamento de fábrica.
    this.applyFactoryPreset()
  }

  // Espelho de applyFactoryPreset() no firmware (main.cpp) - mesmo kit,
  // mesmas notas (keymap do Addictive Drums 2). Manter os dois em sincronia.
  private applyFactoryPreset(): void {
    this.pads = this.pads.map((_, i) => ({ ...this.freshPad(i), enabled: false }))
    const set = (i: number, pad_type: PadType, label: string, note: number, note_rim = 39, note_cup = 40) => {
      if (!this.pads[i]) return
      Object.assign(this.pads[i], { pad_type, label, name: nameFor(i, label), note, note_rim, note_cup, enabled: true })
      this.pads[i].uses_second_channel = usesSecondChannel(pad_type)
    }
    // HH Pedal só com CC4 (sem chick) e HiHat como pad comum na nota 8 -
    // o Addictive Drums decide aberto/fechado e o chick pelo CC.
    set(1, 6, 'HH Pedal', 48)
    this.pads[1].pedal_note = false
    set(2, 0, 'HiHat', 8)
    set(4, 0, 'Kick', 36)
    set(6, 8, 'Snare', 38, 43, 37)
    // Razões da caixa 3 zonas (igual ao firmware): borda 80%, aro 30%.
    this.pads[6].rim_sensitivity = 80
    this.pads[6].rim_threshold = 30
    ;[[71, 72], [69, 70], [67, 68], [65, 66]].forEach(([n, r], t) => set(8 + 2 * t, 1, `Tom ${t + 1}`, n, r))
    ;[[77, 78], [79, 80], [81, 82], [89, 90]].forEach(([n, c], k) => {
      set(16 + 2 * k, 0, `Cym ${k + 1}`, n)
      set(17 + 2 * k, 9, `Choke ${k + 1}`, c)
    })
    set(24, 5, 'Ride 1', 60, 62, 61)
    this.jackLabels = ['HHC', 'HH', 'KICK', 'SNARE', 'TOM1', 'TOM2', 'TOM3', 'TOM4', 'CYM1', 'CYM2', 'CYM3', 'CYM4', 'RIDE', 'XTRA1', 'XTRA2', 'XTRA3']
    this.recomputePrimary()
    this.pads.forEach((p, i) => {
      if (!this.primary[i]) p.enabled = true
    })
    this.global = { midi_channel: 10, midi_output: 2 }
  }

  private wifiActive = false
  private wifiAutostart = false
  private staSsid = ''

  private deviceInfo(): IncomingMessage {
    return {
      type: 'device_info',
      pads: this.pads.length,
      muxes: 2, // 2x CD4067/HW-178 (16 canais cada) desde a Fase K
      ble_connected: this.bleConnected,
      firmware_phase: 'K (demo)',
      firmware_version: 'demo',
      wifi: {
        active: this.wifiActive,
        ap_active: this.wifiActive && !this.staSsid,
        ssid: 'DrumCore-DEMO',
        password: '12345678',
        hostname: 'drumcore',
        ip: this.wifiActive && !this.staSsid ? '192.168.4.1' : '',
        sta_ssid: this.staSsid,
        sta_state: this.wifiActive && this.staSsid ? 'connected' : 'none',
        sta_ip: this.wifiActive && this.staSsid ? '192.168.1.50' : '',
        ap_off_in_ms: 0,
        autostart: this.wifiAutostart,
        clients: 0
      },
      ...this.global
    }
  }

  private freshPad(i: number): MockPad {
    return {
      pad: i,
      primary: true,
      pad_type: 0,
      uses_second_channel: false,
      name: nameFor(i, ''),
      label: '',
      sensitivity: 100,
      threshold: 10,
      scan_time: 10,
      mask_time: 30,
      curve_type: 0,
      retrigger: 0,
      gain: 100,
      xtalk: 0,
      xtalk_group: 0,
      rim_sensitivity: 20,
      rim_threshold: 3,
      note: 36 + i,
      note_rim: 39,
      note_cup: 40,
      hihat_pedal_channel: -1,
      enabled: true,
      hihat_invert: false,
      pedal_note: true,
      pedal_cc: 4,
      openHH: true
    }
  }

  private recomputePrimary(): void {
    for (let i = 0; i < this.pads.length; i++) {
      this.primary[i] = i === 0 ? true : !(this.primary[i - 1] && usesSecondChannel(this.pads[i - 1].pad_type))
    }
  }

  onMessage(listener: (line: string) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  start(): void {
    this.emit({ type: 'log', message: 'Modo demo ativo - simulando o modulo, sem hardware real conectado.' })
    this.hitTimer = setInterval(() => {
      const candidates = this.pads.filter((p, i) => this.primary[i] && p.enabled)
      if (candidates.length === 0) return
      const pad = candidates[Math.floor(Math.random() * candidates.length)]
      this.emitHit(pad)
    }, 1800)

    // Simula pareamento/desconexao BLE-MIDI periodicamente, so pra
    // demonstrar o indicador na UI - no firmware real isso reflete um
    // dispositivo de verdade pareando (ver docs/01-decisoes-arquiteturais.md).
    // Pareia logo no começo e só alterna de vez em quando (antes era a
    // cada 15s, o que enchia o log de pareado/desconectado).
    const toggleBle = () => {
      this.bleConnected = !this.bleConnected
      this.emit({
        type: 'log',
        message: this.bleConnected ? 'BLE-MIDI: dispositivo pareado. (simulado)' : 'BLE-MIDI: dispositivo desconectado. (simulado)'
      })
      this.emit(this.deviceInfo())
    }
    this.bleTimer = setTimeout(() => {
      toggleBle()
      this.bleTimer = setInterval(toggleBle, 90000)
    }, 3000)
  }

  /** Batida simulada num pad específico (botão "Simular batida" do app). */
  simulateHit(padIndex: number): void {
    const pad = this.pads[padIndex]
    if (!pad || !this.primary[padIndex] || !pad.enabled) return
    this.emitHit(pad)
  }

  private emitHit(pad: MockPad): void {
    const zone = this.randomZoneFor(pad)
    // PAD_CHOKE (fita de aluminio): gatilho binario, sempre velocity 127
    // (nao tem envelope de piezo pra variar) - ver dispatchChoke() no
    // firmware.
    const velocity = pad.pad_type === 9 ? 127 : 40 + Math.floor(Math.random() * 87)
    const note = this.noteForZone(pad, zone)
    this.emit({ type: 'hit', pad: pad.pad, zone, note, velocity })
  }

  stop(): void {
    if (this.hitTimer) clearInterval(this.hitTimer)
    this.hitTimer = null
    if (this.bleTimer) {
      clearTimeout(this.bleTimer)
      clearInterval(this.bleTimer)
    }
    this.bleTimer = null
    this.bleConnected = false
    if (this.autoTuneTimer) clearTimeout(this.autoTuneTimer)
    this.autoTuneTimer = null
    this.autoTunePad = -1
  }

  private randomZoneFor(pad: MockPad): string {
    switch (pad.pad_type) {
      case 1:
        return Math.random() < 0.7 ? 'head' : 'rim'
      case 2:
        return pad.openHH ? 'open' : 'closed'
      case 3:
        return Math.random() < 0.7 ? 'bow' : 'edge'
      case 4:
        return Math.random() < 0.7 ? 'bow' : 'edge'
      case 5: {
        const r = Math.random()
        return r < 0.6 ? 'bow' : r < 0.85 ? 'edge' : 'cup'
      }
      case 6:
      case 7:
        return 'pedal'
      case 8: {
        const r = Math.random()
        return r < 0.6 ? 'head' : r < 0.85 ? 'edge' : 'rim'
      }
      case 9:
        return 'touch'
      default:
        return 'bow'
    }
  }

  private noteForZone(pad: MockPad, zone: string): number {
    if (zone === 'rim' && pad.pad_type === 8) return pad.note_cup // caixa 3 zonas: "rim" usa o slot note_cup
    if (zone === 'rim' || zone === 'edge' || zone === 'closed') return pad.note_rim
    if (zone === 'cup') return pad.note_cup
    return pad.note
  }

  send(line: string): void {
    let cmd: { cmd?: string; pad?: number; field?: string; value?: number | string; enabled?: unknown; autostart?: unknown; ssid?: unknown }
    try {
      cmd = JSON.parse(line)
    } catch {
      this.emit({ type: 'error', cmd: '?', message: 'invalid_json' })
      return
    }

    switch (cmd.cmd) {
      case 'ping':
        this.emit({ type: 'pong' })
        break

      case 'get_device_info':
        this.emit(this.deviceInfo())
        break

      case 'set_wifi':
        if (typeof cmd.enabled !== 'boolean' && typeof cmd.autostart !== 'boolean') {
          this.emit({ type: 'error', cmd: 'set_wifi', message: 'invalid_value' })
          break
        }
        if (typeof cmd.autostart === 'boolean') this.wifiAutostart = cmd.autostart
        if (typeof cmd.enabled === 'boolean') {
          this.wifiActive = cmd.enabled
          this.emit({ type: 'log', message: cmd.enabled ? 'Wi-Fi ligado.' : 'Wi-Fi desligado.' })
        }
        this.emit(this.deviceInfo())
        break

      case 'set_wifi_network':
        if (typeof cmd.ssid !== 'string' || !cmd.ssid) {
          this.emit({ type: 'error', cmd: 'set_wifi_network', message: 'invalid_value' })
          break
        }
        this.staSsid = cmd.ssid
        this.emit(this.deviceInfo())
        break

      case 'forget_wifi_network':
        this.staSsid = ''
        this.emit(this.deviceInfo())
        break

      case 'retry_wifi_network':
        this.emit(this.deviceInfo())
        break

      case 'scan_wifi':
        if (!this.wifiActive) {
          this.emit({ type: 'error', cmd: 'scan_wifi', message: 'wifi_off' })
          break
        }
        setTimeout(
          () =>
            this.emit({
              type: 'wifi_scan',
              networks: [
                { ssid: 'Casa', rssi: -52, secure: true },
                { ssid: 'Casa_5G', rssi: -67, secure: true },
                { ssid: 'Vizinho', rssi: -83, secure: true }
              ]
            }),
          1200
        )
        break

      case 'get_all_pads':
        this.pads.forEach((_, i) => this.emitPadConfig(i))
        break

      case 'get_pad': {
        if (typeof cmd.pad === 'number' && this.pads[cmd.pad]) this.emitPadConfig(cmd.pad)
        else this.emit({ type: 'error', cmd: 'get_pad', message: 'invalid_pad' })
        break
      }

      case 'set_pad':
        this.handleSetPad(cmd)
        break

      case 'set_global':
        this.handleSetGlobal(cmd)
        break

      case 'save_all':
        this.emit({ type: 'log', message: 'Configuracao salva (save_all). (simulado)' })
        this.emit(this.deviceInfo())
        break

      case 'restore_all':
        this.emit({ type: 'log', message: 'Configuracao restaurada (restore_all). (simulado)' })
        this.emit(this.deviceInfo())
        break

      case 'get_jacks':
        this.jackLabels.forEach((label, jack) => this.emit({ type: 'jack_config', jack, label }))
        break

      case 'set_jack': {
        const c = cmd as { jack?: number; field?: string; value?: unknown }
        if (typeof c.jack !== 'number' || c.jack < 0 || c.jack >= this.jackLabels.length) {
          this.emit({ type: 'error', cmd: 'set_jack', message: 'invalid_jack' })
          break
        }
        if (typeof c.value !== 'string' || c.value.length > 6 || !/^[\x20-\x7e]*$/.test(c.value)) {
          this.emit({ type: 'error', cmd: 'set_jack', message: 'invalid_label' })
          break
        }
        this.jackLabels[c.jack] = c.value
        this.emit({ type: 'jack_config', jack: c.jack, label: c.value })
        break
      }

      case 'factory_reset':
        if ((cmd as { confirm?: boolean }).confirm !== true) {
          this.emit({ type: 'error', cmd: 'factory_reset', message: 'confirm_required' })
          break
        }
        this.applyFactoryPreset()
        this.pads.forEach((_, i) => this.emitPadConfig(i))
        this.jackLabels.forEach((label, jack) => this.emit({ type: 'jack_config', jack, label }))
        this.emit({ type: 'log', message: 'Padrao de fabrica restaurado (factory_reset). (simulado)' })
        this.emit(this.deviceInfo())
        break

      case 'start_autotune':
        this.handleStartAutotune(cmd)
        break

      case 'cancel_autotune':
        this.handleCancelAutotune()
        break

      case 'apply_autotune':
        this.handleApplyAutotune()
        break

      default:
        this.emit({ type: 'error', cmd: cmd.cmd ?? '?', message: 'unknown_cmd' })
    }
  }

  private handleSetGlobal(cmd: { field?: string; value?: number | string }): void {
    const value = typeof cmd.value === 'number' ? cmd.value : -1

    if (cmd.field === 'midi_channel' && value >= 1 && value <= 16) {
      this.global.midi_channel = value
    } else if (cmd.field === 'midi_output' && value >= 0 && value <= 2) {
      this.global.midi_output = value as 0 | 1 | 2
    } else {
      this.emit({ type: 'error', cmd: 'set_global', message: 'value_out_of_range' })
      return
    }

    this.emit({ type: 'ack', cmd: 'set_global', pad: -1, field: cmd.field ?? '', value })
    this.emit(this.deviceInfo())
  }

  private autoTuneZones(): ReturnType<typeof autoTuneZonesFor> {
    const pad = this.pads[this.autoTunePad]
    return pad ? autoTuneZonesFor(pad.pad_type) : []
  }

  private emitAutoTuneStatus(state: AutoTuneStatus['state'], extra: Partial<AutoTuneStatus> = {}): void {
    const zones = this.autoTuneZones()
    const tierInfo =
      state !== 'collecting'
        ? {}
        : this.autoTuneHhPhase
          ? {
              phase: this.autoTuneHhPhase,
              hold_elapsed_ms: Date.now() - this.autoTuneHhPhaseStartMs,
              hold_target_ms: AUTOTUNE_HH_HOLD_MS
            }
          : {
              tier: MockDevice.AUTOTUNE_TIERS[this.autoTuneTierIndex],
              tier_index: this.autoTuneTierIndex + 1,
              tier_count: MockDevice.AUTOTUNE_TIERS.length,
              tier_elapsed_ms: Date.now() - this.autoTuneTierStartMs,
              tier_target_ms: AUTOTUNE_TIER_WINDOW_MS,
              ...(zones.length > 0 ? { zone: zones[this.autoTuneZoneIndex] } : {})
            }
    this.emit({
      type: 'autotune_status',
      pad: this.autoTunePad,
      state,
      hit_count: this.autoTuneHitCount,
      ...tierInfo,
      ...extra
    })
  }

  private handleStartAutotune(cmd: { pad?: number }): void {
    const pad = typeof cmd.pad === 'number' ? this.pads[cmd.pad] : undefined
    if (!pad || cmd.pad === undefined || !this.primary[cmd.pad]) {
      this.emit({ type: 'error', cmd: 'start_autotune', message: 'invalid_pad' })
      return
    }
    if (!pad.enabled) {
      this.emit({ type: 'error', cmd: 'start_autotune', message: 'channel_disabled' })
      return
    }
    if (pad.pad_type === 9) {
      // PAD_CHOKE (fita de aluminio): gatilho binario, sem envelope de
      // piezo pra calibrar - espelha a recusa do firmware real.
      this.emit({ type: 'error', cmd: 'start_autotune', message: 'not_applicable_for_choke' })
      return
    }

    if (this.autoTuneTimer) clearTimeout(this.autoTuneTimer)
    this.autoTunePad = cmd.pad
    this.autoTuneTierIndex = 0
    this.autoTuneHitCount = 0
    this.autoTuneTierStartMs = 0
    this.autoTuneZoneIndex = 0
    this.autoTuneHhPhase = null
    this.autoTuneResult = null

    if (PAD_TYPE_META[pad.pad_type].isHihatPedal) {
      // [Fase X] Sensor de posição contínua - pula a fase de ruído, vai
      // direto pra 1ª posição (aberta). Ver scheduleHihatPhase().
      this.autoTuneHhPhase = 'hh_open'
      this.autoTuneHhPhaseStartMs = Date.now()
      this.emitAutoTuneStatus('collecting')
      this.scheduleHihatPhase()
      return
    }

    this.emitAutoTuneStatus('noise')

    // Fase "ruido" simulada - so' espera um tempo fixo, nao ha' ADC de
    // verdade pra medir nada aqui.
    this.autoTuneTimer = setTimeout(() => {
      this.autoTuneTierStartMs = Date.now() // [Fase AA] janela do nivel FRACO comeca so' agora
      this.emitAutoTuneStatus('collecting')
      this.scheduleAutoTuneHit()
    }, 2000)
  }

  // [Fase X] Segura AUTOTUNE_HH_HOLD_MS em cada posição (aberta, depois
  // fechada) - sem ADC de verdade, so' finaliza com um resultado plausível.
  private scheduleHihatPhase(): void {
    this.autoTuneTimer = setTimeout(() => {
      if (this.autoTuneHhPhase === 'hh_open') {
        this.autoTuneHhPhase = 'hh_closed'
        this.autoTuneHhPhaseStartMs = Date.now()
        this.emitAutoTuneStatus('collecting')
        this.scheduleHihatPhase()
        return
      }

      const pad = this.pads[this.autoTunePad]
      this.autoTuneResult = {
        threshold: clamp(pad.threshold + Math.round((Math.random() - 0.5) * 4), 1, 100),
        sensitivity: clamp(pad.sensitivity + Math.round((Math.random() - 0.5) * 4), 1, 100),
        scan_time: pad.scan_time,
        mask_time: pad.mask_time
      }
      this.autoTuneHhPhase = null
      this.emitAutoTuneStatus('done', { ...this.autoTuneResult, mode: 'hihat_range' })
    }, AUTOTUNE_HH_HOLD_MS)
  }

  // [Fase AA] Simula um golpe chegando a cada ~600-900ms - o nivel atual so'
  // fecha depois que a janela de tempo (AUTOTUNE_TIER_WINDOW_MS) esgota
  // (era uma meta fixa de golpes), ai' avanca fraco -> medio -> forte, ate'
  // fechar os 3. Pads de 2 canais fazem isso 1x por zona extra
  // (autoTuneZones()) - Fase U/V.
  private scheduleAutoTuneHit(): void {
    this.autoTuneTimer = setTimeout(() => {
      this.autoTuneHitCount++
      if (Date.now() - this.autoTuneTierStartMs >= AUTOTUNE_TIER_WINDOW_MS) {
        if (this.autoTuneTierIndex < MockDevice.AUTOTUNE_TIERS.length - 1) {
          this.autoTuneTierIndex++
          this.autoTuneHitCount = 0
          this.autoTuneTierStartMs = Date.now()
          this.emitAutoTuneStatus('collecting')
          this.scheduleAutoTuneHit()
          return
        }
        const zones = this.autoTuneZones()
        if (this.autoTuneZoneIndex < zones.length - 1) {
          // Zona atual completa - avanca pra proxima, do zero (FRACO).
          this.autoTuneZoneIndex++
          this.autoTuneTierIndex = 0
          this.autoTuneHitCount = 0
          this.autoTuneTierStartMs = Date.now()
          this.emitAutoTuneStatus('collecting')
          this.scheduleAutoTuneHit()
          return
        }
        const pad = this.pads[this.autoTunePad]
        // Resultado plausivel - so' pra demonstrar a UI (variacao pequena
        // em torno do que o pad ja tinha configurado).
        this.autoTuneResult = {
          sensitivity: clamp(pad.sensitivity + Math.round((Math.random() - 0.5) * 10), 1, 100),
          threshold: clamp(pad.threshold + Math.round((Math.random() - 0.5) * 6), 1, 100),
          scan_time: clamp(8 + Math.round(Math.random() * 6), 1, 100),
          mask_time: clamp(25 + Math.round(Math.random() * 10), 1, 100),
          // Fase AB: só pra demonstrar a UI recebendo os campos novos - o
          // firmware de verdade infere isso da coleta (ver finishAutoTune()
          // em main.cpp), aqui é só um valor plausível qualquer.
          curve_type: Math.floor(Math.random() * 5),
          retrigger: Math.round(Math.random() * 40),
          ...(zones.length > 0
            ? {
                rim_sensitivity: clamp(pad.rim_sensitivity + Math.round((Math.random() - 0.5) * 10), 1, 100),
                rim_threshold: clamp(pad.rim_threshold + Math.round((Math.random() - 0.5) * 6), 1, 100)
              }
            : {})
        }
        this.emitAutoTuneStatus('done', this.autoTuneResult)
      } else {
        this.emitAutoTuneStatus('collecting')
        this.scheduleAutoTuneHit()
      }
    }, 600 + Math.random() * 300)
  }

  private handleCancelAutotune(): void {
    if (this.autoTuneTimer) clearTimeout(this.autoTuneTimer)
    this.autoTuneTimer = null
    const pad = this.autoTunePad
    this.autoTunePad = -1
    this.autoTuneTierIndex = 0
    this.autoTuneHitCount = 0
    this.autoTuneTierStartMs = 0
    this.autoTuneZoneIndex = 0
    this.autoTuneHhPhase = null
    this.autoTuneResult = null
    this.emit({ type: 'autotune_status', pad, state: 'idle', hit_count: 0 })
  }

  private handleApplyAutotune(): void {
    if (this.autoTunePad < 0 || !this.autoTuneResult) {
      this.emit({ type: 'error', cmd: 'apply_autotune', message: 'not_ready' })
      return
    }
    const pad = this.pads[this.autoTunePad]
    pad.sensitivity = this.autoTuneResult.sensitivity
    pad.threshold = this.autoTuneResult.threshold
    pad.scan_time = this.autoTuneResult.scan_time
    pad.mask_time = this.autoTuneResult.mask_time
    if (this.autoTuneResult.rim_sensitivity !== undefined) {
      pad.rim_sensitivity = this.autoTuneResult.rim_sensitivity
    }
    if (this.autoTuneResult.rim_threshold !== undefined) {
      pad.rim_threshold = this.autoTuneResult.rim_threshold
    }
    if (this.autoTuneResult.curve_type !== undefined) {
      pad.curve_type = this.autoTuneResult.curve_type
    }
    if (this.autoTuneResult.retrigger !== undefined) {
      pad.retrigger = this.autoTuneResult.retrigger
    }
    // Igual ao firmware (applyAutoTuneResult): o resultado foi medido com
    // gain neutro, então aplicar sempre deixa o gain em 100.
    pad.gain = 100

    const appliedPad = this.autoTunePad
    this.autoTunePad = -1
    this.autoTuneTierIndex = 0
    this.autoTuneHitCount = 0
    this.autoTuneTierStartMs = 0
    this.autoTuneZoneIndex = 0
    this.autoTuneHhPhase = null
    this.autoTuneResult = null

    this.emit({ type: 'autotune_status', pad: appliedPad, state: 'idle', hit_count: 0 })
    this.emitPadConfig(appliedPad)
  }

  private emitPadConfig(i: number): void {
    if (!this.primary[i]) {
      this.emit({ type: 'pad_config', pad: i, primary: false, consumed_by: i - 1 })
      return
    }
    const { openHH, ...config } = this.pads[i]
    void openHH
    this.emit({ type: 'pad_config', ...config })
  }

  private handleSetPad(cmd: { pad?: number; field?: string; value?: number | string }): void {
    const pad = typeof cmd.pad === 'number' ? this.pads[cmd.pad] : undefined
    if (!pad) {
      this.emit({ type: 'error', cmd: 'set_pad', message: 'invalid_pad' })
      return
    }
    if (!this.primary[pad.pad]) {
      this.emit({ type: 'error', cmd: 'set_pad', message: 'channel_consumed' })
      return
    }

    if (cmd.field === 'label') {
      const label = typeof cmd.value === 'string' ? cmd.value : ''
      if (label.length > PAD_LABEL_MAX_LEN) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'value_too_long' })
        return
      }
      pad.label = label
      pad.name = nameFor(pad.pad, label)
      this.emitPadConfig(pad.pad)
      return
    }

    if (cmd.field === 'pad_type') {
      const value = typeof cmd.value === 'number' ? cmd.value : -1
      if (!(value in PAD_TYPE_META)) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'value_out_of_range' })
        return
      }
      const newType = value as PadType
      if (usesSecondChannel(newType) && pad.pad >= this.pads.length - 1) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'no_second_channel' })
        return
      }
      // Igual ao firmware (padTypeAllowedAt()): 2 zonas só começando no TIP
      // do jack (canal 0-based par) - ver jacks.ts.
      if (usesSecondChannel(newType) && pad.pad % 2 === 1) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'two_channel_needs_tip' })
        return
      }

      pad.pad_type = newType
      pad.uses_second_channel = usesSecondChannel(newType)
      this.recomputePrimary()

      this.emitPadConfig(pad.pad)
      if (pad.pad + 1 < this.pads.length) this.emitPadConfig(pad.pad + 1)
      return
    }

    if (cmd.field === 'hihat_pedal_channel') {
      const value = typeof cmd.value === 'number' ? cmd.value : -1
      if (value < 0) {
        pad.hihat_pedal_channel = -1
      } else {
        const target = this.pads[value]
        if (!target || !PAD_TYPE_META[target.pad_type].isHihatPedal) {
          this.emit({ type: 'error', cmd: 'set_pad', message: 'invalid_pedal_channel' })
          return
        }
        pad.hihat_pedal_channel = value
      }
      this.emitPadConfig(pad.pad)
      return
    }

    if (cmd.field === 'enabled') {
      const value = typeof cmd.value === 'number' ? cmd.value : -1
      if (value !== 0 && value !== 1) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'value_out_of_range' })
        return
      }
      pad.enabled = value === 1
      this.emitPadConfig(pad.pad)
      return
    }

    if (cmd.field === 'pedal_note') {
      const value = typeof cmd.value === 'number' ? cmd.value : -1
      if (value !== 0 && value !== 1) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'value_out_of_range' })
        return
      }
      pad.pedal_note = value === 1
      this.emitPadConfig(pad.pad)
      return
    }

    if (cmd.field === 'hihat_invert') {
      const value = typeof cmd.value === 'number' ? cmd.value : -1
      if (value !== 0 && value !== 1) {
        this.emit({ type: 'error', cmd: 'set_pad', message: 'value_out_of_range' })
        return
      }
      pad.hihat_invert = value === 1
      this.emitPadConfig(pad.pad)
      return
    }

    if (!cmd.field || !PAD_FIELDS.includes(cmd.field as PadField) || typeof cmd.value !== 'number') {
      this.emit({ type: 'error', cmd: 'set_pad', message: 'unknown_field' })
      return
    }

    pad[cmd.field as PadField] = cmd.value
    this.emit({ type: 'ack', cmd: 'set_pad', pad: pad.pad, field: cmd.field, value: cmd.value })
  }

  private emit(message: IncomingMessage): void {
    const line = JSON.stringify(message)
    this.listeners.forEach((listener) => listener(line))
  }
}
