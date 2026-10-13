// As parcelas automáticas dos contratos de dívida (design/10 §4.4).
//
// A parcela é débito automático por natureza: no dia do vencimento ela já
// aconteceu, na conta que paga. Por isso não é gravada nem passa pela fila —
// sai do contrato, como a fatura sai das compras. O que se grava é a exceção,
// na própria dívida: a parcela corrigida (`parcelasCorrigidas`, que continua
// automática) e a que não foi debitada (`parcelasPuladas`).
//
// O que venceu antes do MÊS da inclusão não entra: o empréstimo antigo já está
// no saldo da conta que paga, e repetir as parcelas dele seria cobrar duas
// vezes. O mês corrente conta inteiro (pedido dele, 03/10/2026): cadastrado no
// dia 3, a parcela do dia 1 cai — o mês é a unidade em que ele pensa.

import { calendarioDePagamento } from './contrato.js';
import { datarNoCartao } from './cartao.js';
import { inicioDoMes } from './datas.js';

/** As amortizações que valem: as que não tiveram a transferência apagada. */
export function amortizacoesValidas(estado, conta) {
  return (conta.amortizacoes ?? []).filter((a) => !a.lancamentoId || (estado.lancamentos[a.lancamentoId] && !estado.lancamentos[a.lancamentoId].removido));
}

/** O calendário de uma dívida, já com as amortizações que valem. */
export function calendarioDaDivida(estado, conta) {
  return calendarioDePagamento(conta?.contrato, conta ? amortizacoesValidas(estado, conta) : []);
}

/**
 * A partir de que dia a parcela cai sozinha: o dia 1 do mês da inclusão — mas
 * nunca antes do marco zero da conta que paga, porque o saldo informado ali já
 * tinha descontado o que veio antes.
 */
export function caiAPartirDe(estado, conta, pagaCom = conta.pagaCom) {
  const pagadora = estado.contas[pagaCom];
  const inclusao = conta.contrato?.incluidoEm ?? conta.dataInicial ?? '';
  const mes = inclusao ? inicioDoMes(inclusao) : '';
  const marco = pagadora?.dataInicial ?? '';
  return mes > marco ? mes : marco;
}

/**
 * As versões do contrato, da mais antiga à atual: [{ desde, ate, contrato, pagaCom }].
 * Cada uma vale para as parcelas com data em (desde, ate]; a atual não tem fim.
 * Mudar "daqui pra frente" guarda a anterior (redutor `conta.alterada`).
 */
export function versoesDoContrato(conta) {
  const versoes = [];
  let desde = '';
  for (const h of conta.historicoContrato ?? []) {
    versoes.push({ desde, ate: h.ate, contrato: h.contrato, pagaCom: h.pagaCom });
    if (h.ate > desde) desde = h.ate;
  }
  versoes.push({ desde, ate: null, contrato: conta.contrato, pagaCom: conta.pagaCom ?? null });
  return versoes;
}

/**
 * Depois de que dia nenhuma parcela cai mais: a dívida quitada no banco (a
 * última foto do saldo é zero) ou arquivada. Null: segue o calendário.
 */
export function fimDasParcelas(conta) {
  const fotos = conta.fotos ?? [];
  const ultima = fotos[fotos.length - 1];
  const quitadaEm = ultima && ultima.valor <= 0 ? ultima.data : null;
  const arquivadaEm = conta.arquivada ? conta.arquivadaEm ?? null : null;
  if (quitadaEm && arquivadaEm) return quitadaEm < arquivadaEm ? quitadaEm : arquivadaEm;
  return quitadaEm ?? arquivadaEm;
}

const memoria = new WeakMap();

/**
 * Todas as parcelas automáticas de todos os contratos, do dia seguinte à
 * inclusão até a última — realizadas e por vir. `confirmado` diz qual é qual
 * no `dia`.
 *
 * @param {object} estado
 * @param {object[]} lancados  os lançamentos gravados e não removidos
 * @param {string} dia
 */
