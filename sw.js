// Service worker: o que faz o app abrir sem internet.
// design/01-visao.md princípio 7 — a sincronização é conveniência, não dependência.

const CACHE = 'appfinancas-v107';

const CASCA = [
  './',
  'index.html',
  'app.html',
  'inicio.html',
  'lancamentos.html',
  'contas.html',
  'cartoes.html',
  'renda.html',
  'investimentos.html',
  'dividas.html',
  'planejamento.html',
  'configuracoes.html',
  'bancada.html',
  'extrato.html',
  'verificacao.html',
  'ajustes.html',
  'manifest.webmanifest',
  'icones/icone.svg',
  'icones/icone-192.png',
  'icones/icone-512.png',
  'icones/icone-maskable-512.png',
  'icones/apple-touch-icon.png',
  'css/base.css',
  'css/captura.css',
  'css/formulario.css',
  'css/dinheiro.css',
  'css/bancada.css',
  'css/ajustes.css',
  'js/captura.js',
  'js/dinheiro.js',
  'js/gestao.js',
  'js/app/pagina.js',
  'js/app/rotas.js',
  'js/app/marcacao-dinheiro.js',
  'js/app/marcacao-gestao.js',
  'js/ajustes.js',
  'js/main.js',
  'js/core/lancamentos.js',
  'js/core/mes-da-conta.js',
  'js/core/explorar.js',
  'js/core/listas.js',
  'js/core/cripto.js',
  'js/core/github.js',
  'js/core/sincronia.js',
  'js/app/formulario.js',
  'js/app/transferencia.js',
  'js/app/campo-valor.js',
  'js/app/zona-perigo.js',
  'js/app/instalar.js',
  'js/app/sincronia-viva.js',
  'js/app/dinheiro-html.js',
  'js/app/areas.js',
  'js/app/fila.js',
  'js/app/devolucao.js',
  'js/app/conferencia.js',
  'js/core/pendencias.js',
  'js/recorrencias.js',
  'js/app/holerite.js',
  'js/core/holerite.js',
  'js/core/divida.js',
  'js/core/contrato.js',
  'js/core/parcelas.js',
  'js/app/contrato.js',
  'js/app/ocorrencia.js',
  'js/app/ativo.js',
  'js/core/investimentos.js',
  'js/core/envelopes.js',
  'js/app/envelope.js',
  'js/app/envelope-uso.js',
  'js/envelopes.js',
  'js/relatorios.js',
  'js/core/automaticas.js',
  'js/app/automaticas.js',
  'js/core/importar.js',
  'js/app/importar.js',
  'js/regras.js',
  'js/core/relatorios.js',
  'js/app/grafico.js',
  'js/app/graficos.js',
  'js/core/db.js',
  'js/core/dinheiro.js',
  'js/core/estado.js',
  'js/core/formato.js',
  'js/core/id.js',
  'js/core/log.js',
  'js/core/redutores.js',
  'js/core/datas.js',
  'js/core/cartao.js',
  'js/core/previsto.js',
  'js/core/cofrinho.js',
  'js/core/cotacoes.js',
  'js/core/repasse.js',
  'js/core/ordem.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // Um arquivo faltando não pode derrubar a instalação inteira: o app
      // funcionaria do mesmo jeito, só não ficaria offline. addAll é tudo-ou-nada,
      // então cada item vai por conta própria.
      await Promise.all(
        CASCA.map((url) =>
          fetch(url, { cache: 'no-store' })
            .then((r) => (r.ok ? c.put(url, r) : undefined))
            .catch(() => undefined)
        )
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // a API do GitHub nunca é cacheada

  // Rede primeiro, cache como rede de segurança: assim uma versão nova do app
  // chega sem o usuário ter que limpar nada, e offline continua funcionando.
  //
  // `cache: 'no-store'` não é detalhe: sem ele a busca cai no cache HTTP do
  // navegador e o "rede primeiro" vira "versão velha primeiro" — o app
  // publicaria uma correção e ninguém a receberia.
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return resposta;
      })
      .catch(async () => {
        const guardado = await caches.match(req);
        if (guardado) return guardado;

        // Só navegação cai de volta no index. Devolver HTML no lugar de um
        // módulo JS seria pior que falhar: o navegador tentaria executar a
        // página como código, e o erro resultante não diria nada a ninguém.
        if (req.mode === 'navigate') {
          const inicio = await caches.match('index.html');
          if (inicio) return inicio;
        }
        return new Response('', { status: 504, statusText: 'offline e sem cópia local' });
      })
  );
});
