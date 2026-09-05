// Busca/baixa a release de firmware mais recente (tag "fw-v*") direto do
// renderer - funciona tanto no build Electron quanto numa pagina web pura
// (web-app/), sem precisar de nenhum processo Node/main como
// intermediario. Os arquivos (manifest.json + binario mesclado) sao lidos
// via raw.githubusercontent.com, que manda Access-Control-Allow-Origin: *
// pra qualquer arquivo do repo - diferente dos assets de Release
// (browser_download_url), que redirecionam pra
// release-assets.githubusercontent.com e NAO liberam CORS. A CI de
// release do firmware publica os mesmos arquivos num branch dedicado
// (firmware-artifacts/<tag>/...) so' pra isso - ver
// .github/workflows/firmware-release.yml.

const GITHUB_REPO = 'orodamaral/drumcore'
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/firmware-artifacts`

export interface FirmwareManifest {
  version: string
  chip: string
  flash_size: string
  flash_mode: string
  flash_freq: string
  offset: string
  file: string
}

export interface LatestFirmware {
  manifest: FirmwareManifest
  downloadUrl: string
}

interface GithubRelease {
  tag_name: string
}

// A aba Firmware busca de novo toda vez que o usuario troca de aba (o
// componente remonta) - sem cache, isso pode facilmente estourar o limite
// de requisicoes sem autenticacao da API do GitHub (60/hora por IP, bem
// baixo) so' de alternar entre abas algumas vezes.
const CACHE_TTL_MS = 5 * 60 * 1000
let cache: { result: LatestFirmware; fetchedAt: number } | null = null

async function githubFetch(url: string): Promise<Response> {
  const res = await fetch(url)
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const resetHeader = res.headers.get('x-ratelimit-reset')
    const resetAt = resetHeader
      ? new Date(Number(resetHeader) * 1000).toLocaleTimeString('pt-BR')
      : 'em alguns minutos'
    throw new Error(
      `Limite de requisições sem login da API do GitHub atingido (60/hora por IP) - tenta de novo depois de ${resetAt}.`
    )
  }
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`)
  return res
}

export async function getLatestFirmware(): Promise<LatestFirmware> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.result
  }

  const res = await githubFetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`)
  const releases = (await res.json()) as GithubRelease[]

  // Tags de firmware ("fw-v*") ordenam certo por string porque seguem
  // sempre o mesmo formato fw-vMAJOR.MINOR.PATCH com mesma contagem de
  // digitos na pratica deste projeto - se isso mudar, trocar por
  // comparacao semver de verdade.
  const tag = releases
    .map((release) => release.tag_name)
    .filter((tagName) => tagName.startsWith('fw-v'))
    .sort((a, b) => (a < b ? 1 : -1))[0]
  if (!tag) throw new Error('Nenhuma release de firmware encontrada no GitHub ainda.')

  const manifestRes = await githubFetch(`${RAW_BASE}/${tag}/manifest.json`)
  const manifest = (await manifestRes.json()) as FirmwareManifest

  const result: LatestFirmware = { manifest, downloadUrl: `${RAW_BASE}/${tag}/${manifest.file}` }
  cache = { result, fetchedAt: Date.now() }
  return result
}

export async function downloadFirmwareBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar o firmware (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}
