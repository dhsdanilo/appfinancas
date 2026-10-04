// As contas fixas que caem sozinhas (design/13 §1): a recorrência marcada
// "cai sozinha" vira lançamento realizado no dia, sem o ✓.
//
// Diferente da parcela do contrato, este lançamento é GRAVADO: é conta de
// verdade (a luz veio diferente? corrige-se a linha). O id é sempre o mesmo
// para aquela série naquele mês — se os dois celulares o criarem, é o mesmo
// lançamento, e nada duplica. Vale do dia em que se ligou em diante.

import { hoje } from './datas.js';
import { ocorrenciasPrevistas } from './previsto.js';
import { tipoDaTransferencia } from './lancamentos.js';

/** O id do lançamento automático de uma série num mês. */
export const idAutomatico = (recorrenciaId, mes) => `auto-rec:${recorrenciaId}:${mes}`;

/**
 * Os lançamentos que já deviam ter caído sozinhos e ainda não existem, prontos
 * para gravar (os dados do evento `lancamento.registrado`).
 */
export function automaticasPendentes(estado, dia = hoje()) {
  const series = Object.values(estado.recorrencias ?? {}).filter((r) => r.caiSozinha && r.caiSozinhaDesde && !r.arquivada);
  if (!series.length) return [];
  const desde = series.map((r) => r.caiSozinhaDesde).sort()[0];
  if (desde > dia) return [];
  const porId = new Map(series.map((r) => [r.id, r]));
  const saida = [];
  for (const o of ocorrenciasPrevistas(estado, desde, dia, dia, { comPassado: true })) {
    const r = porId.get(o.recorrenciaId);
    if (!r || o.dataCompetencia < r.caiSozinhaDesde || o.dataCompetencia > dia) continue;
    const id = idAutomatico(r.id, o.dataCompetencia.slice(0, 7));
    // Já existe (ou existiu e foi apagado de propósito): não volta.
    if (estado.lancamentos[id]) continue;
    const tipo = o.tipo === 'transferencia' ? tipoDaTransferencia(estado, o.contaDestinoId) : o.tipo;
    saida.push({
      id,
      tipo,
      valor: o.valor,
      contaId: o.contaId,
      contaDestinoId: o.contaDestinoId ?? null,
      categoriaId: o.categoriaId ?? null,
      detalheId: o.detalheId ?? null,
      etiquetas: o.etiquetas ?? [],
      recorrenciaId: r.id,
      dataCompetencia: o.dataCompetencia,
      dataCaixa: o.dataCompetencia,
      confirmado: true,
      origemValor: o.origemValor ?? 'digitado',
      valorEstimadoOriginal: o.estimado ? o.valor : null,
      caiuSozinha: true,
    });
  }
  return saida;
}
