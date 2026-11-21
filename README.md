# SceneLingo automático para Vercel

Porte da versão local para **Vercel Functions com Node.js 24**, frontend estático e **Upstash Redis via HTTPS**. A extensão Chrome/Edge continua incluída em `extension/`.


## Correção 1.4.1 para Stremio

O addon automático público funciona com as credenciais Redis já configuradas, mesmo sem `ADMIN_TOKEN`. A administração continua exigindo `ADMIN_TOKEN`. Os links usam uma chave derivada do token privado do banco; o token nunca é devolvido ao player. Também é possível definir `ADDON_SECRET` com pelo menos 32 caracteres. Trocar o segredo invalida links antigos; reabra a reprodução.

As variantes agora têm nomes curtos (`SL 1 · Atraso EN→PT`, `SL 1 · Dupla EN + PT`, `SL 1 · Progressiva`) no campo oficial `label`. Os links das faixas também são curtos e guardam os dados temporários no Redis, evitando o erro `loading failed` causado por URLs extensas em players nativos. A tradução é corrigida automaticamente contra os tempos do release inglês, inclusive atraso fixo e a deriva comum entre 23.976/25 fps. No seletor de idiomas, os modos bilíngues ficam em Português e o modo somente inglês fica em English.

## Instalação única: legendas automáticas

Depois do deploy, instale **apenas uma vez** este endereço no Stremio/Nuvio:

```text
https://SEU-DOMINIO.vercel.app/manifest.json
```

Ao abrir um filme ou episódio, o player solicita o ID e os metadados ao addon. O SceneLingo consulta a fonte, procura inglês/português e oferece as faixas de estudo automaticamente. Não é necessário cadastrar o título, importar SRT ou visitar o estúdio a cada episódio. Selecione a faixa SceneLingo no player; a escolha automática da faixa padrão pertence às configurações do próprio player.

A busca consulta o agregador público SubSense (EN, PT-BR e PT-PT), o catálogo OpenSubtitles direto e o addon oficial OpenSubtitles v3 em paralelo. Isso evita depender do endpoint Legacy, que pode bloquear IPs da Vercel. Para usar seu addon de legendas preferido, configure `SUBTITLE_ADDON_URL` uma vez nas variáveis da Vercel. A disponibilidade não é garantida: se nenhuma fonte retornar inglês, o addon não inventa uma faixa. Os hashes, tamanhos, nomes e metadados recebidos do player são encaminhados às fontes; quando há hash OpenSubtitles exato, ele recebe prioridade máxima.

As buscas são armazenadas em cache Redis por uma hora; legendas EN/PT combinadas pelo tempo ficam em cache por sete dias. Se um download falhar, o addon tenta até duas alternativas automaticamente. Versões diferentes podem exigir ajuste de sincronia; são oferecidas até três opções da fonte. Falha do cache não impede o download da legenda.

### Configuração global opcional

- `AUTO_MODE=delayed`: faixa preferencial oferecida primeiro. Alternativas: `progressive`, `bilingual`, `english`.
- `AUTO_TRANSLATION_DELAY=1000`: tempo antes de revelar português, em milissegundos.
- `AUTO_SHOW_ORIGINAL=true`: manter inglês como apoio na progressiva.
- `AUTO_SUBTITLE_OFFSET=0`: ajuste global de sincronia, em milissegundos.

**Distinção importante:** esta versão automatiza a obtenção das legendas existentes. Um SRT comum não contém correspondência entre palavras em inglês e português. Por isso a faixa automática progressiva usa frases inteiras. O efeito exato palavra por palavra continua dependendo de alinhamentos de tradução; não foi substituído por uma divisão arbitrária da frase. Shadowing com controle de pausa/loop continua no estúdio ou na extensão; o protocolo nativo não oferece esses comandos ao addon.

Consulta real realizada com a fonte principal: Harry Potter 1 retornou 73 opções em inglês e 38 em PT-BR; Harry Potter 2 retornou 84 e 67; Breaking Bad S01E01 retornou 16 e 14. Um arquivo de cada idioma foi baixado e analisado nos três casos. O pipeline master gerou SRT bilíngue automaticamente para Harry Potter 1 e Breaking Bad S01E01. A sincronia com uma versão específica do vídeo não foi verificada assistindo ao filme.

## Fontes master

A versão 1.3 consulta as fontes em paralelo, remove URLs duplicadas, prioriza PT-BR e considera o nome da versão do vídeo e a popularidade da legenda.

