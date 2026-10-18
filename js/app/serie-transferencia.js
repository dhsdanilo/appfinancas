// Mudar uma transferência que é ocorrência de uma série: só esta, ou esta e as
// próximas. O que já foi lançado antes nunca muda.

import * as estado from '../core/estado.js';
import { novoId } from '../core/id.js';
import { lancados } from '../core/lancamentos.js';
import { fimDoMes, somarMeses } from '../core/datas.js';

/**
 * O que a tela mudou em relação à ocorrência de que partiu (`base`: o previsto ou
 * o lançamento em correção): { valor?, contaId?, contaDestinoId?, dia? }, ou null
 * se nada mudou. O valor só conta numa série de valor fixo — na estimada, cada
 * mês é o que é.
 */
export function mudancasNaSerie(serie, base, { valor, origem, destino, data }) {
  const m = {};
  if (serie.tipoValor === 'fixa' && valor !== base.valor) m.valor = valor;
  if (origem !== base.contaId) m.contaId = origem;
  if (destino !== (base.contaDestinoId ?? null)) m.contaDestinoId = destino;
  const dia = Number(data.slice(8, 10));
  if (dia !== Number(base.dataCompetencia.slice(8, 10))) m.dia = dia;
  return Object.keys(m).length ? m : null;
}

/**
 * "Esta e as próximas": só o valor mudou → reajuste a partir desta ocorrência, na
 * mesma série. Contas ou dia mudaram → a série antiga termina no mês anterior
 * (ou some, se nunca lançou nada fora desta) e nasce outra, a partir deste mês.
 * Devolve o id da série a que esta transferência passa a pertencer.
 *
 * @param {object} app
 * @param {object} serie  a série de que a ocorrência vem
 * @param {object} base   a ocorrência de partida (previsto ou lançamento)
 * @param {{ valor, origem, destino, data }} atual  o que está na tela
 * @param {{ lancamentoId?: string|null }} [opcoes]  o lançamento em correção, que não conta como "outro"
 */
export async function aplicarNasProximas(app, serie, base, atual, { lancamentoId = null } = {}) {
  const m = mudancasNaSerie(serie, base, atual);
  if (!m) return serie.id;
  if (Object.keys(m).length === 1 && m.valor !== undefined) {
    await estado.aplicarEvento('recorrencia.reajustada', { id: serie.id, desde: base.dataCompetencia, valor: m.valor });
    return serie.id;
  }
  const mes = base.dataCompetencia.slice(0, 7);
  const id = novoId('rec');
  await estado.aplicarEvento('recorrencia.criada', {
    id,
    nome: serie.nome,
    tipo: serie.tipo,
    contaId: atual.origem,
    contaDestinoId: atual.destino,
    categoriaId: serie.categoriaId ?? null,
    detalheId: serie.detalheId ?? null,
    etiquetas: serie.etiquetas ?? [],
    tipoValor: serie.tipoValor,
    valor: serie.tipoValor === 'fixa' ? atual.valor : serie.valor,
    periodicidade: serie.periodicidade ?? 'mensal',
    dia: Number(atual.data.slice(8, 10)),
    inicio: `${mes}-01`,
    fim: serie.fim ?? null,
    esporadica: serie.esporadica ?? false,
    envelopeId: serie.envelopeId ?? null,
    caiSozinha: serie.caiSozinha ?? false,
    caiSozinhaDesde: serie.caiSozinhaDesde ?? null,
  });
  const outras = lancados(app).filter((l) => l.recorrenciaId === serie.id && l.id !== lancamentoId);
  if (outras.length) {
    await estado.aplicarEvento('recorrencia.alterada', { id: serie.id, fim: fimDoMes(somarMeses(`${mes}-01`, -1)) });
  } else {
    await estado.aplicarEvento('recorrencia.removida', { id: serie.id });
  }
  return id;
}
