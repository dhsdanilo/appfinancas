// As rotas do andar de cima: uma página só, e o endereço diz a tela
// (app.html#/contas). Trocar de tela troca o miolo; o menu nunca some, e o que
// se escolheu numa tela (período, filtros) continua lá na volta.
//
// Por que uma página só (decidido 03/10/2026): o recarregamento entre telas
// "piscava", e o PIN do andar de cima (D11) precisa valer uma vez por sessão,
// não uma vez por tela.

const TELAS = {
  inicio: { grupo: 'dinheiro', titulo: 'Início', sub: 'Como estamos agora.' },
  lancamentos: { grupo: 'dinheiro', titulo: 'Lançamentos', sub: 'Tudo o que entrou e saiu, num lugar só.' },
  contas: { grupo: 'dinheiro', titulo: 'Contas', sub: 'Corrente e espécie: o dinheiro que se usa.' },
  cartoes: { grupo: 'dinheiro', titulo: 'Cartões', sub: 'Faturas, limites e o que já tem dono.' },
  renda: { grupo: 'dinheiro', titulo: 'Renda', sub: 'Cada fonte de renda e o seu contracheque.' },
  investimentos: { grupo: 'dinheiro', titulo: 'Investimentos', sub: 'O que está guardado e quanto rende.' },
  dividas: { grupo: 'dinheiro', titulo: 'Dívidas', sub: 'Cada empréstimo, o que falta e quanto custa.' },
  envelopes: { grupo: 'envelopes', titulo: 'Envelopes', sub: 'O dinheiro guardado, e de quem ele é.' },
  relatorios: { grupo: 'relatorios', titulo: 'Relatórios', sub: 'Em que foi, quando aperta, para onde vai e se estamos melhorando.' },
  planejamento: { grupo: 'planejamento', titulo: 'Planejamento', sub: 'O que volta todo mês, e o que muda de valor.' },
  configuracoes: {
    grupo: 'configuracoes',
    titulo: 'Configurações',
    sub: 'Categorias, etiquetas, descrições e a sincronização entre os aparelhos.',
  },
};

export const TELA_INICIAL = 'inicio';

/** '#/configuracoes/sincronizacao' → { tela: 'configuracoes', sub: 'sincronizacao' } */
export function lerRota(hash = location.hash) {
  // Âncora comum (#gestao) não é rota: o navegador só rola até ela.
  if (hash && !hash.startsWith('#/')) return null;
  const [tela, sub] = hash.replace(/^#\/?/, '').split('/');
  return { tela: TELAS[tela] ? tela : TELA_INICIAL, sub: sub || null };
}

export const enderecoDa = (tela, sub = null) => `app.html#/${tela}${sub ? `/${sub}` : ''}`;

/**
 * Liga as rotas. A cada troca, a página ganha `data-pagina`, o cabeçalho troca
 * de título, só o grupo da tela fica à vista, e quem se importa ouve o evento
 * `app:tela` — { tela, sub, grupo } — para se pintar.
 */
export function iniciarRotas() {
  let atual = null;

  function ir() {
    const rota = lerRota();
    if (!rota) return;
    const def = TELAS[rota.tela];
    const mudouDeTela = atual !== rota.tela;
    atual = rota.tela;

    document.body.dataset.pagina = rota.tela;
    // A cor da área é a tela que diz; trocar de tela começa sem cor.
    delete document.body.dataset.area;
    document.getElementById('titulo-tela').textContent = def.titulo;
    document.getElementById('sub-tela').textContent = def.sub;
    document.title = `${def.titulo} — App Finanças`;
    for (const grupo of document.querySelectorAll('[data-grupo]')) {
      grupo.hidden = grupo.dataset.grupo !== def.grupo;
    }
    // Um aviso de outra tela não vale nesta.
    const aviso = document.getElementById('aviso');
    if (aviso && mudouDeTela) aviso.hidden = true;

    document.dispatchEvent(new CustomEvent('app:tela', { detail: { ...rota, grupo: def.grupo } }));
    if (mudouDeTela) scrollTo(0, 0);
  }

  addEventListener('hashchange', ir);
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', `#/${TELA_INICIAL}`);
  ir();
}
