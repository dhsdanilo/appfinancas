// Pendente: o lançamento que existe, mas o dinheiro ainda não se moveu — a
// compra que o banco só debita quando o produto sai para entrega. Dar baixa é
// o dinheiro ter se movido; desfazer a baixa volta a esperar.
//
// No cartão, a compra pendente fica fora do total da fatura (o banco ainda não
// a cobrou) mas pesa no limite. Quando o débito chega, ela cai na fatura do
// DIA DA BAIXA — é assim que o banco fatura —, sem mexer na data da compra.

import { hoje } from './datas.js';
import { cicloDaCompra, temCiclo } from './cartao.js';

/** A compra está na conta de um cartão com ciclo (e, portanto, numa fatura)? */
const noCartao = (estado, l) => Boolean(l.cicloFatura) && temCiclo(estado.contas[l.contaId]);

/** Quantas faturas a compra anda para cair na fatura do dia `dia`. */
export function faturaDoDia(conta, dataCompra, dia = hoje()) {
  const alvo = cicloDaCompra(conta, dia).fechamento;
  for (let k = -24; k <= 24; k += 1) {
    if (cicloDaCompra(conta, dataCompra, k).fechamento === alvo) return k;
  }
  return 0;
}

/**
 * O que muda ao dar baixa (o dinheiro se moveu): confirmado, não mais pendente,
 * e guarda de onde veio para a baixa poder ser desfeita.
 *   no cartão     → a fatura passa a ser a do dia da baixa;
 *   fora do cartão → data futura vira hoje.
 */
export function dadosDaBaixa(estado, l, dia = hoje()) {
  const d = {
    confirmado: true,
    pendente: false,
    baixaDe: { dataCaixa: l.dataCaixa, faturaDesloca: l.faturaDesloca ?? 0 },
  };
  if (noCartao(estado, l)) d.faturaDesloca = faturaDoDia(estado.contas[l.contaId], l.dataCompetencia, dia);
  else if (l.dataCaixa > dia) d.dataCaixa = dia;
  return d;
}

/** O que muda ao deixar pendente (ou desfazer a baixa): volta ao que era antes dela. */
export function dadosDeFicarPendente(estado, l) {
  const antes = l.baixaDe ?? {};
  const d = { confirmado: false, pendente: true, baixaDe: null };
  if (noCartao(estado, l)) d.faturaDesloca = antes.faturaDesloca ?? l.faturaDesloca ?? 0;
  else if (antes.dataCaixa) d.dataCaixa = antes.dataCaixa;
  return d;
}
