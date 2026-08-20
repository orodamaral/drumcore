# Interface Desktop de Configuração

Aplicação desktop para configuração do módulo HelloDrum (sensibilidade,
threshold, curva, nota MIDI por pad). Comunica com o módulo via porta serial
USB-CDC usando um protocolo NDJSON — ver
[docs/04-protocolo-serial.md](../docs/04-protocolo-serial.md) pro contrato
completo, e
[docs/01-decisoes-arquiteturais.md](../docs/01-decisoes-arquiteturais.md) pro
racional das escolhas abaixo.

**Stack**: Electron + React + TypeScript, com `electron-vite` como build tool.

## Estrutura

```
desktop-app/
├── src/
│   ├── main/        Processo principal do Electron (abre a porta serial via
│   │                 a lib `serialport`, repassa mensagens pro renderer via IPC)
│   ├── preload/      Ponte seguro (contextBridge) entre main e renderer
│   └── renderer/     App React (UI de configuração)
│       └── src/
│           ├── protocol.ts      Tipos do protocolo NDJSON (espelha docs/04)
│           ├── mockDevice.ts    Simulador do módulo p/ "modo demo" (sem hardware)
│           ├── App.tsx          Tela principal (conexão, grid de pads, editor)
│           └── components/      PadGrid, PadEditor
```

## Como rodar

```bash
cd desktop-app
npm install
npm run dev        # abre a janela do Electron em modo desenvolvimento
```

Sem o módulo físico conectado ainda, marque **"Modo demo"** na barra
superior antes de clicar em Conectar — a UI passa a ser alimentada por um
simulador em memória (`mockDevice.ts`), com hits aleatórios periódicos, pra
validar a interface sem precisar do hardware.

Outros comandos:
- `npm run build` — build de produção (main + preload + renderer, saída em `out/`).
- `npm run typecheck` — checagem de tipos (main/preload e renderer, tsconfigs separados).

## Status

Fase E do projeto (protocolo serial NDJSON) implementada nos dois lados —
firmware (`firmware/src/main.cpp`) e aqui. Build e typecheck validados.
**Nunca testado com o módulo real** (sem hardware montado ainda) — só o modo
demo foi exercitado até agora.

Falta:
- Empacotamento pra distribuição (ex: `electron-builder`) — só builda pra
  `out/` por enquanto, não gera instalador/executável único.
- Persistir a última porta serial usada (hoje sempre pede pra selecionar de novo).
- Backup/restore de configuração (exportar/importar todos os 32 pads como
  arquivo).
