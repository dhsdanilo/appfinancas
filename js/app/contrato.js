// As ações sobre um contrato de dívida (design/10 §4.4): gravar, amortizar,
// informar o saldo do banco, dizer que uma parcela não foi debitada, excluir.
//
// A parcela não se lança: ela sai do contrato e cai sozinha na conta que paga
// (js/core/parcelas.js). Por isso gravar o contrato é só gravar o contrato.

import * as estado from '../core/estado.js';
import { novoId } from '../core/id.js';
import * as log from '../core/log.js';
import { hoje, lancados } from '../core/lancamentos.js';
import { simularAmortizacao } from '../core/divida.js';

/**
 * @param {object} app            o estado atual
 * @param {string} contaId        a conta de dívida
 * @param {object} contrato       { valorTomado, data, parcelas, valorParcela, primeira, taxa }
 * @param {string|null} pagaCom   a conta que paga
 */
export async function salvarContrato(app, contaId, contrato, pagaCom) {
  const anterior = app.contas[contaId]?.contrato;
  await estado.aplicarEvento('conta.alterada', {
    id: contaId,
    contrato: {
      ...contrato,
      // O dia em que o empréstimo entrou no app: o que venceu até ele já está
      // no saldo das contas, e não cai de novo. Corrigir o contrato depois não
      // muda esse dia.
      incluidoEm: anterior?.incluidoEm ?? app.contas[contaId]?.dataInicial ?? hoje(),
      // A série da primeira versão, se houve: guardada só para não repetir os
      // meses que ela já lançou.
      recorrenciaId: anterior?.recorrenciaId ?? null,
    },
    pagaCom: pagaCom ?? null,
  });
}

/** A foto do saldo devedor que o banco informa. */
export function fotografar(contaId, valor, data = hoje()) {
  return estado.aplicarEvento('conta.fotografada', { id: contaId, data, valor });
}

/**
 * Amortizar: a transferência que leva o dinheiro, e o resultado escolhido —
 * reduzir prazo ou reduzir parcela —, que o calendário passa a seguir.
 *
 * @param {object} app
 * @param {{ dividaId, origemId, valor, data, modo: 'prazo'|'parcela' }} pedido
 */
export async function amortizar(app, { dividaId, origemId, valor, data, modo }) {
  const sim = simularAmortizacao(app, dividaId, valor, data);
  if (!sim) return false;
  const ap = await log.aparelho();
  const lancamentoId = novoId('lan');
  const pago = sim.quita ? sim.valor : valor;
  await estado.aplicarEvento('lancamento.registrado', {
    id: lancamentoId,
    tipo: 'transferencia',
    valor: pago,
    dataCompetencia: data,
    dataCaixa: data,
    contaId: origemId,
    contaDestinoId: dividaId,
    categoriaId: null,
    confirmado: data <= hoje(),
    observacao: 'amortização',
    lancadoPor: ap?.id ?? null,
  });
  const resultado = sim.quita
    ? { modo: 'prazo', restantes: 0 }
    : modo === 'prazo'
      ? { modo, restantes: sim.prazo.restantes, ultima: sim.prazo.ultima }
      : { modo, parcela: sim.parcela.parcela };
  await estado.aplicarEvento('divida.amortizada', { id: dividaId, lancamentoId, data, valor: pago, ...resultado });
  return true;
}

/** A parcela `k` que o banco cobrou diferente: só ela muda, e continua caindo sozinha. */
export function corrigirParcela(dividaId, k, { valor, data, contaId }) {
  return estado.aplicarEvento('divida.parcelaCorrigida', { id: dividaId, k, valor, data, contaId });
}

/** Desfaz a correção: a parcela volta a ser a do contrato. */
export function voltarAoContrato(dividaId, k) {
  return estado.aplicarEvento('divida.parcelaCorrigida', { id: dividaId, k, desfazer: true });
}

/** "Não foi debitada": a parcela automática `k` não cai. */
export function pularParcela(dividaId, k, pulada = true) {
  return estado.aplicarEvento('divida.parcelaPulada', { id: dividaId, k, pulada });
}

/**
 * Excluir é para cadastro errado (design/10 §4.4): some o empréstimo e tudo
 * que ele gerou — as amortizações. As parcelas automáticas, e as correções
 * delas, somem sozinhas: saem do contrato.
 */
export async function excluirDivida(app, dividaId) {
  for (const l of lancados(app)) {
    if (l.contaId === dividaId || l.contaDestinoId === dividaId) {
      await estado.aplicarEvento('lancamento.removido', { id: l.id });
    }
  }
  await estado.aplicarEvento('conta.removida', { id: dividaId });
}
