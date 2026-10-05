// O relatório flexível (design/12 §0, D33; as regras da seleção em
// design/14): o que casa com os filtros, num período, agrupado no tempo (mês
// ou ano) e na lista (categoria, etiqueta, descrição ou conta). Nada daqui é
// gravado além da seleção salva; tudo é conta sobre os lançamentos.
//
// Os filtros: { categorias, etiquetas, descricoes, contas, cruzar }.
//   - sem filtro nenhum, é tudo;
//   - o "o quê" (categorias, etiquetas, descrições) SOMA: casa com qualquer
//     um; com `cruzar`, casa com cada tipo de filtro escolhido;
//   - as contas sempre restringem.
// O gasto segue as regras dos relatórios (12 §2): despesa por competência
// menos as devoluções dela; renda é a receita, nunca somada ao gasto.

import { hoje, fimDoMes, somarMeses, proximoMes } from './datas.js';
import { lancados } from './lancamentos.js';
import { ehProjeto, primeiroMes } from './relatorios.js';

const mesDe = (dia) => dia.slice(0, 7);

/** Nenhum filtro escolhido: o relatório é de tudo. */
export const selecaoVazia = (s) =>
  !s || !(s.categorias?.length || s.etiquetas?.length || s.descricoes?.length || s.contas?.length);

/**
 * O lançamento casa com os filtros? `ref` é de onde vêm categoria, etiquetas
 * e descrição — na devolução, a compra quando ela não traz as próprias.
 */
function casa(sel, l, ref) {
  if (sel?.contas?.length && !sel.contas.includes(l.contaId)) return false;
  const testes = [];
  if (sel?.categorias?.length) testes.push(sel.categorias.includes(ref.categoriaId));
  if (sel?.etiquetas?.length) testes.push((ref.etiquetas ?? []).some((t) => sel.etiquetas.includes(t)));
  if (sel?.descricoes?.length) testes.push(sel.descricoes.includes(ref.detalheId));
  if (!testes.length) return true;
  return sel.cruzar ? testes.every(Boolean) : testes.some(Boolean);
}

/**
 * Os movimentos que casam, por competência:
 * [{ l, valor, natureza: 'gasto' | 'renda', categoriaId, detalheId, etiquetas, contaId, projeto }].
 * A devolução entra negativa no gasto. A despesa obrigatória da folha (IR) só
 * entra quando a categoria dela foi escolhida.
 */
export function movimentos(estado, sel, de, ate) {
  const saida = [];
  for (const l of lancados(estado)) {
    if (!l.confirmado || l.dataCompetencia < de || l.dataCompetencia > ate) continue;
    if (l.tipo === 'despesa') {
      const obrigatoria = estado.categorias[l.categoriaId]?.obrigatoria;
      if (obrigatoria && !sel?.categorias?.includes(l.categoriaId)) continue;
      if (!casa(sel, l, l)) continue;
      saida.push({ l, valor: l.valor, natureza: 'gasto', categoriaId: l.categoriaId, detalheId: l.detalheId ?? null, etiquetas: l.etiquetas ?? [], contaId: l.contaId, projeto: ehProjeto(l) });
    } else if (l.tipo === 'estorno') {
      const compra = estado.lancamentos[l.estornoDe];
      const ref = {
        categoriaId: l.categoriaId ?? compra?.categoriaId ?? null,
        detalheId: l.detalheId ?? compra?.detalheId ?? null,
        etiquetas: l.etiquetas?.length ? l.etiquetas : compra?.etiquetas ?? [],
      };
      if (!casa(sel, l, ref)) continue;
      saida.push({ l, valor: -l.valor, natureza: 'gasto', ...ref, contaId: l.contaId, projeto: compra ? ehProjeto(compra) : false });
    } else if (l.tipo === 'receita') {
      if (!casa(sel, l, l)) continue;
      saida.push({ l, valor: l.valor, natureza: 'renda', categoriaId: l.categoriaId, detalheId: l.detalheId ?? null, etiquetas: l.etiquetas ?? [], contaId: l.contaId, projeto: false });
    }
  }
  return saida;
}

/** Os meses ('2026-10') de `de` a `ate`, inclusive. */
function mesesEntre(de, ate) {
  const lista = [];
  for (let m = de; m <= ate; m = proximoMes(m)) lista.push(m);
  return lista;
}

