// Lançar uma ocorrência de recorrência como ela veio — o "Confirmar" da fila
// de pendências e o ✓ da linha prevista no extrato (pedido dele, 03/10/2026).
// Um toque; abrir o formulário fica para quando algo mudou.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';

/**
 * @param {object} o  a ocorrência prevista (js/core/previsto.js)
 * @param {{ valor?: number, confirmado?: boolean, dataCaixa?: string }} [opcoes]
 */
export async function lancarOcorrencia(o, { valor = o.valor, confirmado = true, dataCaixa = o.dataCompetencia } = {}) {
  const ap = await log.aparelho();
  await estado.aplicarEvento('lancamento.registrado', {
    id: novoId('lan'),
    tipo: o.tipo,
    valor,
    contaId: o.contaId,
    contaDestinoId: o.contaDestinoId,
    categoriaId: o.categoriaId,
    detalheId: o.detalheId,
    etiquetas: [...(o.etiquetas ?? [])],
    recorrenciaId: o.recorrenciaId,
    dataCompetencia: o.dataCompetencia,
    dataCaixa,
    confirmado,
    // O estimado e o realizado ficam os dois: sem isso a R18 é impossível
    // de reconstruir depois (03 §5).
    origemValor: valor === o.valor ? o.origemValor ?? 'digitado' : 'digitado',
    valorEstimadoOriginal: o.estimado ? o.valor : null,
    lancadoPor: ap?.id ?? null,
  });
}
