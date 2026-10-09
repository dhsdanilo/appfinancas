// O mês de uma conta de caixa, para a faixa do extrato (design/08 §4.2, D31).
//
// A faixa segue o mês da tela:
//   passado  → um extrato: saldo no começo, entrou, saiu, saldo no fim;
//   atual    → o saldo previsto de sempre (previsto.js) e, ao lado, o que ainda
//              vai entrar até o fim do mês — o "previsto com a renda";
//   seguinte → sem o saldo de hoje: só o que entra e sai dentro daquele mês.
//
// `ids` é o conjunto de contas da aba: numa só, ou todas no Geral — onde a
// transferência entre elas não é entrada nem saída.

import { hoje, inicioDoMes, fimDoMes, proximoMes, somarDias } from './datas.js';
import { visiveis, sinalDeSaida } from './lancamentos.js';
import { ocorrenciasPrevistas, faturas } from './previsto.js';
import { liquidoPrevisto } from './holerite.js';
import { provisaoDoCartao, temCofrinho } from './cofrinho.js';

const ehFolha = (estado, id) => estado.contas[id]?.tipo === 'folha';

/** Os meses ('2026-10') de `de` a `ate`, inclusive. */
function meses(de, ate) {
  const lista = [];
  for (let m = de.slice(0, 7); m <= ate.slice(0, 7); m = proximoMes(m)) lista.push(m);
  return lista;
}

/**
 * O saldo no fim do dia `dia`: o saldo inicial e tudo que já se moveu até ele.
 * É o saldo real (lancamentos.js) com um corte de data.
 */
export function saldoNoDia(estado, ids, dia) {
  let saldo = 0;
  for (const id of ids) saldo += estado.contas[id]?.saldoInicial ?? 0;
  for (const l of visiveis(estado)) {
    if (!l.confirmado || l.dataCaixa > dia) continue;
    if (ids.has(l.contaId)) saldo -= sinalDeSaida(l);
    if (ids.has(l.contaDestinoId)) saldo += l.valor;
  }
  return saldo;
}

/**
 * Mês passado, como extrato: o que entrou e saiu de verdade, pela data do
 * caixa, e o saldo no começo e no fim.
 */
export function extratoDoMes(estado, ids, mes) {
  const de = `${mes}-01`;
  const ate = fimDoMes(de);
  let entrou = 0;
  let saiu = 0;
  for (const l of visiveis(estado)) {
    if (!l.confirmado || l.dataCaixa < de || l.dataCaixa > ate) continue;
    const daqui = ids.has(l.contaId);
    const praCa = ids.has(l.contaDestinoId);
    if (daqui && praCa) continue;
    if (daqui) {
      const s = sinalDeSaida(l);
      if (s > 0) saiu += s; else entrou -= s;
    } else if (praCa) entrou += l.valor;
  }
  // A conta que ainda não estava no app naquele mês não tem extrato dele.
  const entrouNoApp = [...ids]
    .map((id) => estado.contas[id]?.dataInicial)
    .filter(Boolean)
    .sort()[0] ?? null;
  return {
    inicio: saldoNoDia(estado, ids, somarDias(de, -1)),
    entrou,
    saiu,
    fim: saldoNoDia(estado, ids, ate),
    antesDoApp: entrouNoApp && entrouNoApp > ate ? entrouNoApp : null,
  };
}

/**
 * O que ainda vai entrar nas contas `ids` até `ate`: o líquido previsto de
 * cada folha que deposita nelas, as receitas por vir (recorrentes e
 * agendadas) e as transferências que chegam de fora.
 *
 * `de` é o começo da janela: no mês atual, o começo do mês — o que venceu e
 * não foi lançado ainda vai entrar; nos seguintes, o primeiro dia deles.
 *
 * { liquidos: [{ folha, valor, data, estimado }], receitas, chegam, total, estimado }
 */