export const PERIODOS = [
  ['mes', 'um mês'], ['3', '3 meses'], ['12', '12 meses'], ['ano', 'este ano'], ['5anos', '5 anos'], ['tudo', 'tudo'],
];

/**
 * O período: 'mes' é o mês `mesRef` (navegável); os outros terminam no mês
 * atual — '3' e '12' meses, 'ano' (este ano), '5anos', 'tudo' (desde o
 * primeiro lançamento). { opcao, de, ate, meses }
 */
export function periodo(estado, opcao, mesRef = mesDe(hoje()), dia = hoje()) {
  const atual = mesDe(dia);
  if (opcao === 'mes') return { opcao, de: `${mesRef}-01`, ate: fimDoMes(`${mesRef}-01`), meses: [mesRef] };
  let de;
  if (opcao === 'ano') de = `${atual.slice(0, 4)}-01`;
  else if (opcao === '5anos') de = `${Number(atual.slice(0, 4)) - 4}-01`;
  else if (opcao === 'tudo') de = primeiroMes(estado) ?? atual;
  else de = somarMeses(`${atual}-01`, 1 - Number(opcao)).slice(0, 7);
  if (de > atual) de = atual;
  return { opcao, de: `${de}-01`, ate: fimDoMes(`${atual}-01`), meses: mesesEntre(de, atual) };
}

/** O período de mesmo tamanho logo antes: a base da diferença. */
export function periodoAnterior(per) {
  const n = per.meses.length;
  const ultimo = somarMeses(`${per.meses[0]}-01`, -1).slice(0, 7);
  const primeiro = somarMeses(`${per.meses[0]}-01`, -n).slice(0, 7);
  return { de: `${primeiro}-01`, ate: fimDoMes(`${ultimo}-01`), meses: mesesEntre(primeiro, ultimo) };
}

/** As chaves de um movimento no agrupamento da lista. Etiqueta pode ser mais de uma. */
function chavesDe(x, agrupar) {
  if (agrupar === 'etiqueta') return x.etiquetas.length ? x.etiquetas : ['—'];
  if (agrupar === 'descricao') return [x.detalheId ?? '—'];
  if (agrupar === 'conta') return [x.contaId ?? '—'];
  return [x.categoriaId ?? '—'];
}

