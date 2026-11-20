# Pesquisa e decisões de aprendizagem

Consulta realizada em 20 de novembro de 2026. Foram priorizados artigos de pesquisa, revisões sistemáticas, documentação oficial do protocolo e repositórios dos clientes.

## Legendas na língua estudada

[Kurokawa, Hein e Uchihara — Incidental Vocabulary Acquisition Through Captioned Viewing: A Meta-Analysis](https://onlinelibrary.wiley.com/doi/full/10.1111/lang.12697) sintetiza 49 estudos primários e encontra benefício médio de legendas em L2 para aprendizagem incidental de vocabulário. Isso apoia oferecer inglês como referência e disponibilizar passagens sem tradução. Não estabelece uma quantidade universal de repetições nem valida a transformação progressiva EN→PT.

[Reynolds et al. (2022) — Vocabulary Acquisition through Viewing Captioned and Subtitled Video](https://discovery.ucl.ac.uk/id/eprint/10155145/) reúne pesquisa sobre vídeo legendado e vocabulário. A decisão de guardar expressões junto da fala e do contexto busca preservar as associações entre som, forma escrita e significado. O produto não promete fluência por assistir passivamente.

## Shadowing e percepção da fala

[El Moussaoui (2025) — Shadowing for Developing EFL Learners’ Bottom-up Listening Skills](https://www.ijlls.org/index.php/ijlls/article/view/2260) revisa estudos sobre percepção de sons, segmentação e reconhecimento de palavras. O conjunto sugere utilidade particularmente para dificuldades de decodificação, com benefícios variáveis entre níveis e tarefas.

[A Systematic Review of Research on the use of Shadowing for Second Language Pronunciation Teaching (2025)](https://doi.org/10.1080/29984475.2025.2546827) discute potencial para pronúncia e limitações metodológicas, incluindo a escassez de trabalhos sobre certos aspectos segmentais. A leitura do texto completo do editor não estava disponível na consulta; foram consideradas apenas as informações de resumo acessíveis.

Decisão de produto: oferecer shadowing simultâneo, eco com pausa e gravação para comparação auditiva. A gravação não recebe uma pontuação fictícia. Correspondência de transcrição, quando calculada pelo motor, representa apenas texto e não uma avaliação de pronúncia; ela não é apresentada como nota ao aluno.

## Recuperação e espaçamento

[Nakata (2015) — Effects of Expanding and Equal Spacing on Second Language Vocabulary Learning](https://doi.org/10.1017/S0272263114000825) compara diferentes distribuições de prática. Os resultados favorecem introduzir espaçamento e mostram que diferenças entre calendários específicos exigem cuidado. [Nakata (2017) — Does Repeated Practice Make Perfect?](https://doi.org/10.1017/S0272263116000280) investiga recuperação repetida de vocabulário.

Decisão de produto: o aluno precisa tentar lembrar antes de revelar o verso; a avaliação ajusta o próximo encontro com cada expressão. Os intervalos do programa são uma heurística simples de implementação. Não são um calendário ideal demonstrado pelos artigos e não reproduzem o FSRS.

## Legenda progressiva: experimento explícito

A transformação “Work → Trabalha at → Trabalha em a” é uma proposta do usuário. Não foi identificada evidência direta de que esse mecanismo específico supere legendas convencionais. Por isso o produto permite trocar de método, retirar apoio e ocultar traduções de palavras conhecidas.

A correspondência entre idiomas não é necessariamente monotônica nem individual. Se uma tradução reorganiza uma oração, o bloco precisa abranger a oração inteira. Expressões idiomáticas não devem ser fragmentadas em traduções isoladas. Sem alinhamento validado, o programa conserva a frase como unidade.

## Limites técnicos verificados

- [Stremio Addon Protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md): manifesto, recursos e rotas HTTP. O recurso `player` recebe eventos; as respostas não comandam a reprodução.
- [Objeto subtitles](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/subtitles.md): cada opção fornece ID, idioma e URL de legenda. Rótulos personalizados de idioma são permitidos pelo protocolo.
- [Nuvio TV oficial](https://github.com/NuvioMedia/NuvioTV): cliente independente e código público. As versões e renderizadores variam; o projeto não assume injeção universal de interface no app.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): acesso temporário à aba após ação do usuário, usado para reduzir as permissões permanentes da extensão.
- [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder): gravação de voz pelo navegador, conforme suporte e permissão.
- [Ollama Chat API](https://docs.ollama.com/api/chat): tradução/alinhamento opcional com resposta JSON e validação posterior.
- [LibreTranslate API](https://docs.libretranslate.com/api/operations/translate/): tradução de frases em lote, sem associação palavra a palavra.
- [Anki — importação de texto](https://docs.ankiweb.net/importing/text-files.html): campos separados por tabulação e arquivos UTF-8 para exportar a coleção.

## Validação e próximos limites

Os testes verificam a lógica de legendas, SRT/VTT, alinhamentos, revisões, endpoints, perfis, correspondência exata de episódio, CORS de leitura e persistência. A extensão foi carregada sem erros no Edge e exercitada em vídeo HTML5 local. A gravação foi verificada com microfone simulado, não com uma avaliação acústica humana.

Integração com os aplicativos nativos e TVs, serviços de tradução externos reais e provedores de legenda contratados dependem do ambiente do usuário e não foram verificados ponta a ponta. O produto informa quando há tempos estimados, frases sem alinhamento ou um provedor não configurado.