export function entradasPrevistas(estado, ids, de, ate, dia = hoje(), ignorarOrigem = null) {
  const liquidos = [];
  let receitas = 0;
  let chegam = 0;
  let estimado = false;

  for (const folha of Object.values(estado.contas)) {
    if (folha.tipo !== 'folha' || !ids.has(folha.liquidoPara)) continue;
    for (const mes of meses(de, ate)) {
      if (mes < dia.slice(0, 7)) continue;
      const lp = liquidoPrevisto(estado, folha.id, mes, dia);
      if (!lp || lp.data > ate) continue;
      liquidos.push({ folha, valor: lp.valor, data: lp.data, estimado: lp.estimado });
      if (lp.estimado) estimado = true;
    }
  }

  // O que foi lançado com data por vir. O líquido de um contracheque lançado
  // adiantado conta como líquido — é o salário do mesmo jeito.
  for (const l of visiveis(estado, dia)) {
    if (l.confirmado || l.dataCaixa < de || l.dataCaixa > ate) continue;
    const daqui = ids.has(l.contaId);
    const praCa = ids.has(l.contaDestinoId);
    if (daqui && praCa) continue;
    // Do mesmo conjunto (no Geral): o dinheiro só muda de conta, não chega de fora.
    if (praCa && ignorarOrigem?.has(l.contaId)) continue;
    if (daqui && sinalDeSaida(l) < 0) receitas += l.valor;
    else if (praCa && ehFolha(estado, l.contaId)) {
      liquidos.push({ folha: estado.contas[l.contaId], valor: l.valor, data: l.dataCaixa, estimado: false });
    } else if (praCa) chegam += l.valor;
  }

  // As recorrências que ainda vão cair. A série que leva o líquido da folha
  // (de antes do contracheque) fica de fora: o líquido já está acima.
  for (const o of ocorrenciasPrevistas(estado, de, ate, dia)) {
    if (o.dataCaixa > ate || ehFolha(estado, o.contaId)) continue;
    const daqui = ids.has(o.contaId);
    const praCa = ids.has(o.contaDestinoId);
    if (daqui && praCa) continue;
    if (praCa && ignorarOrigem?.has(o.contaId)) continue;
    if (daqui && sinalDeSaida(o) < 0) receitas += o.valor;
    else if (praCa) chegam += o.valor;
    else continue;
    if (o.estimado) estimado = true;
  }

  liquidos.sort((a, b) => (a.data < b.data ? -1 : 1));
  const total = liquidos.reduce((t, x) => t + x.valor, 0) + receitas + chegam;
  return { liquidos, receitas, chegam, total, estimado };
}

/**
 * O que vai sair das contas `ids` dentro de um mês seguinte: as faturas que
 * vencem nele (com as recorrentes do cartão que caem nelas), as recorrentes,
 * as parcelas de dívida e os agendados.
 *
 * { faturas: [{ cartao, valor, recorrentes, abatido, vencimento, estimado }], recorrentes, parcelas, agendados, total, estimado }
 *
 * `abatido`: a fatura ABERTA (a que se forma hoje) já está provisionada no
 * cofrinho do cartão, e a provisão sai do que pesa na conta. No máximo a
 * própria fatura: o cofrinho também guarda parcelas futuras, e o que passa
 * disso não vira entrada — o piso é zero.
 */
