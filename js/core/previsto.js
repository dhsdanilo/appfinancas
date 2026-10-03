// O que ainda não aconteceu: faturas a pagar, ocorrências de recorrência que
// ninguém lançou, e o saldo previsto que sai dos dois.
//
// Nada daqui é gravado. A fatura é cálculo sobre as compras (02 §3.8) e a
// ocorrência é cálculo sobre a série (R14 as quer calculadas, nunca gravadas):
// guardar qualquer um dos dois abriria a porta pro número que não bate com a
// origem dele.

import { hoje, inicioDoMes, fimDoMes, diaNoMes, proximoMes, somarMeses } from './datas.js';
import { temCiclo, cicloDaCompra, vencimentoDoCiclo } from './cartao.js';
import { visiveis, lancados, parcelasPorVir, saldoReal, sinalDeSaida } from './lancamentos.js';

// ── faturas ───────────────────────────────────────────────────────────────

/**
 * As faturas de um cartão, da mais antiga para a mais nova.
 *
 * Cada uma: { fechamento, vencimento, total, pago, aPagar, situacao, itens }
 * situacao: 'fechada' (já fechou) · 'aberta' (a que se forma hoje) · 'futura'
 * (só parcelas, ainda por vir).
 *
 * O pagamento quita a mais antiga primeiro — a ordem do banco, e a que dispensa
 * perguntar "qual fatura você está pagando" (03-alimentacao §6.2). Conta o
 * pagamento agendado também: ele já é compromisso da corrente, e contar a
 * fatura cheia ao lado dele seria cobrar duas vezes.
 *
 * Devolve null para cartão sem ciclo configurado.
 */
export function faturas(estado, cartaoId, dia = hoje()) {
  const conta = estado.contas[cartaoId];
  if (!temCiclo(conta)) return null;

  const porCiclo = new Map();
  // O vencimento de uma fatura é o que as compras dela guardaram: se o dia de
  // vencimento mudou depois que ela fechou, ela continua vencendo quando o
  // banco disse (03-alimentacao §6.2). Só a fatura sem compra calcula.
  const ciclo = (fechamento, vencimento = null) => {
    if (!porCiclo.has(fechamento)) {
      porCiclo.set(fechamento, {
        fechamento,
        vencimento: vencimento ?? vencimentoDoCiclo(conta, fechamento),
        total: 0,
        itens: [],
      });
    }
    return porCiclo.get(fechamento);
  };

  const doCartao = visiveis(estado, dia);
  for (const l of doCartao) {
    if (l.contaId === cartaoId && l.cicloFatura) ciclo(l.cicloFatura, l.dataVencimento);
  }

  const aberta = cicloDaCompra(conta, dia).fechamento;
  ciclo(aberta);

  // O que já estava na fatura quando o cartão entrou no app (02 §3.2).
  if (conta.saldoInicial) {
    ciclo(cicloDaCompra(conta, conta.dataInicial ?? dia).fechamento).total -= conta.saldoInicial;
  }

  let pago = 0;
  for (const l of doCartao) {
    if (l.contaId === cartaoId && l.cicloFatura) {
      const c = ciclo(l.cicloFatura);
      c.total += sinalDeSaida(l);
      c.itens.push(l);
    } else if (l.contaDestinoId === cartaoId) {
      pago += l.valor;
    }
  }

  const lista = [...porCiclo.values()].sort((a, b) => (a.fechamento < b.fechamento ? -1 : 1));

  // Fatura com mais estorno que compra é crédito, e abate as outras como se
  // fosse pagamento.
  let resta = pago + lista.reduce((t, c) => t + Math.max(0, -c.total), 0);
  for (const c of lista) {
    const devido = Math.max(0, c.total);
    c.pago = Math.min(devido, resta);
    resta -= c.pago;
    c.aPagar = devido - c.pago;
    c.situacao = c.fechamento <= dia ? 'fechada' : c.fechamento === aberta ? 'aberta' : 'futura';
  }
  return lista;
}

/** O resumo que o cartão mostra: fechada a pagar, aberta, dívida e limite livre. */
export function resumoDoCartao(estado, cartaoId, dia = hoje()) {
  const conta = estado.contas[cartaoId];
  const lista = faturas(estado, cartaoId, dia);
  if (!lista) return null;

  const fechadas = lista.filter((c) => c.situacao === 'fechada' && c.aPagar > 0);
  const aberta = lista.find((c) => c.situacao === 'aberta');
  const divida = lista.reduce((t, c) => t + c.aPagar, 0);
  return {
    fechada: fechadas.length
      ? {
          aPagar: fechadas.reduce((t, c) => t + c.aPagar, 0),
          // A que vence primeiro é a que manda: é dela o prazo.
          vencimento: fechadas[0].vencimento,
          atrasada: fechadas[0].vencimento < dia,
        }
      : null,
    aberta,
    divida,
    limiteLivre: conta.limite ? conta.limite - divida : null,
  };
}

