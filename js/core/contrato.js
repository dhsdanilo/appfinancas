// O calendário de pagamentos de um contrato de dívida (design/10 §4.4).
//
// Conta pura: recebe o contrato e as amortizações, devolve as parcelas — data
// e valor de cada uma. Não olha lançamento nenhum, e é por isso que pode ser a
// fonte das parcelas automáticas sem andar em círculo: quem calcula saldo
// precisa das parcelas, e as parcelas não precisam de saldo.
//
// A amortização guarda o RESULTADO que foi escolhido no dia (quantas parcelas
// sobraram, ou a parcela nova): o calendário não refaz a conta depois, senão
// uma taxa observada nova mudaria o passado.

import { somarMeses } from './datas.js';

/**
 * As parcelas do contrato, da primeira à última: [{ k, data, valor }].
 * @param {object} contrato      { parcelas, valorParcela, primeira }
 * @param {object[]} amortizacoes [{ data, modo: 'prazo'|'parcela', restantes?, ultima?, parcela? }]
 */
export function calendarioDePagamento(contrato, amortizacoes = []) {
  if (!contrato?.parcelas || !contrato.valorParcela || !contrato.primeira) return [];
  const pendentes = [...amortizacoes].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  let total = contrato.parcelas;
  let pmt = contrato.valorParcela;
  let ultima = null;
  const saida = [];
  for (let k = 1; k <= total; k += 1) {
    const data = somarMeses(contrato.primeira, k - 1);
    // A amortização vale a partir da parcela seguinte a ela; no mesmo dia de
    // uma parcela, a parcela vem antes.
    while (pendentes.length && pendentes[0].data < data) {
      const a = pendentes.shift();
      if (a.modo === 'prazo') {
        total = k - 1 + (a.restantes ?? 0);
        ultima = a.ultima ?? null;
      } else if (a.parcela) {
        pmt = a.parcela;
        ultima = null;
      }
    }
    if (k > total) break;
    saida.push({ k, data, valor: k === total && ultima ? ultima : pmt });
  }
  return saida;
}

/** Saldo de `pv` depois de `k` parcelas de `pmt` a `i` ao mês (Price). */
export function saldoPrice(pv, i, pmt, k) {
  if (k <= 0) return pv;
  if (!i) return Math.max(0, pv - pmt * k);
  const f = (1 + i) ** k;
  return Math.max(0, pv * f - (pmt * (f - 1)) / i);
}

/** A parcela que paga `pv` em `n` meses a `i` ao mês (Price). */
export function parcelaPrice(pv, i, n) {
  if (n <= 0) return 0;
  if (!i) return pv / n;
  return (pv * i) / (1 - (1 + i) ** -n);
}

/** Taxa mensal que faz `parcela` pagar `valor` em `n` meses (Price), por bisseção. */
export function taxaImplicita(valor, n, parcela) {
  if (!valor || !n || !parcela || parcela * n <= valor) return 0;
  let baixo = 0;
  let alto = 1;
  for (let i = 0; i < 100; i += 1) {
    const meio = (baixo + alto) / 2;
    const pmt = (valor * meio) / (1 - (1 + meio) ** -n);
    if (pmt > parcela) alto = meio;
    else baixo = meio;
  }
  return (baixo + alto) / 2;
}