/** Soma por chave: [{ chave, valor, vezes, lancamentos }], do maior para o menor. */
function agruparPor(itens, agrupar) {
  const mapa = new Map();
  for (const x of itens) {
    for (const chave of chavesDe(x, agrupar)) {
      if (!mapa.has(chave)) mapa.set(chave, { chave, valor: 0, vezes: 0, lancamentos: [] });
      const g = mapa.get(chave);
      g.valor += x.valor;
      if (x.valor > 0) g.vezes += 1;
      g.lancamentos.push(x.l.id);
    }
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}

/**
 * O relatório de Gastos (ou de renda) de um período.
 *
 * { total, anterior, media, porAno, projeto, vazia,
 *   baldes: [{ chave ('2026-10' ou '2026'), partes: Map, total }],
 *   pilha: o agrupamento das colunas, series: [{ chave, valor }],
 *   grupos: [{ chave, valor, vezes, anterior, lancamentos }] }
 *
 * As colunas empilham pelo agrupamento da lista quando ele reparte o total
 * (categoria, descrição, conta); por etiqueta — que pode ser mais de uma por
 * lançamento —, empilham por categoria, para nada contar duas vezes.
 */
export function relatorio(estado, sel, per, { natureza = 'gasto', agrupar = 'categoria', tempo = 'mes' } = {}, dia = hoje()) {
  const daqui = movimentos(estado, sel, per.de, per.ate).filter((x) => x.natureza === natureza);
  const ant = periodoAnterior(per);
  // O mês que ainda corre se compara com o anterior até o mesmo dia: outubro
  // até o dia 5 contra setembro inteiro faria todo mês parecer econômico.
  const ateODia = per.opcao === 'mes' && per.meses[0] === mesDe(dia);
  if (ateODia) {
    const mesmoDia = `${ant.meses[0]}-${dia.slice(8, 10)}`;
    if (mesmoDia < ant.ate) ant.ate = mesmoDia;
  }
  const antes = movimentos(estado, sel, ant.de, ant.ate).filter((x) => x.natureza === natureza);

  const pilha = agrupar === 'etiqueta' ? 'categoria' : agrupar;
  const ranking = agruparPor(daqui, pilha);
  const comCor = ranking.slice(0, ranking.length > 7 ? 6 : 7).map((g) => g.chave);
  const series = [...comCor.map((chave) => ({ chave, valor: ranking.find((g) => g.chave === chave).valor })),
    ...(ranking.length > comCor.length ? [{ chave: 'outras', valor: ranking.slice(comCor.length).reduce((t, g) => t + g.valor, 0) }] : [])];

  const chaveDoBalde = (dia) => (tempo === 'ano' ? dia.slice(0, 4) : mesDe(dia));
  const ordem = [...new Set(per.meses.map((m) => (tempo === 'ano' ? m.slice(0, 4) : m)))];
  const baldes = ordem.map((chave) => ({ chave, partes: new Map(), total: 0 }));
  const doBalde = new Map(baldes.map((b) => [b.chave, b]));
  for (const x of daqui) {
    const b = doBalde.get(chaveDoBalde(x.l.dataCompetencia));
    if (!b) continue;
    const k = chavesDe(x, pilha)[0];
    const s = comCor.includes(k) ? k : 'outras';
    b.partes.set(s, (b.partes.get(s) ?? 0) + x.valor);
    b.total += x.valor;
  }

  const total = daqui.reduce((t, x) => t + x.valor, 0);
  const anterior = antes.length ? antes.reduce((t, x) => t + x.valor, 0) : null;
  // A média conta só o tempo desde que o app tem lançamento: o mês de antes
  // do app não é mês de gasto zero.
  const desde = primeiroMes(estado);
  const contados = baldes.filter((b) => !desde || b.chave >= (tempo === 'ano' ? desde.slice(0, 4) : desde)).length;
  const antesPorChave = new Map(agruparPor(antes, agrupar).map((g) => [g.chave, g.valor]));

  return {
    total,
    anterior,
    ateODia: ateODia ? Number(dia.slice(8, 10)) : null,
    media: Math.round(total / Math.max(1, contados)),
    porAno: tempo === 'ano',
    projeto: daqui.filter((x) => x.projeto).reduce((t, x) => t + x.valor, 0),
    vazia: !daqui.length,
    baldes,
    pilha,
    series,
    grupos: agruparPor(daqui, agrupar).map((g) => ({ ...g, anterior: antesPorChave.get(g.chave) ?? 0 })),
  };
}

/**
 * O ritmo de um mês: o acumulado dia a dia, contra o mês anterior inteiro
 * (o pontilhado). { atual, anterior, hoje, noMesmoDia, mesAnterior }
 */
export function ritmo(estado, sel, mes, natureza = 'gasto', dia = hoje()) {
  const ant = somarMeses(`${mes}-01`, -1).slice(0, 7);
  const ultimoDia = (m) => Number(fimDoMes(`${m}-01`).slice(8, 10));
  const dias = Math.max(ultimoDia(mes), ultimoDia(ant));
  const acumulado = (m, ate) => {
    const porDia = new Array(dias + 1).fill(0);
    for (const x of movimentos(estado, sel, `${m}-01`, fimDoMes(`${m}-01`))) {
      if (x.natureza === natureza) porDia[Number(x.l.dataCompetencia.slice(8, 10))] += x.valor;
    }
    const saida = [];
    let t = 0;
    for (let d = 1; d <= dias; d += 1) {
      t += porDia[d];
      saida.push(d > ate ? null : t);
    }
    return saida;
  };
  const hojeNoMes = mes === mesDe(dia) ? Number(dia.slice(8, 10)) : ultimoDia(mes);
  const anterior = acumulado(ant, ultimoDia(ant));
  return {
    atual: acumulado(mes, hojeNoMes),
    anterior,
    hoje: hojeNoMes,
    corrente: mes === mesDe(dia),
    mesAnterior: ant,
    noMesmoDia: anterior[Math.min(hojeNoMes, ultimoDia(ant)) - 1] ?? 0,
  };
}