- **Principal, já integrada sem chave:** OpenSubtitles REST direto. Testada com download real de EN/PT-BR nos títulos acima.
- **Alternativa padrão:** OpenSubtitles v3 oficial.
- **Outros addons:** `SUBTITLE_ADDON_URLS` aceita manifestos adicionais separados por vírgula. `SUBTITLE_ADDON_URL` define uma alternativa preferencial.
- **Agregador opcional:** `WYZIE_API_KEY` ativa a API Wyzie, que reúne outros provedores conforme o plano da chave. Não é necessário para os casos testados. Nenhuma conta, chave ou assinatura foi criada automaticamente.

A API Wyzie requer chave e pode cobrar por fontes/consultas conforme o plano; por isso a integração é opcional. Referências: [documentação Wyzie](https://docs.wyzie.io/subs/usage/direct), [implementação independente do provedor REST no SubSense](https://github.com/NepiRaw/Stremio-SubSense/blob/main/src/providers/OpenSubtitlesProvider.js).

## Publicar

1. Extraia o ZIP e envie o conteúdo de `SceneLingo-vercel` para um repositório Git seu.
2. Na Vercel, use **Add New → Project** e importe esse repositório.
3. Se o projeto estiver dentro de outro repositório, selecione **SceneLingo-vercel** como **Root Directory**. O arquivo `vercel.json` precisa estar nessa raiz.
4. Use **Framework Preset: Other**. A configuração entregue já define:
   - Build Command: `node scripts/build.js`
   - Output Directory: `public`
   - Node.js: `24.x`
5. Adicione um banco **Upstash Redis** pela integração de Storage/Marketplace da Vercel, ou use um banco que você já tenha.
6. Configure as variáveis abaixo em **Settings → Environment Variables** e faça o deploy/redeploy.

| Variável | Valor |
| --- | --- |
| `ADMIN_TOKEN` | Chave aleatória de pelo menos 32 caracteres; usada para entrar no estúdio. |
| `UPSTASH_REDIS_REST_URL` | REST URL HTTPS do banco Upstash. |
| `UPSTASH_REDIS_REST_TOKEN` | REST token do mesmo banco, com acesso de escrita. |
| `BASE_URL` | Opcional: domínio estável, como `https://scenelingo.seudominio.com`. |
| `REDIS_PREFIX` | Opcional: prefixo exclusivo, como `scenelingo-producao`. |

As integrações que usam `KV_REST_API_URL` e `KV_REST_API_TOKEN` também são reconhecidas. Use um par completo do mesmo banco. Não use o token somente leitura.

Gere sua chave de administração localmente, por exemplo:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarde a chave e digite-a na tela de entrada do estúdio. O navegador recebe um cookie HttpOnly, Secure na Vercel e SameSite=Strict; a chave não é armazenada no localStorage nem publicada no frontend.

**Sem as variáveis**, o site abre a demonstração autoral em modo de leitura. As preferências dessa demonstração são temporárias. Para importar e salvar suas próprias sessões, configure administração e Redis. Se o banco configurado ficar indisponível, o programa informa o erro em vez de salvar em memória temporária.

Esta é uma instalação pessoal com uma chave de administração compartilhada, não uma plataforma com contas e bibliotecas separadas para vários usuários.

## Modo avançado: sessões importadas manualmente

1. Entre no seu site Vercel usando a chave.
2. Importe uma sessão JSON SceneLingo ou suas legendas EN/PT em SRT/VTT.
3. Em **Conectar aos players**, informe o ID correto: filme `tt0133093`, episódio `tt0903747:1:1`.
4. Copie o manifesto e adicione ao Stremio/Nuvio.

O manifesto terá o formato:

```text
https://seu-site.vercel.app/a/IDENTIFICADOR-DA-SESSAO/manifest.json
```

O addon permite leitura sem cookie de login, para funcionar nos players. A administração exige autenticação. O identificador aleatório do manifesto dá acesso às legendas daquela sessão: compartilhe o endereço somente com quem deve acessá-las.

**Deployment Protection:** a implantação de produção precisa permitir acesso público às rotas `/a/` e ao logo `/assets/logo.svg`. Um bloqueio de login da própria Vercel acontece antes da função e impede o player de buscar as legendas. Use um domínio de produção acessível publicamente; o estúdio já possui sua própria autenticação. Não coloque tokens de bypass da Vercel no manifesto.

Use um domínio estável em `BASE_URL` para manter os manifestos válidos entre deploys. Se não definir essa variável, os links usam o domínio HTTPS da requisição. Configure produção e preview com bancos/prefixos separados; em previews, deixe `BASE_URL` vazio ou use o domínio daquele ambiente.

## O que mudou em relação à versão local

- Uma função `api/index.js` atende API e addon; não inicia um servidor com `listen()` na Vercel.
- Sessões e metadados ficam no Redis, com gravações atômicas e controle de revisão para evitar que outra aba sobrescreva alterações antigas.
- A listagem carrega somente metadados; as falas são buscadas ao abrir a sessão. Isso evita uma resposta enorme com todas as legendas.
- Seleções de provedores usam tickets cifrados com validade de 15 minutos. Não dependem da memória de uma instância da função e não revelam URLs com configurações do provedor.
- Respostas privadas não são armazenadas no CDN. Rotas do addon têm CORS de leitura para os players.
- A função tem duração máxima configurada em 60 segundos. Chamadas ao tradutor são interrompidas após 45 segundos.
- Sessões são limitadas a 3 MB; requisições a 3,5 MB e respostas a 4 MB, abaixo do limite de payload documentado pela Vercel. Divida legendas maiores em trechos.
- A demonstração é sempre original e não pode ser substituída permanentemente por edições de visitantes.

Continuam disponíveis os sete modos de legenda, shadowing, eco, escada, gravação, vocabulário, revisão espaçada e exportação Anki. Os limites dos players nativos continuam: o addon entrega legendas; controles de loop e gravação funcionam no estúdio ou na extensão sobre vídeo HTML5.

## Tradução e fontes de legenda

Variáveis opcionais:

```dotenv
LIBRETRANSLATE_URL=https://sua-instancia
LIBRETRANSLATE_KEY=
OLLAMA_URL=https://seu-endpoint-remoto
OLLAMA_MODEL=nome-do-modelo
OLLAMA_API_KEY=
SUBTITLE_ADDON_URL=https://seu-addon/configuracao/manifest.json
```

**`localhost` na Vercel não aponta para seu computador.** Para Ollama, use um endpoint remoto protegido e acessível pela função. A chave opcional é enviada como Bearer somente para o endpoint Ollama configurado. Para LibreTranslate, informe a URL base sem `/translate` no final.

Na tela de integrações, você pode traduzir falas sem português, alinhar traduções existentes usando Ollama ou importar legendas de um addon que já utilize. Chamadas só acontecem quando solicitadas por um administrador autenticado. Nenhuma credencial aparece no manifesto ou na sessão exportada. As traduções e os alinhamentos precisam de revisão.

## Migrar suas sessões existentes

1. No estúdio local anterior, exporte cada sessão em JSON pela aba de integrações.
2. No site Vercel, entre e importe o JSON em **Importar sessão**.
3. Copie o novo manifesto e instale-o no player; o endereço antigo local continua pertencendo à instalação anterior.
4. Para vocabulário/progresso, exporte o backup no navegador antigo e restaure no site novo.

Vocabulário e progresso continuam no armazenamento do navegador por origem. Vídeos e gravações ficam no dispositivo; as legendas e configurações das sessões importadas são enviadas ao Redis. A coleção da extensão é separada do estúdio.

## Testar localmente

Requer Node.js 24. Não há dependências de produção.

```sh
node scripts/build.js
node --test
node server/dev.js
```

Abra `http://127.0.0.1:7778`. Para persistência real local, copie `.env.example` para `.env.local` e preencha suas credenciais de teste. O modo de desenvolvimento usa o mesmo handler da Vercel e um cookie sem Secure, necessário para HTTP local.

O build copia `shared/` para `public/shared/`. Os arquivos de servidor não são publicados como arquivos estáticos. A configuração usa a pasta oficial `api/`, sem adaptadores ou bibliotecas adicionais.

## Verificação

Foram verificados: motor de legendas, proteção da administração, cookies, limite de login, CSRF, CRUD entre instâncias simuladas, revisões concorrentes, rotas reescritas, IDs de episódio, tickets cifrados e payload pré-processado pela Vercel. No navegador: login/logout, importação, salvamentos sequenciais, recarregamento, manifesto sem cookie e layout móvel.

O banco nos testes de integração foi simulado por um endpoint REST de teste. Não foi realizado deploy em conta Vercel nem teste contra um banco Upstash real: essas credenciais não estavam disponíveis nesta sessão. A verificação de produção deve ser feita depois de conectar sua conta e configurar as variáveis.

Após publicar, confira `/api/health`, faça login, importe uma sessão pequena, recarregue a página e abra o manifesto em uma janela anônima. A saúde informa se as variáveis estão presentes; não atesta conectividade do banco por si só.

## Referências oficiais

- [Vercel: runtime Node.js e request.body](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel: configuração de build](https://vercel.com/docs/builds/configure-a-build)
- [Vercel: configuração JSON e rewrites](https://vercel.com/docs/project-configuration/vercel-json)
- [Vercel: limites de funções](https://vercel.com/docs/functions/limitations)
- [Upstash: API REST](https://upstash.com/docs/redis/features/restapi)
- [Upstash: operações atômicas com Lua sobre HTTP](https://upstash.com/blog/lua-scripting-on-upstash-redis-atomic-operations-over-http)

Pesquisa pedagógica original: [docs/PESQUISA.md](docs/PESQUISA.md). Licença MIT.
