// Sugestão de etiquetas pelo que os outros lançamentos parecidos têm (pedido dele, 09/11/2026).
//
// "Parecido" é pela DESCRIÇÃO (o nome da descrição escolhida e o texto que o banco mandou): as palavras de cada
// lançamento, sem acento, sem número e sem as palavras vazias que todo banco põe. Dois lançamentos são parecidos
// quando as palavras coincidem em pelo menos 60% (Jaccard). A etiqueta é sugerida quando a maioria dos parecidos
// que já têm etiqueta usa ela.
//
// NUNCA aplica nada: devolve só a sugestão. Quem a aceita, com um toque, é ele.

import { chave as chaveDoBanco } from './importar.js';

const LIMITE_DE_PARECIDO = 0.6;
const MAXIMO_DE_SUGESTOES = 2;

const sem = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** As palavras que dizem o que o lançamento é; vazio quando não há descrição para comparar. */
export function palavrasDoLancamento(estado, l) {
  const detalhe = l.detalheId ? estado.detalhes?.[l.detalheId]?.nome : '';
  // O texto do banco vem sujo (códigos, cidade): passa pela mesma limpeza da importação.
  const banco = l.textoBanco ? chaveDoBanco(l.textoBanco) : '';
  const texto = sem(`${detalhe ?? ''} ${banco}`).replace(/[^a-z\s]/g, ' ');
  return [...new Set(texto.split(/\s+/).filter((p) => p.length > 2))];
}

function parecido(a, b) {
  if (!a.length || !b.length) return 0;
  const de = new Set(b);
  const comuns = a.filter((p) => de.has(p)).length;
  return comuns / (a.length + b.length - comuns);
}

/**
 * Monta o sugestor uma vez por estado (o que custa é indexar) e devolve `sugerir(l)` →
 * [{ etiquetaId, vezes, de }]: `vezes` parecidos usam a etiqueta, entre `de` parecidos que têm alguma.
 */
export function criarSugestor(estado, lancamentos) {
  const base = [];
  const porPalavra = new Map();
  for (const l of lancamentos) {
    if (l.removido || !(l.etiquetas ?? []).length) continue;
    const palavras = palavrasDoLancamento(estado, l);
    if (!palavras.length) continue;
    const item = { l, palavras };
    base.push(item);
    for (const p of palavras) {
      if (!porPalavra.has(p)) porPalavra.set(p, []);
      porPalavra.get(p).push(item);
    }
  }

  return function sugerir(l) {
    if (l.tipo !== 'despesa' && l.tipo !== 'receita' && l.tipo !== 'estorno') return [];
    const palavras = palavrasDoLancamento(estado, l);
    if (!palavras.length) return [];
    const candidatos = new Set(palavras.flatMap((p) => porPalavra.get(p) ?? []));
    const tem = new Set(l.etiquetas ?? []);
    const contagem = new Map();
    let parecidos = 0;
    for (const c of candidatos) {
      if (c.l.id === l.id || c.l.tipo !== l.tipo) continue;
      if (parecido(palavras, c.palavras) < LIMITE_DE_PARECIDO) continue;
      parecidos += 1;
      for (const e of c.l.etiquetas) contagem.set(e, (contagem.get(e) ?? 0) + 1);
    }
    return [...contagem.entries()]
      .filter(([id, vezes]) => !tem.has(id) && estado.etiquetas?.[id] && !estado.etiquetas[id].arquivada && vezes / parecidos > 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAXIMO_DE_SUGESTOES)
      .map(([etiquetaId, vezes]) => ({ etiquetaId, vezes, de: parecidos }));
  };
}
