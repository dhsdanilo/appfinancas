// Compras de outra pessoa no meu cartão: o "a repassar" (design/16).
//
// A compra é real e entra na fatura de quem é o cartão; ela só leva a marca de
// quem comprou (`compradoPor`). O repasse é a transferência que a pessoa
// MARCA como tal (`repasse: true`) — há outras transferências entre os dois
// que não são repasse. Tudo derivado: não se grava o saldo de ninguém.

import { hoje } from './datas.js';
import { lancados, estornado, sinalDeSaida } from './lancamentos.js';

const CHAVE_APARELHO = 'appfinancas:aparelho-de';

/** De quem é este aparelho (a pessoa), ou null. Fica só neste aparelho. */
export function pessoaDoAparelho() {
  try { return localStorage.getItem(CHAVE_APARELHO) || null; } catch { return null; }
}

export function definirPessoaDoAparelho(pessoaId) {
  try {
    if (pessoaId) localStorage.setItem(CHAVE_APARELHO, pessoaId);
    else localStorage.removeItem(CHAVE_APARELHO);
  } catch { /* sem armazenamento: o aparelho só não lembra */ }
}

/**
 * A pessoa que comprou, para gravar no lançamento: só quando a conta é um
 * cartão cujo titular é OUTRA pessoa que a do aparelho. Senão, null.
 */
export function compradoPorDaCompra(estado, contaId, pessoaId = pessoaDoAparelho()) {
  const conta = estado.contas[contaId];
  if (!pessoaId || !conta || conta.tipo !== 'cartao' || !conta.titular || conta.titular === pessoaId) return null;
  return pessoaId;
}

/**
 * O que a pessoa `pessoaId` ainda deve repassar, por titular de cartão:
 * [{ titular, compras, repassado, aRepassar, adiantado }]. Devolução abate a
 * compra; parcela só conta no mês em que cai; repasse a mais vira adiantado.
 */
export function repassesDe(estado, pessoaId, dia = hoje()) {
  const porTitular = new Map();
  const linha = (titular) => {
    if (!porTitular.has(titular)) porTitular.set(titular, { titular, compras: 0, repassado: 0 });
    return porTitular.get(titular);
  };
  for (const l of lancados(estado)) {
    if (l.dataCompetencia > dia) continue;
    if (l.tipo === 'despesa' && l.compradoPor === pessoaId) {
      const titular = estado.contas[l.contaId]?.titular;
      if (titular && titular !== pessoaId) linha(titular).compras += l.valor - estornado(estado, l.id);
    } else if (l.tipo === 'transferencia' && l.repasse && l.confirmado) {
      const de = estado.contas[l.contaId]?.titular;
      const para = estado.contas[l.contaDestinoId]?.titular;
      if (de === pessoaId && para && para !== pessoaId) linha(para).repassado += l.valor;
    }
  }
  return [...porTitular.values()]
    .map((x) => ({ ...x, aRepassar: Math.max(0, x.compras - x.repassado), adiantado: Math.max(0, x.repassado - x.compras) }))
    .filter((x) => x.compras || x.repassado);
}

/** O total que a pessoa ainda deve repassar. */
export const aRepassarDe = (estado, pessoaId, dia = hoje()) =>
  repassesDe(estado, pessoaId, dia).reduce((t, x) => t + x.aRepassar, 0);

/** Quanto a pessoa deve repassar a um titular, ou 0. */
export function aRepassarAo(estado, pessoaId, titularId, dia = hoje()) {
  return repassesDe(estado, pessoaId, dia).find((x) => x.titular === titularId)?.aRepassar ?? 0;
}

/** O que cada pessoa ainda vai repassar ao titular: [{ pessoa, aRepassar }]. */
export function aReceber(estado, titularId, dia = hoje()) {
  return Object.keys(estado.pessoas ?? {})
    .filter((p) => p !== titularId)
    .map((pessoa) => ({ pessoa, aRepassar: aRepassarAo(estado, pessoa, titularId, dia) }))
    .filter((x) => x.aRepassar > 0);
}

/**
 * O que a pessoa tem de verdade nas contas de caixa dela: o saldo menos o que
 * ainda é de quem lhe emprestou o cartão. { saldo, aRepassar, disponivel }.
 */
export function disponivelDe(estado, pessoaId, saldoDe, dia = hoje()) {
  const contas = Object.values(estado.contas).filter(
    (c) => c.titular === pessoaId && !c.arquivada && (c.tipo === 'corrente' || c.tipo === 'especie')
  );
  const saldo = contas.reduce((t, c) => t + saldoDe(c.id), 0);
  const aRepassar = aRepassarDe(estado, pessoaId, dia);
  return { saldo, aRepassar, disponivel: saldo - aRepassar, contas: contas.length };
}

export { sinalDeSaida };
