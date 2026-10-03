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
export function lancadosNoMes(estado, folhaId, mes) {
  return visiveis(estado).filter(
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
