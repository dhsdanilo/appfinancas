// A fila de pendências — R16. Não é relatório, é tarefa: o que faz o saldo
// mentir até alguém resolver. É a única parte do app que cobra, e cobra
// pendência, nunca comportamento (08-telas §6, princípio 4).
//
// Por ora entram os itens que já existem no app: vencidos, ocorrências de
// recorrência que ninguém lançou, fatura vencida e conta sem conferir. Os de
// envelope chegam com os envelopes (Fase 6).

import { hoje, somarDias } from './datas.js';
import { visiveis } from './lancamentos.js';
import { faturas, ocorrenciasVencidas } from './previsto.js';

/** Conta de caixa sem conferir há mais que isto vira pendência (03 §8). */
export const DIAS_SEM_CONFERIR = 31;

/**
 * Cada item: { tipo, chave, data, ... }
 *   'vencido'    → { lancamento }     — previsto cuja data passou
 *   'ocorrencia' → { ocorrencia }     — recorrência sem lançamento no mês
 *   'fatura'     → { cartao, fatura } — fatura fechada, vencida e não paga
 *   'conferir'   → { conta, desde }   — conta de caixa sem conferir há um mês
 * Da mais antiga para a mais nova: o que está atrasado há mais tempo primeiro.
 */
export function pendencias(estado, dia = hoje()) {
  const itens = [];

  for (const l of visiveis(estado)) {
    if (l.confirmado || l.dataCaixa > dia) continue;
    itens.push({ tipo: 'vencido', chave: `l:${l.id}`, data: l.dataCaixa, lancamento: l });
  }

  for (const o of ocorrenciasVencidas(estado, dia)) {
    // No cartão a compra é realizada na hora (D4): a ocorrência de cartão que
    // passou do dia é só um lançamento esquecido, e entra igual.
    itens.push({ tipo: 'ocorrencia', chave: o.id, data: o.dataCompetencia, ocorrencia: o });
  }

  for (const c of Object.values(estado.contas)) {
    if (c.tipo !== 'cartao') continue;
    for (const f of faturas(estado, c.id, dia) ?? []) {
      if (f.situacao !== 'fechada' || f.aPagar <= 0 || f.vencimento >= dia) continue;
      itens.push({ tipo: 'fatura', chave: `f:${c.id}:${f.fechamento}`, data: f.vencimento, cartao: c, fatura: f });
    }
  }

  const limite = somarDias(dia, -DIAS_SEM_CONFERIR);
  const usadas = new Set(visiveis(estado).flatMap((l) => [l.contaId, l.contaDestinoId]));
  for (const c of Object.values(estado.contas)) {
    if (c.arquivada || (c.tipo !== 'corrente' && c.tipo !== 'especie')) continue;
    if (!usadas.has(c.id)) continue;
    // Sem conferência, vale o marco zero: foi o último saldo que alguém olhou.
    const desde = c.conferidaEm ?? c.dataInicial;
    if (!desde || desde > limite) continue;
    itens.push({ tipo: 'conferir', chave: `c:${c.id}`, data: desde, conta: c });
  }

  return itens.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}
