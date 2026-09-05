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

export async function getLatestFirmware(): Promise<LatestFirmware> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`)
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`)
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

  const manifestRes = await fetch(manifestAsset.browser_download_url)
  if (!manifestRes.ok) throw new Error(`Falha ao baixar manifest.json (${manifestRes.status})`)
  const manifest = (await manifestRes.json()) as FirmwareManifest

  return { manifest, downloadUrl: binAsset.browser_download_url }
}

export async function downloadFirmwareBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar o firmware (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}
