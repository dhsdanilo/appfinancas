// Cotações automáticas (design/10 §3.8): o app lê cotacoes.json — publicado todo
// dia útil por uma tarefa do GitHub, igual para todo mundo — e grava, para cada
// ativo vinculado, uma avaliação por pregão, como se a pessoa tivesse informado o
// preço à mão. É isso que dá o histórico para o gráfico.
//
// Só ativos por cotas se vinculam: ação, FII, ETF (fonte 'b3', chave = o código)
// e título do Tesouro (fonte 'tesouro', chave = "Tipo|AAAA-MM-DD"), comprados por
// quantidade. O preço é o de fechamento (Tesouro: o de venda), em centavos.

import * as estado from './estado.js';
import { visiveis } from './lancamentos.js';

const CHAVE_CACHE = 'appfinancas:cotacoes';
const ESPERA_ENTRE_TENTATIVAS = 30 * 60 * 1000;

let memoria = null;
let ultimaTentativa = 0;

/** O arquivo de cotações: da rede se der, do último que se baixou se não. */
export async function carregar() {
  if (memoria) return memoria;
  try {
    const r = await fetch(new URL('cotacoes.json', document.baseURI), { cache: 'no-store' });
    if (!r.ok) throw new Error(`cotações: ${r.status}`);
    memoria = await r.json();
    try { localStorage.setItem(CHAVE_CACHE, JSON.stringify(memoria)); } catch { /* sem armazenamento: só não fica para a próxima */ }
  } catch {
    try { memoria = JSON.parse(localStorage.getItem(CHAVE_CACHE) ?? 'null'); } catch { memoria = null; }
  }
  return memoria;
}

/** As séries de um vínculo: [{ data, preco }] em ordem, só onde houve preço. */
export function serieDoVinculo(cot, vinculo) {
  const grupo = vinculo?.fonte === 'b3' ? cot?.acoes : vinculo?.fonte === 'tesouro' ? cot?.tesouro : null;
  const precos = grupo?.p?.[vinculo.chave];
  if (!precos) return [];
  return grupo.datas.map((data, i) => ({ data, preco: precos[i] })).filter((x) => x.preco);
}

/** O último preço de um vínculo, ou null. */
export function ultimoPreco(cot, vinculo) {
  const s = serieDoVinculo(cot, vinculo);
  return s.length ? s[s.length - 1] : null;
}

/** Os títulos do Tesouro para escolher: [{ chave, nome }], pelo nome e pelo vencimento. */
export function titulosDoTesouro(cot) {
  return Object.entries(cot?.tesouro?.nomes ?? {})
    .map(([chave, nome]) => ({ chave, nome }))
    .sort((a, b) => (a.chave < b.chave ? -1 : 1));
}

export const codigosDaB3 = (cot) => Object.keys(cot?.acoes?.p ?? {});

/**
 * Grava uma avaliação por pregão em cada ativo vinculado — só dos dias a partir
 * da primeira operação, e nunca por cima de um dia que já tem avaliação (a que a
 * pessoa informou manda). Devolve quantas gravou.
 *
 * Sem `forcar`, não tenta de novo antes de meia hora: o app sincroniza a cada
 * alteração, e as cotações só mudam uma vez por dia.
 */
export async function atualizar({ forcar = false } = {}) {
  if (!forcar && Date.now() - ultimaTentativa < ESPERA_ENTRE_TENTATIVAS) return 0;
  const app = await estado.calcular();
  const vinculados = Object.values(app.ativos ?? {}).filter((a) => a.cotacao && a.unidade === 'cotas' && !a.arquivado);
  if (!vinculados.length) return 0;
  ultimaTentativa = Date.now();
  if (forcar) memoria = null;
  const cot = await carregar();
  if (!cot) return 0;

  const operacoes = visiveis(app).filter((l) => l.ativoId && l.confirmado);
  let gravadas = 0;
  for (const a of vinculados) {
    const primeira = operacoes.filter((l) => l.ativoId === a.id).reduce((m, l) => (!m || l.dataCompetencia < m ? l.dataCompetencia : m), null);
    if (!primeira) continue;
    const tem = new Set(a.avaliacoes.map((v) => v.data));
    for (const { data, preco } of serieDoVinculo(cot, a.cotacao)) {
      if (data < primeira || tem.has(data)) continue;
      await estado.aplicarEvento('ativo.avaliado', { id: a.id, data, preco, auto: true });
      gravadas += 1;
    }
  }
  return gravadas;
}
