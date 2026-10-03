// true quando o app foi aberto a partir da própria placa (Wi-Fi, Fase AE):
// o firmware serve o index.html com <meta name="drumcore-hosted"> (ver
// firmware/embed_webapp.py). Nesse caso a conexão é por WebSocket com a
// placa, não por Web Serial, e as partes que só fazem sentido no site
// (links do site, aba Firmware) ficam escondidas.
export const DEVICE_HOSTED = document.querySelector('meta[name="drumcore-hosted"]') !== null
