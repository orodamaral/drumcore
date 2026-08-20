# Interface Desktop de Configuração

Aplicação desktop para configuração do módulo HelloDrum (sensibilidade,
threshold, curva, mapeamento de notas MIDI por pad, backup/restore de
configuração).

**Stack**: a definir. Deve ser decidido considerando: comunicação com o módulo
(provavelmente via porta serial/USB, já que o módulo também expõe USB-MIDI —
avaliar se a config trafega por SysEx MIDI ou por uma porta serial CDC
separada), e requisito de rodar em Windows (ambiente principal de
desenvolvimento).

Ver [docs/01-decisoes-arquiteturais.md](../docs/01-decisoes-arquiteturais.md)
quando a stack for escolhida.
