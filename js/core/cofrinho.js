// O cofrinho do cartão (design/11 §9): uma conta onde se guarda, de antemão, o
// que o cartão deve. O alvo é o limite usado mais as compras previstas da
// fatura aberta (recorrentes ainda não lançadas); o provisionado é o que há no
// cofrinho. Tudo derivado — nada é gravado além do vínculo no cartão.

import { hoje } from './datas.js';
import { temCiclo, cicloDaCompra } from './cartao.js';
import { saldoReal, sinalDeSaida } from './lancamentos.js';
import { resumoDoCartao, faturasNoPeriodo } from './previsto.js';
import { resumoDaConta } from './investimentos.js';

/** O que há no cofrinho: o valor da conta de investimento, ou o saldo da de caixa. */
export function valorDoCofrinho(estado, cofrinhoId, dia = hoje()) {
  const conta = estado.contas[cofrinhoId];
  if (!conta) return 0;
  return conta.tipo === 'investimento' ? resumoDaConta(estado, conta, dia).valorAtual : saldoReal(estado, cofrinhoId);
}

/**
 * { cofrinho, provisionado, limiteUsado, previstas, estimado, alvo, falta }
 * ou null se o cartão não tem cofrinho (ou não tem ciclo). `falta` é negativa
 * quando o cofrinho passa do alvo.
 */
export function provisaoDoCartao(estado, cartaoId, dia = hoje()) {
  const cartao = estado.contas[cartaoId];
  const cofrinho = cartao?.cofrinhoId ? estado.contas[cartao.cofrinhoId] : null;
  if (!cartao || cartao.tipo !== 'cartao' || !cofrinho || !temCiclo(cartao)) return null;

  const limiteUsado = resumoDoCartao(estado, cartaoId, dia)?.divida ?? 0;
  // Só o ciclo da fatura aberta: a compra de hoje cai nela; os seguintes não entram.
  const { vencimento } = cicloDaCompra(cartao, dia);
  const aberta = faturasNoPeriodo(estado, cartaoId, vencimento, vencimento, dia)[0];
  const previstas = (aberta?.projetadas ?? []).reduce((t, o) => t + sinalDeSaida(o), 0);
  const estimado = Boolean(aberta?.estimado);

  const provisionado = valorDoCofrinho(estado, cofrinho.id, dia);
  const alvo = limiteUsado + previstas;
  return { cofrinho, provisionado, limiteUsado, previstas, estimado, alvo, falta: alvo - provisionado };
}