export function parcelasAutomaticas(estado, lancados, dia) {
  // Cálculo puro sobre o estado: enquanto nenhum evento novo entrou, a
  // resposta é a mesma. `aplicados` conta os eventos; sem ele, não guarda.
  // Guarda um resultado por dia: quem percorre o tempo (a evolução dos
  // envelopes, o mês dos investimentos) pede muitos dias seguidos.
  const guardavel = typeof estado.aplicados === 'number';
  let antes = guardavel ? memoria.get(estado) : null;
  if (antes && (antes.aplicados !== estado.aplicados || antes.qtd !== lancados.length)) antes = null;
  if (antes?.porDia.has(dia)) return antes.porDia.get(dia);

  const lista = [];
  for (const conta of Object.values(estado.contas)) {
    if (conta.tipo !== 'divida' || !conta.contrato) continue;
    const fim = fimDasParcelas(conta);
    const puladas = new Set(conta.parcelasPuladas ?? []);
    const serieAntiga = conta.contrato.recorrenciaId ?? null;
    // Parcela que já tem lançamento de verdade — corrigida pela linha, ou
    // lançada pela série da primeira versão — não se repete.
    const cobertas = new Set();
    const mesesDaSerie = new Set();
    for (const l of lancados) {
      if (l.parcelaDe?.dividaId === conta.id) cobertas.add(l.parcelaDe.k);
      if (serieAntiga && l.recorrenciaId === serieAntiga) mesesDaSerie.add(l.dataCompetencia.slice(0, 7));
    }
    const corrigidas = conta.parcelasCorrigidas ?? {};
    const total = calendarioDaDivida(estado, conta).length;
    // Cada versão do contrato dá as parcelas da sua janela, na conta que pagava então.
    const daJanela = [];
    for (const [n, v] of versoesDoContrato(conta).entries()) {
      const pagadora = estado.contas[v.pagaCom];
      if (!pagadora || !v.contrato) continue;
      const desde = caiAPartirDe(estado, conta, v.pagaCom);
      for (const p of calendarioDePagamento(v.contrato, amortizacoesValidas(estado, conta))) {
        if (p.data <= v.desde || (v.ate && p.data > v.ate) || p.data < desde) continue;
        daJanela.push({ p, pagadora, versao: n });
      }
    }
    const usados = new Set();
    for (const { p, pagadora, versao } of daJanela) {
      if (fim && p.data > fim) continue;
      if (puladas.has(p.k) || cobertas.has(p.k)) continue;
      if (mesesDaSerie.has(p.data.slice(0, 7))) continue;
      const correcao = corrigidas[p.k] ?? null;
      const data = correcao?.data ?? p.data;
      const quemPaga = estado.contas[correcao?.contaId] ?? pagadora;
      // Contrato que andou o calendário (carência) pode repetir um número entre versões.
      const id = usados.has(p.k) ? `auto:${conta.id}:${p.k}:v${versao}` : `auto:${conta.id}:${p.k}`;
      usados.add(p.k);
      const l = {
        id,
        automatico: true,
        parcelaDe: { dividaId: conta.id, k: p.k, total },
        corrigida: Boolean(correcao),
        valorDoContrato: p.valor,
        tipo: 'transferencia',
        valor: correcao?.valor ?? p.valor,
        dataCompetencia: data,
        dataCaixa: data,
        dataVencimento: data,
        contaId: quemPaga.id,
        contaDestinoId: conta.id,
        categoriaId: null,
        detalheId: null,
        etiquetas: [],
        observacao: '',
        confirmado: data <= dia,
        origemValor: 'digitado',
        recorrenciaId: null,
        parcela: null,
        cicloFatura: null,
        removido: false,
      };
      // Paga com o cartão: a parcela é uma compra na fatura do mês dela.
      datarNoCartao(l, quemPaga);
      lista.push(l);
    }
  }

  if (guardavel) {
    if (!antes) { antes = { aplicados: estado.aplicados, qtd: lancados.length, porDia: new Map() }; memoria.set(estado, antes); }
    antes.porDia.set(dia, lista);
  }
  return lista;
}

/**
 * A parcela automática de uma dívida que cai no mês `mes` (AAAA-MM), se ainda
 * não está coberta por um lançamento — a que uma transferência feita à mão
 * naquele mês pode estar pagando.
 */
export function parcelaAutomaticaDoMes(estado, lancados, dividaId, mes, dia) {
  return parcelasAutomaticas(estado, lancados, dia)
    .find((l) => l.parcelaDe.dividaId === dividaId && l.dataCompetencia.slice(0, 7) === mes) ?? null;
}

/**
 * Transferências feitas à mão para uma dívida com contrato, no mesmo mês em
 * que a parcela automática também cai: a parcela provavelmente saiu duas vezes.
 * Amortização e a série da primeira versão não contam. [{ divida, lancamento, parcela }]
 */
export function parcelasEmDobro(estado, lancados, dia) {
  const saida = [];
  for (const l of lancados) {
    if (l.tipo !== 'transferencia' || l.parcelaDe || !l.contaDestinoId) continue;
    const divida = estado.contas[l.contaDestinoId];
    if (divida?.tipo !== 'divida' || !divida.contrato) continue;
    if ((divida.amortizacoes ?? []).some((a) => a.lancamentoId === l.id)) continue;
    if (divida.contrato.recorrenciaId && l.recorrenciaId === divida.contrato.recorrenciaId) continue;
    const parcela = parcelaAutomaticaDoMes(estado, lancados, divida.id, l.dataCompetencia.slice(0, 7), dia);
    if (parcela) saida.push({ divida, lancamento: l, parcela });
  }
  return saida;
}
