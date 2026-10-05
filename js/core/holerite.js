// O holerite do mês, numa conta de folha (design/10 §2, D25).
//
// Não é entidade: é o conjunto das recorrências da conta de folha. Cada uma é
// uma linha — salário base, IR, previdência, consignado —, e o líquido é o que
// sobra, transferido para a conta corrente. Nada aqui é gravado: as linhas são
// as ocorrências previstas do mês, e o líquido é conta.

import { inicioDoMes, fimDoMes, hoje } from './datas.js';
import { visiveis, sinalDeSaida } from './lancamentos.js';
import { ocorrenciasPrevistas } from './previsto.js';

const ORDEM = { receita: 0, obrigatoria: 1, despesa: 2, transferencia: 3 };

/** A ordem do papel: o que entra, o obrigatório, o resto, e o que vai para outra conta. */
function lugar(estado, l) {
  if (l.tipo === 'receita') return ORDEM.receita;
  if (l.tipo === 'despesa') return estado.categorias[l.categoriaId]?.obrigatoria ? ORDEM.obrigatoria : ORDEM.despesa;
  return ORDEM.transferencia;
}

/**
 * As linhas que faltam lançar no holerite de `mes` ('2026-10'): as ocorrências
 * das séries da folha que ninguém lançou ainda. A transferência do líquido fica
 * de fora — ela é calculada, não prevista.
 */
export function linhasDoHolerite(estado, folhaId, mes, dia = hoje()) {
  const folha = estado.contas[folhaId];
  if (!folha) return [];
  const inicio = `${mes}-01`;
  return ocorrenciasPrevistas(estado, inicioDoMes(inicio), fimDoMes(inicio), dia, { comPassado: true })
    .filter((o) => o.contaId === folhaId)
    .filter((o) => !(o.tipo === 'transferencia' && o.contaDestinoId === folha.liquidoPara))
    .sort((a, b) => lugar(estado, a) - lugar(estado, b));
}

/** O que já foi lançado na folha naquele mês — para dizer "lançado" em vez de oferecer de novo. */
export function lancadosNoMes(estado, folhaId, mes, dia = hoje()) {
  return visiveis(estado, dia).filter(
    (l) => (l.contaId === folhaId || l.contaDestinoId === folhaId) && l.dataCompetencia.slice(0, 7) === mes
  );
}

/**
 * O líquido: o que entra menos o que sai para descontos e outras contas.
 * Recebe linhas no formato { tipo, valor }.
 */
export function liquido(linhas) {
  return linhas.reduce((t, l) => t - sinalDeSaida(l), 0);
}

/**
 * O que já foi lançado na folha no mês, em termos de líquido: o que saiu das
 * linhas lançadas e o que entrou nela vindo de outra conta. O holerite fecha o
 * mês inteiro, então o líquido novo é só o que falta para ela zerar.
 */
export function jaLancadoNoLiquido(estado, folhaId, mes, dia = hoje()) {
  const ja = lancadosNoMes(estado, folhaId, mes, dia);
  return liquido(ja.filter((l) => l.contaId === folhaId))
    + ja.filter((l) => l.contaDestinoId === folhaId).reduce((t, l) => t + l.valor, 0);
}

/**
 * O líquido que a folha ainda vai mandar no `mes` (design/08 §4.2, D31): as
 * linhas do contracheque que faltam lançar mais o que já foi lançado — a mesma
 * conta da janela do contracheque. Cai no dia da primeira linha de entrada,
 * na conta para onde o líquido vai. Null quando não há o que prever: folha sem
 * destino, ou o contracheque do mês já lançado.
 *
 * { folhaId, contaId, data, valor, estimado }
 */
export function liquidoPrevisto(estado, folhaId, mes, dia = hoje()) {
  const folha = estado.contas[folhaId];
  if (!folha || folha.arquivada || !folha.liquidoPara) return null;
  const previstas = linhasDoHolerite(estado, folhaId, mes, dia);
  // Só a parcela do consignado sobrando não é contracheque por lançar.
  if (!previstas.some((o) => !o.automatico)) return null;
  const valor = liquido(previstas) + jaLancadoNoLiquido(estado, folhaId, mes, dia);
  if (valor <= 0) return null;
  return {
    folhaId,
    contaId: folha.liquidoPara,
    data: previstas[0].dataCompetencia,
    valor,
    estimado: previstas.some((o) => o.estimado),
  };
}

/**
 * Renda bruta e líquida das folhas num conjunto de lançamentos (pedido dele,
 * 03/10/2026). Bruta: o que entrou. Líquida: o que sobra para cair na conta —
 * a bruta menos todo desconto e menos o que sai da folha para outra coisa que
 * não seja caixa (o consignado, a previdência que vira investimento). O
 * líquido transferido para a corrente não desconta: ele É a renda líquida.
 */
export function rendaDaFolha(estado, lancamentos, folhaIds) {
  const caixa = (id) => ['corrente', 'especie'].includes(estado.contas[id]?.tipo);
  let bruta = 0;
  let descontos = 0;
  // Os empréstimos (consignado) à parte dos descontos: é dívida, não imposto
  // nem plano de saúde (pedido dele, 03/10/2026).
  let emprestimos = 0;
  for (const l of lancamentos) {
    if (!folhaIds.has(l.contaId)) continue;
    if (l.tipo === 'receita') bruta += l.valor;
    else if (l.tipo === 'despesa') descontos += l.valor;
    else if (l.contaDestinoId && !folhaIds.has(l.contaDestinoId) && !caixa(l.contaDestinoId)) {
      if (estado.contas[l.contaDestinoId]?.tipo === 'divida') emprestimos += l.valor;
      else descontos += l.valor;
    }
  }
  return { bruta, descontos, emprestimos, liquida: bruta - descontos - emprestimos };
}

/** Renda disponível de um conjunto de lançamentos: receitas menos obrigatórias (D25). */
export function rendaDisponivel(estado, lancamentos) {
  let renda = 0;
  for (const l of lancamentos) {
    if (l.tipo === 'receita') renda += l.valor;
    if (l.tipo === 'despesa' && estado.categorias[l.categoriaId]?.obrigatoria) renda -= l.valor;
  }
  return renda;
}
