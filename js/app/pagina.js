// A moldura de toda tela do andar de cima (design/08-telas §1, reestruturado
// em 03/10/2026 a partir do que os apps de referência fazem).
//
//   PC       — barra lateral: Início, Lançamentos, Meu dinheiro (as cinco áreas,
//              cada uma com a sua cor), Planejamento, Configurações.
//   Celular  — barra de baixo: Início, Lançamentos, +, Dinheiro, Mais.
//
// A moldura também liga a sincronização e o modo offline, uma vez por página.
// O térreo (a captura do celular, index.html) não tem nada disto — D11.

import * as log from '../core/log.js';
import { instalarServiceWorker } from './instalar.js';
import { iniciarSincronia } from './sincronia-viva.js';
import { enderecoDa } from './rotas.js';
import { ligarAutomaticas } from './automaticas.js';

const MEU_DINHEIRO = [
  { pagina: 'contas', titulo: 'Contas', area: 'caixa' },
  { pagina: 'cartoes', titulo: 'Cartões', area: 'cartoes' },
  { pagina: 'renda', titulo: 'Renda', area: 'folha' },
  { pagina: 'investimentos', titulo: 'Investimentos', area: 'investimentos' },
  { pagina: 'dividas', titulo: 'Dívidas', area: 'dividas' },
];

// Planejar: o que não é dinheiro novo, e sim decisão sobre ele. Envelopes
// moram aqui — são outra dimensão do mesmo dinheiro, não uma conta (pedido
// dele, 03/10/2026, design/11 §5) —, e ficam no menu mesmo vazios: é lá que
// se cria o primeiro.
const PLANEJAR = ['envelopes', 'relatorios', 'energia'];

/** O item de um menu de "Meu dinheiro". */
const itemDeDinheiro = (m, atual) =>
  link(m.pagina, m.titulo, atual, `<span class="ponto-area" data-area="${m.area}" aria-hidden="true"></span>${m.titulo}`);

const ICONE = {
  inicio: '<path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z"/>',
  lancamentos: '<path d="M4 5h12M4 10h12M4 15h8"/>',
  configuracoes: '<circle cx="10" cy="10" r="2.6"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.4 1.4M13.6 13.6 15 15M5 15l1.4-1.4M13.6 6.4 15 5"/>',
  dinheiro: '<path d="M3 6h14v9H3zM3 9h14M13 12h1.5"/>',
  envelopes: '<path d="M3 5.5h14v9H3z"/><path d="m3 5.5 7 5.5 7-5.5"/>',
  relatorios: '<path d="M4 16V9M8.5 16V5M13 16v-5M17 16H3"/>',
  energia: '<path d="M11 2 4.5 11H9l-1 7 6.5-9H10z"/>',
  mais: '<circle cx="5" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>',
};

