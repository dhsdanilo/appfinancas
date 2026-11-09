// A classificação de um lançamento para filtrar a lista (pedido dele, 09/11/2026):
//   despesas       — gasto (e a devolução, que abate o gasto)
//   receitas       — ganho
//   movimentacoes  — dinheiro que só muda de lugar: transferências e pagamento de fatura, aplicações, resgates e
//                    proventos, ajuste de caixa, a renda que chega (o líquido da folha) e a fatura prevista

import { ehTransferencia, ehDeInvestimento } from './lancamentos.js';

export const CLASSES = [
  { id: '', nome: 'Todas' },
  { id: 'despesas', nome: 'Despesas' },
  { id: 'receitas', nome: 'Receitas' },
  { id: 'movimentacoes', nome: 'Movimentações', dica: 'Aplicações, resgates, renda recebida e transferências' },
];

export function classeDoLancamento(l) {
  if (l.fatura || l.liquido) return 'movimentacoes';
  if (ehTransferencia(l) || ehDeInvestimento(l) || l.tipo === 'ajuste_caixa') return 'movimentacoes';
  if (l.tipo === 'receita') return 'receitas';
  return 'despesas';
}
