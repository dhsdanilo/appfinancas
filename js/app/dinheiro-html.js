// Dinheiro na tela, em um lugar só.
//
// É o componente mais importante do app: dinheiro aparece em toda tela, e
// precisa aparecer igual em todas — centavos em fonte menor, algarismo tabular,
// vírgula sempre, nunca quebrando linha (design/09-identidade.md §4).

import { partes } from '../core/dinheiro.js';

export function dinheiroHTML(centavos, { sinal = '', estimado = false } = {}) {
  const p = partes(centavos);
  const til = estimado ? '<span class="til">~</span>' : '';
  return `<span class="dinheiro">${til}${p.negativo ? '−' : sinal}<span class="moeda">R$</span>${p.reais}<span class="sep">,</span><span class="centavos">${p.centavos}</span></span>`;
}