const icone = (nome) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONE[nome]}</svg>`;

const NUVEM = `
  <div class="nuvem" id="nuvem" hidden>
    <span class="carimbo" data-papel="carimbo"></span>
    <button type="button" class="bt-nuvem" data-papel="b-nuvem" aria-label="Sincronizar agora" title="Sincronizar agora">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 15h8.2a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6-1.1A3.6 3.6 0 0 0 6 15z"/>
      </svg>
    </button>
  </div>`;

// Todo link leva ao app de uma página só: dentro dele, trocar de tela é só
// trocar o endereço depois do #, sem recarregar nada.
function link(pagina, titulo, atual, conteudo) {
  return `<a href="${enderecoDa(pagina)}" data-tela="${pagina}"${pagina === atual ? ' aria-current="page"' : ''}>${conteudo ?? titulo}</a>`;
}

/** Marca no menu a tela em que se está, e fecha as folhas do celular. */
function marcarAtual(tela) {
  for (const a of document.querySelectorAll('.menu-lateral [data-tela], .menu-inferior [data-tela]')) {
    if (a.dataset.tela === tela) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const naArea = MEU_DINHEIRO.some((m) => m.pagina === tela);
  const noMais = [...PLANEJAR, 'configuracoes'].includes(tela);
  const inferior = document.querySelector('.menu-inferior');
  if (!inferior) return;
  for (const [menu, ligado] of [['dinheiro', naArea], ['mais', noMais]]) {
    const b = inferior.querySelector(`[data-menu="${menu}"]`);
    if (ligado) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const folha of inferior.querySelectorAll('[data-folha]')) folha.hidden = true;
}

document.addEventListener('app:tela', (e) => marcarAtual(e.detail.tela === 'ativo' ? 'investimentos' : e.detail.tela));

function lateral(atual) {
  return `
    <a class="marca-app" href="${enderecoDa('inicio')}">Finanças</a>
    <div class="grupo-menu">
      ${link('inicio', 'Início', atual, `${icone('inicio')}Início`)}
      ${link('lancamentos', 'Lançamentos', atual, `${icone('lancamentos')}Lançamentos`)}
    </div>
    <p class="rotulo-menu">Meu dinheiro</p>
    <div class="grupo-menu">
      ${MEU_DINHEIRO.map((m) => itemDeDinheiro(m, atual)).join('')}
    </div>
    <p class="rotulo-menu">Planejar</p>
    <div class="grupo-menu">
      ${link('envelopes', 'Envelopes', atual, `${icone('envelopes')}Envelopes`)}
      ${link('relatorios', 'Relatórios', atual, `${icone('relatorios')}Relatórios`)}
      ${link('energia', 'Energia', atual, `${icone('energia')}Energia`)}
    </div>
    <div class="grupo-menu pe-menu">
      ${link('configuracoes', 'Configurações', atual, `${icone('configuracoes')}Configurações`)}
    </div>`;
}

function inferior(atual) {
  const naArea = MEU_DINHEIRO.some((m) => m.pagina === atual);
  const noMais = [...PLANEJAR, 'configuracoes', 'verificacao'].includes(atual);
  return `
    ${link('inicio', 'Início', atual, `${icone('inicio')}<span>Início</span>`)}
    ${link('lancamentos', 'Lançamentos', atual, `${icone('lancamentos')}<span>Lançamentos</span>`)}
    <button type="button" class="bt-mais-lancar" data-menu="lancar" aria-label="Novo lançamento">+</button>
    <button type="button" data-menu="dinheiro" ${naArea ? 'aria-current="page"' : ''} aria-expanded="false">${icone('dinheiro')}<span>Dinheiro</span></button>
    <button type="button" data-menu="mais" ${noMais ? 'aria-current="page"' : ''} aria-expanded="false">${icone('mais')}<span>Mais</span></button>
    <div class="folha-menu" data-folha="dinheiro" hidden>
      ${MEU_DINHEIRO.map((m) => itemDeDinheiro(m, atual)).join('')}
    </div>
    <div class="folha-menu" data-folha="mais" hidden>
      ${link('envelopes', 'Envelopes', atual)}
      ${link('relatorios', 'Relatórios', atual)}
      ${link('energia', 'Energia', atual)}
      ${link('configuracoes', 'Configurações', atual)}
    </div>`;
}

/**
 * Lançar de qualquer tela: a página que tem a captura registra aqui como abrir;
 * a que não tem leva para a captura do térreo.
 */
let abrirCaptura = null;
export function aoLancar(fn) {
  abrirCaptura = fn;
}

async function garantirAparelho() {
  // O aparelho se registra sozinho: ninguém abre um app de finanças pra dar
  // nome ao computador.
  if (await log.aparelho()) return;
  await log.registrarAparelho(navigator.maxTouchPoints > 1 ? 'Celular' : 'PC');
}

export async function montarPagina() {
  const atual = document.body.dataset.pagina ?? '';

  const lateralEl = document.createElement('nav');
  lateralEl.className = 'menu-lateral';
  lateralEl.setAttribute('aria-label', 'Seções do app');
  lateralEl.innerHTML = lateral(atual);
  document.body.prepend(lateralEl);

  const inferiorEl = document.createElement('nav');
  inferiorEl.className = 'menu-inferior';
  inferiorEl.setAttribute('aria-label', 'Seções do app');
  inferiorEl.innerHTML = inferior(atual);
  document.body.append(inferiorEl);

  // O carimbo da sincronização mora no cabeçalho da página.
  const topo = document.querySelector('.topo');
  if (topo && !document.getElementById('nuvem')) topo.insertAdjacentHTML('beforeend', NUVEM);

  inferiorEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    if (b.dataset.menu === 'lancar') {
      if (abrirCaptura) abrirCaptura();
      else location.href = 'index.html';
      return;
    }
    for (const folha of inferiorEl.querySelectorAll('[data-folha]')) {
      const esta = folha.dataset.folha === b.dataset.menu;
      folha.hidden = esta ? !folha.hidden : true;
    }
    for (const outro of inferiorEl.querySelectorAll('[data-menu="dinheiro"], [data-menu="mais"]')) {
      outro.setAttribute('aria-expanded', String(!inferiorEl.querySelector(`[data-folha="${outro.dataset.menu}"]`).hidden));
    }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.menu-inferior')) return;
    for (const folha of inferiorEl.querySelectorAll('[data-folha]')) folha.hidden = true;
  });

  await garantirAparelho();
  ligarAutomaticas();
  instalarServiceWorker();
  iniciarSincronia({ raiz: document.getElementById('nuvem') });
}
