// A compra de mais de uma categoria (formulário completo): uma barra reparte o
// valor entre a categoria principal e as que se acrescentam. É para os
// relatórios ficarem verdadeiros — o valor de cada parte é aproximado, e a
// soma é sempre a da compra. A principal fica com o que sobra.

import { formatar } from '../core/dinheiro.js';

export const MARCACAO_DIVISAO = `
    <div class="linha-refino divisao-compra" data-papel="linha-divisao" hidden>
      <span class="rotulo-etiquetas">categorias</span>
      <button type="button" class="elo" data-papel="b-dividir" aria-expanded="false">dividir em mais de uma</button>
      <div class="divisao-corpo" data-papel="divisao" hidden>
        <div class="barra-divisao" data-papel="barra-divisao" role="img" aria-label="Divisão do valor entre as categorias"></div>
        <div class="partes-divisao" data-papel="partes-divisao"></div>
        <div class="nova-parte">
          <input type="text" class="nova-etiqueta" data-papel="nova-parte" autocomplete="off"
                 placeholder="outra categoria desta compra" aria-label="Acrescentar categoria à compra" list="">
          <datalist data-papel="sugestoes-parte"></datalist>
          <button type="button" class="elo" data-papel="b-nova-parte">acrescentar</button>
        </div>
        <p class="pista-repete" data-papel="pista-divisao"></p>
      </div>
    </div>
`;

const cor = (i) => `hsl(${(150 + i * 67) % 360} 42% 50%)`;
const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {HTMLElement} raiz  onde a marcação foi posta
 * @param {object} o
 * @param {() => number} o.total             o valor da compra, em centavos
 * @param {() => Array<{id, nome}>} o.categorias   as que se podem acrescentar
 * @param {(id: string) => string} o.nome
 * @param {(nome: string) => Promise<string|null>} o.criar   cria (ou acha) a categoria e devolve o id
 */
