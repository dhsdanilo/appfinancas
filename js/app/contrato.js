// Gravar o contrato de uma dívida e manter a série das parcelas (design/10 §4).
//
// A série é uma recorrência comum: transferência de quem paga (corrente,
// cartão ou folha) para a dívida. É ela que faz a parcela pesar no saldo
// previsto de quem paga e, na folha, virar linha do holerite (consignado).

import * as estado from '../core/estado.js';
import { novoId } from '../core/id.js';
import { hoje, inicioDoMes } from '../core/datas.js';
import { calendario } from '../core/divida.js';

/**
 * Parcelas que venceram antes deste mês não viram pendência: o contrato pode
 * ter começado anos antes de o app existir. A série começa na primeira parcela
 * deste mês em diante.
 */
function inicioDaSerie(contrato) {
  const piso = inicioDoMes(hoje());
  return calendario(contrato).find((d) => d >= piso) ?? null;
}

/**
 * @param {object} app            o estado atual
 * @param {string} contaId        a conta de dívida
 * @param {object} contrato       { valorTomado, data, parcelas, valorParcela, primeira, taxa }
 * @param {string|null} pagaCom   a conta que paga
 */
export async function salvarContrato(app, contaId, contrato, pagaCom) {
  const conta = app.contas[contaId];
  const anterior = conta.contrato;
  const serieId = anterior?.recorrenciaId ?? null;
  const serieExiste = serieId && app.recorrencias[serieId];
  const inicio = inicioDaSerie(contrato);
  const fim = calendario(contrato).pop();

  const dadosDaSerie = {
    nome: `Parcela · ${conta.nome}`,
    tipo: 'transferencia',
    contaId: pagaCom,
    contaDestinoId: contaId,
    categoriaId: null,
    tipoValor: 'fixa',
    valor: contrato.valorParcela,
    periodicidade: 'mensal',
    dia: Number(contrato.primeira.slice(8, 10)),
    inicio,
    fim,
  };

  let recorrenciaId = serieExiste ? serieId : null;
  if (pagaCom && inicio) {
    if (serieExiste) {
      const r = app.recorrencias[serieId];
      const mudou = Object.fromEntries(Object.entries(dadosDaSerie).filter(([k, v]) => (r[k] ?? null) !== v));
      // A série encerrada continua encerrada; o resto acompanha o contrato.
      if (Object.keys(mudou).length) await estado.aplicarEvento('recorrencia.alterada', { id: serieId, ...mudou });
    } else {
      recorrenciaId = novoId('rec');
      await estado.aplicarEvento('recorrencia.criada', { id: recorrenciaId, ...dadosDaSerie });
    }
  } else if (serieExiste) {
    // Sem quem pague, ou sem parcela por vir: a série para de projetar.
    await estado.aplicarEvento('recorrencia.alterada', { id: serieId, fim: hoje() });
  }

  await estado.aplicarEvento('conta.alterada', {
    id: contaId,
    contrato: { ...contrato, recorrenciaId },
    pagaCom: pagaCom ?? null,
  });
}

/** A foto do saldo devedor que o banco informa. */
export function fotografar(contaId, valor, data = hoje()) {
  return estado.aplicarEvento('conta.fotografada', { id: contaId, data, valor });
}
