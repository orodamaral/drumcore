// Atualização do firmware pelo Wi-Fi (Fase AE, fase 3 - ver docs/08-wifi.md).
// O navegador manda pra placa (POST /update) só o binário do APP. A release
// publica um binário completo (bootloader + tabela de partições + app, ver
// .github/workflows/firmware-release.yml) - o app começa em 0x10000 e é
// recortado daqui. Um arquivo que já seja só o app (firmware.bin do
// PlatformIO) também serve.

/** Onde o app fica no binário completo (default_16MB.csv: app0 em 0x10000). */
export const DEFAULT_APP_OFFSET = 0x10000
const PARTITION_TABLE_OFFSET = 0x8000
const ESP_IMAGE_MAGIC = 0xe9
const CHIP_ID_ESP32S3 = 9

function checkAppImage(app: Uint8Array): void {
  if (app.length < 0x100 || app[0] !== ESP_IMAGE_MAGIC) {
    throw new Error('O arquivo não parece um firmware do ESP32.')
  }
  if ((app[12] | (app[13] << 8)) !== CHIP_ID_ESP32S3) {
    throw new Error('Esse firmware é de outro modelo de ESP32 (o DrumCore usa o ESP32-S3).')
  }
}

/** Binário completo da release -> só o app; arquivo que já é só o app passa direto. */
export function extractAppImage(bytes: Uint8Array, appOffset = DEFAULT_APP_OFFSET): Uint8Array {
  // Tabela de partições (magic 0xAA 0x50) em 0x8000 = binário completo.
  const merged =
    bytes.length > appOffset + 0x100 &&
    bytes[PARTITION_TABLE_OFFSET] === 0xaa &&
    bytes[PARTITION_TABLE_OFFSET + 1] === 0x50
  const app = merged ? bytes.subarray(appOffset) : bytes
  checkAppImage(app)
  return app
}

const UPLOAD_ERRORS: Record<string, string> = {
  not_armed: 'o módulo não estava esperando a atualização (a confirmação expirou?)',
  invalid_image: 'o arquivo não é um firmware válido',
  wrong_chip: 'o firmware é de outro modelo de ESP32',
  too_big: 'o firmware não cabe na memória do módulo',
  write_failed: 'erro ao gravar na memória do módulo',
  verify_failed: 'o arquivo chegou corrompido (falhou a conferência)',
  upload_stalled: 'a transferência parou no meio',
  incomplete: 'a transferência não terminou'
}

export function otaErrorMessage(code: string | undefined): string {
  return (code && UPLOAD_ERRORS[code]) || code || 'erro desconhecido'
}

/** Manda o app pra placa. `onProgress` vai de 0 a 100 (envio pela rede). */
export function uploadFirmware(app: Uint8Array, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    // XMLHttpRequest e não fetch: só ele informa o progresso do envio.
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/update')
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      let body: { ok?: boolean; error?: string } = {}
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        // resposta fora do formato - trata pelo status
      }
      if (xhr.status === 200 && body.ok) resolve()
      else reject(new Error(otaErrorMessage(body.error)))
    }
    xhr.onerror = () => reject(new Error('a conexão com o módulo caiu durante o envio'))
    // Cópia num ArrayBuffer próprio (o subarray aponta pro arquivo inteiro).
    xhr.send(app.slice().buffer)
  })
}
