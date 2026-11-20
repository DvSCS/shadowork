# Fontes e verificação real — versão 1.3

Verificado em 20/11/2026 a partir do ambiente de desenvolvimento, sem conta ou chave de API para a fonte principal.

| Título consultado | ID | Opções EN | Opções PT-BR | Primeiro arquivo EN/PT-BR baixado e analisado |
| --- | --- | ---: | ---: | --- |
| Harry Potter 1 | tt0241527 | 73 | 38 | Sim: 1.230 / 1.335 falas |
| Harry Potter 2 | tt0295297 | 84 | 67 | Sim: 1.509 / 1.440 falas |
| Breaking Bad S01E01 | tt0903747:1:1 | 16 | 14 | Sim: 813 / 559 falas |

Fonte principal: `rest.opensubtitles.org`, consultada diretamente com filtros de idioma. A busca preserva temporada e episódio, inclui português brasileiro e europeu, e considera o nome da versão do vídeo quando fornecido pelo player.

O pipeline master completo, incluindo agregação, seleção, download e combinação EN/PT, também foi executado com dados reais:

- Harry Potter 1: 12 faixas de estudo oferecidas; SRT bilíngue gerado com 1.230 eventos e 150.044 bytes.
- Breaking Bad S01E01: 12 faixas de estudo oferecidas; SRT bilíngue gerado com 589 eventos e 65.331 bytes.

As diferenças de contagem entre versões de uma legenda são esperadas: elas podem ter divisões de fala distintas. O teste de geração seleciona e classifica versões, portanto não necessariamente escolhe o primeiro arquivo do teste inicial de download.

Alternativas:

- OpenSubtitles v3 oficial: alcançável, mas devolveu uma lista incompleta para Harry Potter 1; agora é alternativa, não a única fonte.
- Wyzie: a documentação descreve uma API agregadora e o endpoint respondeu exigindo uma chave. O adaptador foi implementado, mas não houve busca autenticada porque não foi fornecida uma chave. Não foi criada conta nem contratado plano.
- Manifestos adicionais: aceitos em `SUBTITLE_ADDON_URLS`, separados por vírgula; configurados pelo dono da instalação.

A geração e a leitura dos arquivos foram verificadas. Não foi validada a sincronia assistindo a cada versão do vídeo dentro do Stremio/Nuvio, nem realizado deploy na conta Vercel do usuário. Resultados e disponibilidade do serviço podem mudar.

Referências primárias: [provedor REST documentado no SubSense](https://github.com/NepiRaw/Stremio-SubSense/blob/main/src/providers/OpenSubtitlesProvider.js), [API Wyzie](https://docs.wyzie.io/subs/usage/direct), [catálogo oficial de addons Stremio](https://github.com/Stremio/stremio-official-addons/blob/master/index.json).