export function ligarDivisao(raiz, { total, categorias, nome, criar }) {
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);
  // As acrescentadas, com a fatia de cada uma em %; a principal fica com o resto.
  let extras = [];
  let principal = null;
  let aberta = false;
  const ids = `parte-${Math.random().toString(36).slice(2, 8)}`;
  el('sugestoes-parte').id = ids;
  el('nova-parte').setAttribute('list', ids);

  const pctDaPrincipal = () => 100 - extras.reduce((t, x) => t + x.pct, 0);
  const valorDe = (pct) => Math.round((total() * pct) / 100);
  // Uma parte vinda de um lançamento guarda o valor exato dele enquanto ninguém mexe na fatia nem no total.
  const valorDaParte = (x) => (x.base && x.pct === x.base.pct && total() === x.base.total ? x.base.valor : valorDe(x.pct));

  /** O que vai ser gravado: [{ categoriaId, valor }] com a principal primeiro, ou null. */
  function ler(idPrincipal) {
    const usadas = extras.filter((x) => x.pct > 0 && x.categoriaId !== idPrincipal && valorDaParte(x) > 0);
    if (!aberta || !idPrincipal || !usadas.length || total() <= 0) return null;
    const partes = usadas.map((x) => ({ categoriaId: x.categoriaId, valor: valorDaParte(x) }));
    const resto = total() - partes.reduce((t, p) => t + p.valor, 0);
    return resto > 0 ? [{ categoriaId: idPrincipal, valor: resto }, ...partes] : null;
  }

  function pintar(idPrincipal) {
    principal = idPrincipal;
    // A principal mudou para uma que já era acrescentada: ela sai das acrescentadas.
    extras = extras.filter((x) => x.categoriaId !== principal);
    el('b-dividir').setAttribute('aria-expanded', String(aberta));
    el('b-dividir').textContent = aberta ? 'categoria única' : 'dividir em mais de uma';
    el('divisao').hidden = !aberta;
    if (!aberta) return;

    const sobra = pctDaPrincipal();
    const todas = [{ categoriaId: principal, pct: sobra, principal: true }, ...extras];
    el('barra-divisao').innerHTML = todas
      .filter((x) => x.pct > 0)
      .map((x, i) => `<span style="width:${x.pct}%;background:${cor(todas.indexOf(x))}" title="${escapar(nome(x.categoriaId))} · ${x.pct}%"></span>`)
      .join('');

    el('partes-divisao').innerHTML = todas.map((x, i) => {
      const quanto = x.principal ? total() - extras.reduce((t, e) => t + valorDaParte(e), 0) : valorDaParte(x);
      const rotulo = `<span class="parte-nome"><i style="background:${cor(i)}"></i>${escapar(nome(x.categoriaId))}${x.principal ? ' <span class="fino">principal</span>' : ''}</span>`;
      const valores = `<span class="parte-valor">${formatar(Math.max(0, quanto))} · ${x.pct}%</span>`;
      if (x.principal) return `<div class="parte">${rotulo}<span class="parte-resto fino">o que sobra</span>${valores}</div>`;
      // Quanto esta fatia pode crescer: o que ela tem mais o que sobra para a principal.
      const maximo = x.pct + sobra;
      return `<div class="parte">${rotulo}
        <input type="range" min="0" max="${maximo}" step="1" value="${x.pct}" data-parte="${escapar(x.categoriaId)}" aria-label="Quanto da compra é ${escapar(nome(x.categoriaId))}">
        ${valores}
        <button type="button" class="elo" data-tirar-parte="${escapar(x.categoriaId)}" aria-label="Tirar ${escapar(nome(x.categoriaId))}">×</button>
      </div>`;
    }).join('');

    const jaTem = new Set([principal, ...extras.map((x) => x.categoriaId)]);
    el('sugestoes-parte').innerHTML = categorias().filter((c) => !jaTem.has(c.id)).map((c) => `<option value="${escapar(c.nome)}">`).join('');
    el('pista-divisao').textContent = total() > 0
      ? 'Valores aproximados: servem para os relatórios. A soma é sempre o valor da compra.'
      : 'Informe o valor para ver quanto cabe a cada categoria.';
  }

  /** Acrescenta uma categoria (existente pelo nome, ou nova), com metade da fatia da principal. */
  async function acrescentar() {
    const texto = el('nova-parte').value.trim();
    if (!texto || !principal) return;
    const chave = (t) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();
    const achada = categorias().find((c) => chave(c.nome) === chave(texto));
    const id = achada?.id ?? (await criar(texto));
    if (!id || id === principal || extras.some((x) => x.categoriaId === id)) { el('nova-parte').value = ''; pintar(principal); return; }
    extras.push({ categoriaId: id, pct: Math.floor(pctDaPrincipal() / 2) });
    el('nova-parte').value = '';
    pintar(principal);
  }

  el('b-dividir').addEventListener('click', () => {
    aberta = !aberta;
    if (!aberta) extras = [];
    pintar(principal);
    if (aberta) el('nova-parte').focus();
  });
  el('b-nova-parte').addEventListener('click', acrescentar);
  el('nova-parte').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); acrescentar(); }
  });
  raiz.addEventListener('input', (e) => {
    const r = e.target.closest('input[data-parte]');
    if (!r) return;
    const x = extras.find((y) => y.categoriaId === r.dataset.parte);
    if (!x) return;
    const outras = extras.filter((y) => y !== x).reduce((t, y) => t + y.pct, 0);
    x.pct = Math.max(0, Math.min(Number(r.value), 100 - outras));
    pintar(principal);
  });
  raiz.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tirar-parte]');
    if (!t) return;
    extras = extras.filter((x) => x.categoriaId !== t.dataset.tirarParte);
    if (!extras.length) aberta = false;
    pintar(principal);
  });

  return {
    ler,
    pintar,
    /** Só no formulário completo, em despesa, com a principal escolhida. */
    mostrar(sim) {
      el('linha-divisao').hidden = !sim;
    },
    limpar() {
      extras = [];
      aberta = false;
      pintar(principal);
    },
    /** Carrega a divisão de um lançamento: [{ categoriaId, valor }] (a principal primeiro) ou null. */
    definir(divisao, valorTotal) {
      extras = [];
      aberta = Boolean(divisao && divisao.length > 1 && valorTotal > 0);
      if (aberta) {
        extras = divisao.slice(1).map((p) => {
          const pct = Math.max(0, Math.round((p.valor * 100) / valorTotal));
          return { categoriaId: p.categoriaId, pct, base: { pct, valor: p.valor, total: valorTotal } };
        });
      }
      pintar(divisao?.[0]?.categoriaId ?? principal);
    },
  };
}
