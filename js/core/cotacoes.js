// Cotações automáticas (design/10 §3.8): o app lê cotacoes.json — publicado todo
// dia útil por uma tarefa do GitHub, igual para todo mundo — e grava, para cada
// ativo vinculado, uma avaliação por pregão, como se a pessoa tivesse informado o
// preço à mão. É isso que dá o histórico para o gráfico.
//
// Qualquer ativo se vincula: ação, FII, ETF (fonte 'b3', chave = o código) ou
// título do Tesouro (fonte 'tesouro', chave = "Tipo|AAAA-MM-DD"). O preço é o de
// fechamento (Tesouro: o de venda), em centavos.

import * as estado from './estado.js';
import { visiveis } from './lancamentos.js';
import { posicao } from './investimentos.js';

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
 * Ativo por cotas: o preço do dia é a cotação, e o valor é quantidade × preço.
 * Ativo por valor (um Tesouro, por exemplo): o valor que a pessoa informou segue
 * a variação do preço — vincular nunca troca a forma de acompanhar nem mexe no
 * que já estava cadastrado.
 *
 * Sem `forcar`, não tenta de novo antes de meia hora: o app sincroniza a cada
 * alteração, e as cotações só mudam uma vez por dia. `dado` é para os testes.
 */
export async function atualizar({ forcar = false, cot: dado = null } = {}) {
  if (!dado && !forcar && Date.now() - ultimaTentativa < ESPERA_ENTRE_TENTATIVAS) return 0;
  const app = await estado.calcular();
  const vinculados = Object.values(app.ativos ?? {}).filter((a) => a.cotacao && !a.arquivado);
  if (!vinculados.length) return 0;
  if (!dado) {
    ultimaTentativa = Date.now();
    if (forcar) memoria = null;
  }
  const cot = dado ?? (await carregar());
  if (!cot) return 0;

  const operacoes = visiveis(app).filter((l) => l.ativoId && l.confirmado);
  let gravadas = 0;
  for (const a of vinculados) {
    const serie = serieDoVinculo(cot, a.cotacao);
    const primeira = operacoes.filter((l) => l.ativoId === a.id).reduce((m, l) => (!m || l.dataCompetencia < m ? l.dataCompetencia : m), null);
    if (!serie.length || !primeira) continue;
    gravadas += a.unidade === 'cotas' ? await porCotas(a, serie, primeira) : await porValor(a.id, serie, primeira);
  }
  return gravadas;
}

async function porCotas(a, serie, primeira) {
  // Só conta o dia já avaliado com preço: um valor informado no tempo em que o ativo era
  // acompanhado de outro jeito não impede a cotação.
  const tem = new Set(a.avaliacoes.filter((v) => v.preco != null).map((v) => v.data));
  let gravadas = 0;
  for (const { data, preco } of serie) {
    if (data < primeira || tem.has(data)) continue;
    await estado.aplicarEvento('ativo.avaliado', { id: a.id, data, preco, auto: true });
    gravadas += 1;
  }
  return gravadas;
}

/**
 * O valor de cada pregão = o valor do pregão anterior × (preço de hoje ÷ preço
 * do anterior) + o que se aplicou ou resgatou no intervalo. O primeiro pregão da
 * série só marca o ponto de partida: o valor que a pessoa já tinha.
 */
async function porValor(id, serie, primeira) {
  let anterior = null;
  let gravadas = 0;
  for (const { data, preco } of serie) {
    const app = await estado.calcular();
    const a = app.ativos[id];
    if (anterior && data >= primeira && !a.avaliacoes.some((v) => v.data === data && v.valor != null)) {
      const base = posicao(app, id, anterior.data)?.valorAtual ?? 0;
      const fluxo = visiveis(app)
        .filter((l) => l.ativoId === id && l.confirmado && l.dataCompetencia > anterior.data && l.dataCompetencia <= data)
        .reduce((t, l) => t + (l.tipo === 'aplicacao' ? l.valor : l.tipo === 'resgate' ? -l.valor : 0), 0);
      const valor = Math.max(0, Math.round((base * preco) / anterior.preco) + fluxo);
      await estado.aplicarEvento('ativo.avaliado', { id, data, valor, preco, auto: true });
      gravadas += 1;
    }
    anterior = { data, preco };
  }
  return gravadas;
}
