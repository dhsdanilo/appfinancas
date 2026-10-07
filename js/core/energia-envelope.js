// O compromisso da Energia com um envelope (pedido dele, 07/10/2026): a economia de cada mês
// (js/core/energia.js) é "cobrada" pelo envelope ligado a ela, dois meses depois — quando a conta
// de luz daquele período é paga. Nada vira transferência: depositar é decisão dele.
//
//   cobrado     = as economias cujo mês de cobrança já chegou
//   depositado  = o que ele pôs no envelope desde o começo da contagem (aporte, o que entrou, o que
//                 veio de outro envelope). O RENDIMENTO NÃO CONTA: só o que ele depositou.
//   reposição   = o que ele tirou do envelope marcando "repor" (a emergência do carro, sim; o que foi
//                 para o sistema elétrico, não)
//   faltando    = cobrado + reposição − depositado (negativo: adiantado)

import { hoje, somarMeses } from './datas.js';
import { mesesDeEnergia } from './energia.js';
import { donosNoDia } from './envelopes.js';

/**
 * null sem vínculo (ou com o envelope apagado). Senão:
 * { config, envelope, itens: [{ ref, cobraEm, valor, vencido }], cobrado, depositado, reposicao, faltando }
 */
export function compromissoDaEnergia(estado, dia = hoje()) {
  const cfg = estado.energiaConfig;
  const envelope = cfg?.envelopeId ? estado.envelopes?.[cfg.envelopeId] : null;
  if (!envelope) return null;
  const mesDeHoje = dia.slice(0, 7);
  const desdeDia = `${cfg.desde}-01`;

  // Um compromisso por mês de economia positiva, a partir do mês em que a contagem começa.
  const itens = [];
  for (const { registro, calculo } of mesesDeEnergia(estado)) {
    if (!calculo || registro.mes < cfg.desde || calculo.economia == null || calculo.economia <= 0) continue;
    const cobraEm = somarMeses(`${registro.mes}-01`, cfg.defasagem ?? 2).slice(0, 7);
    itens.push({ ref: registro.mes, cobraEm, valor: calculo.economia, vencido: cobraEm <= mesDeHoje });
  }

  const extrato = (donosNoDia(estado, dia).porEnvelope.get(envelope.id)?.extrato ?? []).filter((x) => x.data >= desdeDia);
  let depositado = 0;
  let reposicao = 0;
  for (const x of extrato) {
    if (x.tipo === 'aporte' || x.tipo === 'entrou' || (x.tipo === 'remanejo' && x.de)) depositado += x.valor;
    else if (x.tipo === 'resgate' || (x.tipo === 'remanejo' && x.para)) {
      if (estado.alocacoes?.[x.alocacaoId]?.repor === true) reposicao += x.valor;
    } else if (x.tipo === 'gasto') {
      if (estado.lancamentos?.[x.lancamentoId]?.reporEnvelope === true) reposicao += x.usado;
    }
  }
  const cobrado = itens.filter((i) => i.vencido).reduce((t, i) => t + i.valor, 0);
  return { config: cfg, envelope, itens, cobrado, depositado, reposicao, faltando: cobrado + reposicao - depositado };
}
