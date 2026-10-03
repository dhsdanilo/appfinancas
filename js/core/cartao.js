// O ciclo do cartão: a qual fatura uma compra pertence e quando ela vence.
// design/03-alimentacao.md §6.2 · design/02-modelo-de-dados.md §3.8
//
// Regras puras, sem estado: quem as aplica é o redutor (que preenche as datas
// do lançamento) e o cálculo das faturas (js/core/previsto.js).

import { diaNoMes } from './datas.js';

/** O cartão sabe calcular fatura só quando tem os dois dias. */
export function temCiclo(conta) {
  return conta?.tipo === 'cartao' && Boolean(conta.diaFechamento) && Boolean(conta.diaVencimento);
}

/**
 * A fatura de uma compra. Compra ANTES do dia de fechamento cai na fatura que
 * fecha naquele mês; no dia do fechamento ou depois, na seguinte — é como os
 * bancos fazem. O ciclo é identificado pela data em que fecha.
 */
export function cicloDaCompra(conta, dataCompra, desloca = 0) {
  const [ano, mes] = dataCompra.split('-').map(Number);
  let fechamento = diaNoMes(ano, mes, conta.diaFechamento);
  if (dataCompra >= fechamento) fechamento = diaNoMes(ano, mes + 1, conta.diaFechamento);
  // A compra que o banco processou numa fatura vizinha: a data dela fica, a
  // fatura anda (pedido dele, 03/10/2026).
  if (desloca) {
    const [a, m] = fechamento.split('-').map(Number);
    fechamento = diaNoMes(a, m + desloca, conta.diaFechamento);
  }
  return { fechamento, vencimento: vencimentoDoCiclo(conta, fechamento) };
}

/**
 * Vencimento maior que o fechamento: vence no mesmo mês em que fecha (fecha 3,
 * vence 10). Menor ou igual: no mês seguinte (fecha 28, vence 5).
 */
export function vencimentoDoCiclo(conta, fechamento) {
  const [ano, mes] = fechamento.split('-').map(Number);
  return conta.diaVencimento > conta.diaFechamento
    ? diaNoMes(ano, mes, conta.diaVencimento)
    : diaNoMes(ano, mes + 1, conta.diaVencimento);
}

/**
 * Preenche as três datas de um lançamento no cartão (D4): a competência é a
 * compra, que veio do dedo; ciclo, caixa e vencimento vêm do ciclo. Altera no
 * lugar — é chamada pelo redutor.
 *
 * A parcela é realizada mesmo com competência num mês futuro: a compra
 * aconteceu, o que ainda não aconteceu é o pagamento (D4) — e ele já aparece
 * pela fatura.
 */
export function datarNoCartao(l, conta) {
  // O estorno entra na fatura de quando o dinheiro voltou — "reduz a fatura,
  // inclusive a em formação" (03 §3.3) —, e não na da compra que ele desfaz.
  const base = l.tipo === 'estorno' && l.devolvidoEm ? l.devolvidoEm : l.dataCompetencia;
  if (!temCiclo(conta)) {
    // Saiu do cartão (ou o cartão perdeu o ciclo): as datas voltam a ser uma.
    if (l.cicloFatura) {
      l.cicloFatura = null;
      l.dataCaixa = base;
      l.dataVencimento = base;
    }
    return;
  }
  const { fechamento, vencimento } = cicloDaCompra(conta, base, l.faturaDesloca ?? 0);
  l.cicloFatura = fechamento;
  l.dataCaixa = vencimento;
  l.dataVencimento = vencimento;
  if (l.parcela) l.confirmado = true;
}