/**
 * Quanto do cartão pesa na conta que o paga: as fechadas que faltam e a
 * aberta, mesmo que ela só vença no mês seguinte (decidido 03/10/2026).
 * As parcelas das faturas futuras ficam fora — ainda não estão em fatura
 * nenhuma.
 */
export function aPagarAgora(estado, cartaoId, dia = hoje()) {
  const lista = faturas(estado, cartaoId, dia);
  if (!lista) return 0;
  return lista
    .filter((c) => c.situacao !== 'futura')
    .reduce((t, c) => t + c.aPagar, 0);
}

// ── recorrências ──────────────────────────────────────────────────────────

/**
 * As ocorrências de recorrência que ainda não foram lançadas, entre `de` e
 * `ate`. Nunca antes do mês corrente: mês que passou sem lançamento é assunto
 * da fila de vencidos (§5), não de projeção.
 *
 * O mês está coberto quando existe lançamento da série com competência nele —
 * é o que faz a ocorrência sumir assim que alguém lança a conta de luz.
 */
export function ocorrenciasPrevistas(estado, de, ate, dia = hoje(), { comPassado = false } = {}) {
  const piso = comPassado || de > inicioDoMes(dia) ? de : inicioDoMes(dia);
  if (piso > ate) return [];

  const todos = lancados(estado);
  const saida = [];
  // A série que a primeira versão do contrato criava deixou de projetar: a
  // parcela agora sai do próprio contrato (design/10 §4.4).
  const seriesDeContrato = new Set(
    Object.values(estado.contas).map((c) => c.contrato?.recorrenciaId).filter(Boolean)
  );
  for (const r of Object.values(estado.recorrencias ?? {})) {
    const periodicidade = r.periodicidade ?? 'mensal';
    if (r.arquivada || seriesDeContrato.has(r.id) || (periodicidade !== 'mensal' && periodicidade !== 'anual')) continue;
    // Anual (IPVA, seguro, matrícula): uma vez por ano, no mês do início.
    const mesDoAno = periodicidade === 'anual' && r.inicio ? Number(r.inicio.slice(5, 7)) : null;
    const conta = estado.contas[r.contaId];
    if (!conta || conta.arquivada) continue;

    const daSerie = todos.filter((l) => l.recorrenciaId === r.id);
    // O mês que vem nasce igual ao último lançado: as etiquetas e a descrição
    // dele (pedido dele, 03/10/2026). Mudou em outubro, novembro acompanha.
    const ultimo = daSerie.reduce((u, l) => (!u || l.dataCompetencia >= u.dataCompetencia ? l : u), null);
    const cobertos = new Set([
      ...daSerie.map((l) => l.dataCompetencia.slice(0, 7)),
      ...(r.pulados ?? []),
    ]);
    for (let mes = piso.slice(0, 7); mes <= ate.slice(0, 7); mes = proximoMes(mes)) {
      const [ano, m] = mes.split('-').map(Number);
      if (mesDoAno && m !== mesDoAno) continue;
      const data = diaNoMes(ano, m, r.dia ?? 1);
      // O valor do mês: com reajuste, cada mês usa o que valia nele.
      const { valor, estimado, origem } = valorDaSerie(r, daSerie, data);
      if (!valor) continue;
      if (data < piso || data > ate) continue;
      if (r.inicio && data < r.inicio) continue;
      if (r.fim && data > r.fim) continue;
      if (cobertos.has(mes)) continue;

      const ciclo = temCiclo(conta) ? cicloDaCompra(conta, data) : null;
      saida.push({
        id: `previsto:${r.id}:${mes}`,
        projetado: true,
        recorrenciaId: r.id,
        tipo: r.tipo,
        valor,
        estimado,
        contaId: r.contaId,
        contaDestinoId: r.contaDestinoId ?? null,
        categoriaId: r.categoriaId ?? null,
        detalheId: ultimo?.detalheId ?? r.detalheId ?? null,
        etiquetas: [...(ultimo?.etiquetas ?? r.etiquetas ?? [])],
        origemValor: origem,
        dataCompetencia: data,
        dataCaixa: ciclo ? ciclo.vencimento : data,
        dataVencimento: ciclo ? ciclo.vencimento : data,
        cicloFatura: ciclo ? ciclo.fechamento : null,
        confirmado: false,
        parcela: null,
      });
    }
  }
  // As parcelas de dívida que ainda vão cair. Previstas, mas nunca pendência:
  // no dia, caem sozinhas (design/10 §4.4).
  for (const p of parcelasPorVir(estado, piso, ate, dia)) {
    saida.push({ ...p, projetado: true, estimado: false });
  }
  return saida;
}

/**
 * Fixa: o valor travado. Estimada (E2, prudente): despesa pela MÉDIA das
 * últimas 3 cobranças, receita pelo PISO — a menor delas. Subestimar a entrada
 * e superestimar a saída é prudência; o contrário é como se endivida sem
 * perceber. Estimativa aparece sempre com ~.
 */