export function saidasDoMes(estado, ids, mes, dia = hoje()) {
  const de = `${mes}-01`;
  const ate = fimDoMes(de);
  const porCartao = new Map();
  let recorrentes = 0;
  let parcelas = 0;
  let agendados = 0;
  let estimado = false;
  // Estimativa só nas despesas da conta (sem as do cartão), para o "despesas previstas".
  let estimadoDespesas = false;

  const cartoes = Object.values(estado.contas).filter((c) => c.tipo === 'cartao' && ids.has(c.pagaCom));
  const daFatura = (cartao) => {
    if (!porCartao.has(cartao.id)) porCartao.set(cartao.id, { cartao, valor: 0, recorrentes: 0, abatido: 0, vencimento: null, estimado: false });
    return porCartao.get(cartao.id);
  };
  // A fatura aberta de cada cartão e o que dela já é lançado/previsto, para o abatimento.
  const abertas = new Map();
  for (const c of cartoes) {
    const lista = faturas(estado, c.id, dia) ?? [];
    const aberta = lista.find((f) => f.situacao === 'aberta');
    if (aberta) abertas.set(c.id, { fechamento: aberta.fechamento, aPagar: aberta.aPagar, recorrentes: 0, vence: aberta.vencimento >= de && aberta.vencimento <= ate });
    for (const f of lista) {
      if (f.aPagar <= 0 || f.vencimento < de || f.vencimento > ate) continue;
      const x = daFatura(c);
      x.valor += f.aPagar;
      x.vencimento = f.vencimento;
    }
  }

  // Desde o mês atual: a compra recorrente de um mês cai na fatura que vence
  // no seguinte, e é pelo vencimento que ela pesa aqui.
  for (const o of ocorrenciasPrevistas(estado, inicioDoMes(dia), ate, dia)) {
    if (o.dataCaixa < de || o.dataCaixa > ate) continue;
    const cartao = estado.contas[o.contaId];
    if (cartao?.tipo === 'cartao') {
      if (!ids.has(cartao.pagaCom)) continue;
      // À parte da fatura: a fatura é o que já está nela (a linha do
      // extrato); a recorrente do cartão ainda vai entrar.
      const x = daFatura(cartao);
      x.recorrentes += sinalDeSaida(o);
      x.vencimento ??= o.dataCaixa;
      if (o.estimado) x.estimado = estimado = true;
      const aberta = abertas.get(cartao.id);
      if (aberta && o.cicloFatura === aberta.fechamento) aberta.recorrentes += sinalDeSaida(o);
      continue;
    }
    if (!ids.has(o.contaId) || ids.has(o.contaDestinoId)) continue;
    const saida = sinalDeSaida(o);
    if (saida <= 0) continue;
    if (estado.contas[o.contaDestinoId]?.tipo === 'divida') parcelas += saida;
    else recorrentes += saida;
    if (o.estimado) estimado = estimadoDespesas = true;
  }

  for (const l of visiveis(estado, dia)) {
    if (l.confirmado || l.dataCaixa < de || l.dataCaixa > ate) continue;
    if (!ids.has(l.contaId) || ids.has(l.contaDestinoId)) continue;
    const saida = sinalDeSaida(l);
    if (saida > 0) agendados += saida;
  }

  // O abatimento: o cofrinho cobre primeiro as fechadas que ainda faltam pagar,
  // e o que sobra abate a aberta — até o valor dela, nunca além.
  for (const [cartaoId, aberta] of abertas) {
    const x = porCartao.get(cartaoId);
    const cartao = estado.contas[cartaoId];
    if (!x || !aberta.vence || !temCofrinho(cartao)) continue;
    const prov = provisaoDoCartao(estado, cartaoId, dia);
    if (!prov) continue;
    const fechadas = (faturas(estado, cartaoId, dia) ?? []).filter((f) => f.situacao === 'fechada').reduce((t, f) => t + f.aPagar, 0);
    x.abatido = Math.max(0, Math.min(prov.provisionado - fechadas, aberta.aPagar + aberta.recorrentes));
  }

  const lista = [...porCartao.values()].filter((x) => x.valor > 0 || x.recorrentes > 0);
  const total = lista.reduce((t, x) => t + x.valor + x.recorrentes - x.abatido, 0) + recorrentes + parcelas + agendados;
  return { faturas: lista, recorrentes, parcelas, agendados, total, estimado, estimadoDespesas };
}

/** O que um mês seguinte deixa: entra − sai, sem o saldo de hoje. */
export function resultadoDoMes(estado, ids, mes, dia = hoje()) {
  const de = `${mes}-01`;
  const entra = entradasPrevistas(estado, ids, de, fimDoMes(de), dia);
  const sai = saidasDoMes(estado, ids, mes, dia);
  return { entra, sai, resultado: entra.total - sai.total, estimado: entra.estimado || sai.estimado };
}

/** O que ainda vai entrar no mês atual, para o "previsto com a renda". */
export function aEntrarNoMes(estado, ids, dia = hoje()) {
  return entradasPrevistas(estado, ids, inicioDoMes(dia), fimDoMes(dia), dia);
}
