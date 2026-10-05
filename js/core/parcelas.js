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
export function caiAPartirDe(estado, conta) {
  const pagadora = estado.contas[conta.pagaCom];
  const inclusao = conta.contrato?.incluidoEm ?? conta.dataInicial ?? '';
  const mes = inclusao ? inicioDoMes(inclusao) : '';
  const marco = pagadora?.dataInicial ?? '';
  return mes > marco ? mes : marco;
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
    if (conta.tipo !== 'divida' || !conta.contrato || !conta.pagaCom) continue;
    const pagadora = estado.contas[conta.pagaCom];
    if (!pagadora) continue;
    const desde = caiAPartirDe(estado, conta);
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
    const calendario = calendarioDaDivida(estado, conta);
    const total = calendario.length;
    for (const p of calendario) {
      if (p.data < desde || puladas.has(p.k) || cobertas.has(p.k)) continue;
      if (mesesDaSerie.has(p.data.slice(0, 7))) continue;
      const correcao = corrigidas[p.k] ?? null;
      const data = correcao?.data ?? p.data;
      const quemPaga = estado.contas[correcao?.contaId] ?? pagadora;
      const l = {
        id: `auto:${conta.id}:${p.k}`,
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