export function valorDaSerie(r, daSerie, data = hoje()) {
  if (r.tipoValor === 'fixa' && (r.valores?.length || r.valor)) {
    return { valor: valorVigente(r, data), estimado: false, origem: 'digitado' };
  }
  const ultimas = [...daSerie]
    .sort((a, b) => (a.dataCompetencia < b.dataCompetencia ? 1 : -1))
    .slice(0, 3);
  if (r.tipo === 'receita') {
    if (!ultimas.length) return { valor: r.valor ?? 0, estimado: true, origem: 'estimado_piso' };
    return { valor: Math.min(...ultimas.map((l) => l.valor)), estimado: true, origem: 'estimado_piso' };
  }
  if (!ultimas.length) return { valor: r.valor ?? 0, estimado: true, origem: 'estimado_media' };
  const soma = ultimas.reduce((t, l) => t + l.valor, 0);
  return { valor: Math.round(soma / ultimas.length), estimado: true, origem: 'estimado_media' };
}

// ── saldo previsto ────────────────────────────────────────────────────────

/**
 * O saldo previsto de uma conta de caixa (corrente ou espécie), aberto em
 * linhas — porque o número sozinho não é crível (08-telas §6):
 *
 *   saldo real
 *   − cada fatura que ela paga (fechada + aberta, ainda não pagas)
 *   − recorrentes e agendados até o fim do mês
 *   = saldo previsto
 *
 * Só subtrai: receita futura não entra, porque dinheiro que ainda não chegou
 * não deve parecer disponível.
 */
export function saldoPrevisto(estado, contaId, dia = hoje()) {
  const real = saldoReal(estado, contaId);
  const ate = fimDoMes(dia);

  const faturasDaConta = Object.values(estado.contas)
    .filter((c) => c.tipo === 'cartao' && c.pagaCom === contaId)
    .map((c) => ({ cartao: c, valor: aPagarAgora(estado, c.id, dia) }))
    .filter((f) => f.valor > 0);

  // Agendados e vencidos: o que foi lançado e ainda não saiu.
  let aSair = 0;
  for (const l of visiveis(estado, dia)) {
    if (l.confirmado || l.contaId !== contaId || l.dataCaixa > ate) continue;
    const saida = sinalDeSaida(l);
    if (saida > 0) aSair += saida;
  }

  // Recorrentes: as da própria conta e as dos cartões que ela paga.
  const cartoes = new Set(faturasDaConta.map((f) => f.cartao.id));
  for (const c of Object.values(estado.contas)) {
    if (c.tipo === 'cartao' && c.pagaCom === contaId) cartoes.add(c.id);
  }
  let estimado = false;
  for (const o of ocorrenciasPrevistas(estado, inicioDoMes(dia), ate, dia)) {
    if (o.contaId !== contaId && !cartoes.has(o.contaId)) continue;
    const saida = sinalDeSaida(o);
    if (saida <= 0) continue;
    aSair += saida;
    if (o.estimado) estimado = true;
  }

  const totalFaturas = faturasDaConta.reduce((t, f) => t + f.valor, 0);
  return {
    real,
    faturas: faturasDaConta,
    aSair,
    ate,
    estimado,
    previsto: real - totalFaturas - aSair,
  };
}

/**
 * As ocorrências que já deviam ter acontecido e ninguém lançou: a parte
 * "vencido" das recorrências, para a fila de pendências (R16). Olha no máximo
 * um ano para trás — série esquecida há mais tempo é assunto da tela de
 * recorrências, não da fila.
 */
export function ocorrenciasVencidas(estado, dia = hoje()) {
  const de = inicioDoMes(somarMeses(dia, -12));
  return ocorrenciasPrevistas(estado, de, dia, dia, { comPassado: true });
}

/**
 * O valor de uma série fixa numa data: o último reajuste que já valia nela.
 * Antes do primeiro, o primeiro — a série não tem valor "de antes de existir".
 */
export function valorVigente(r, data = hoje()) {
  const valores = r.valores?.length ? r.valores : [{ desde: r.inicio ?? '', valor: r.valor }];
  const valendo = valores.filter((v) => v.desde <= data);
  return (valendo[valendo.length - 1] ?? valores[0]).valor;
}

/** O reajuste agendado, se houver: o primeiro valor que passa a valer depois de `data`. */
export function proximoReajuste(r, data = hoje()) {
  return (r.valores ?? []).find((v) => v.desde > data) ?? null;
}

/** O último reajuste que já valeu, com o valor de antes dele. */
export function ultimoReajuste(r, data = hoje()) {
  const valores = (r.valores ?? []).filter((v) => v.desde <= data);
  if (valores.length < 2) return null;
  return { ...valores[valores.length - 1], antes: valores[valores.length - 2].valor };
}
