// Busca/baixa releases de firmware do GitHub (tag "fw-v*") no processo
// main, nao no renderer - fetch() aqui e' Node puro, sem enforcement de
// CORS. A listagem de releases (api.github.com) ate' manda
// Access-Control-Allow-Origin: * e funcionaria direto do renderer, mas os
// links de asset (browser_download_url) redirecionam pra
// release-assets.githubusercontent.com, que NAO manda esse header - um
// fetch direto do renderer falha com erro de CORS. Ver
// desktop-app/src/renderer/src/components/FirmwareManager.tsx.

const GITHUB_REPO = 'orodamaral/drumcore'

export interface FirmwareManifest {
  version: string
  chip: string
  flash_size: string
  flash_mode: string
  offset: string
  file: string
}

export interface LatestFirmware {
  manifest: FirmwareManifest
  downloadUrl: string
}

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
}

interface GithubRelease {
  tag_name: string
  assets: GithubReleaseAsset[]
}

// A aba Firmware busca de novo toda vez que o usuario troca de aba (o
// componente remonta) - sem cache, isso pode facilmente estourar o limite
// de requisicoes sem autenticacao da API do GitHub (60/hora por IP, bem
// baixo) so' de alternar entre abas algumas vezes. Cache simples em
// memoria do processo main, valido por alguns minutos.
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
  const firmwareReleases = releases
    .filter((release) => release.tag_name.startsWith('fw-v'))
    .sort((a, b) => (a.tag_name < b.tag_name ? 1 : -1))
  const latest = firmwareReleases[0]
  if (!latest) throw new Error('Nenhuma release de firmware encontrada no GitHub ainda.')

  const manifestAsset = latest.assets.find((asset) => asset.name === 'manifest.json')
  const binAsset = latest.assets.find((asset) => asset.name.endsWith('.bin'))
  if (!manifestAsset || !binAsset) {
    throw new Error('Release encontrada, mas faltam os arquivos esperados (manifest.json / .bin).')
  }

  const manifestRes = await githubFetch(manifestAsset.browser_download_url)
  const manifest = (await manifestRes.json()) as FirmwareManifest

  const result: LatestFirmware = { manifest, downloadUrl: binAsset.browser_download_url }
  cache = { result, fetchedAt: Date.now() }
  return result
}

export async function downloadFirmwareBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar o firmware (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}
