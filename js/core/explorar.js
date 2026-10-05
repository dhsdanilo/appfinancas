// O Explorar (design/14, D32): uma seleção de categorias, etiquetas,
// descrições e contas, e os números dela ao longo do tempo. Nada daqui é
// gravado além da própria seleção salva; tudo é conta sobre os lançamentos.
//
// A seleção: { categorias, etiquetas, descricoes, contas, cruzar }.
//   - o "o quê" (categorias, etiquetas, descrições) SOMA: casa com qualquer
//     um; com `cruzar`, casa com cada tipo de filtro escolhido;
//   - as contas sempre restringem.
// O gasto segue as regras dos relatórios (12 §2): despesa por competência
// menos as devoluções dela; receita fica à parte, nunca somada ao gasto.

import { hoje, fimDoMes, somarMeses, proximoMes } from './datas.js';
import { lancados } from './lancamentos.js';
import { gastos, ehProjeto, primeiroMes } from './relatorios.js';

const mesDe = (dia) => dia.slice(0, 7);

/** Uma seleção sem nada escolhido não mostra nada — é o convite a escolher. */
export const selecaoVazia = (s) =>
  !s || !(s.categorias?.length || s.etiquetas?.length || s.descricoes?.length || s.contas?.length);

/**
 * O lançamento casa com a seleção? `ref` é de onde vêm categoria, etiquetas
 * e descrição — na devolução, a compra quando ela não traz as próprias.
 */
function casa(sel, l, ref) {
  if (sel.contas?.length && !sel.contas.includes(l.contaId)) return false;
  const testes = [];
  if (sel.categorias?.length) testes.push(sel.categorias.includes(ref.categoriaId));
  if (sel.etiquetas?.length) testes.push((ref.etiquetas ?? []).some((t) => sel.etiquetas.includes(t)));
  if (sel.descricoes?.length) testes.push(sel.descricoes.includes(ref.detalheId));
  if (!testes.length) return true; // só contas: tudo delas
  return sel.cruzar ? testes.every(Boolean) : testes.some(Boolean);
}

/**
 * Os movimentos da seleção no período, por competência:
 * [{ l, valor, natureza: 'gasto' | 'receita', categoriaId, detalheId, etiquetas, projeto }].
 * A devolução entra negativa no gasto. A despesa obrigatória da folha (IR) só
 * entra quando a categoria dela foi escolhida.
 */
export function movimentos(estado, sel, de, ate) {
  if (selecaoVazia(sel)) return [];
  const saida = [];
  for (const l of lancados(estado)) {
    if (!l.confirmado || l.dataCompetencia < de || l.dataCompetencia > ate) continue;
    if (l.tipo === 'despesa') {
      const obrigatoria = estado.categorias[l.categoriaId]?.obrigatoria;
      if (obrigatoria && !sel.categorias?.includes(l.categoriaId)) continue;
      if (!casa(sel, l, l)) continue;
      saida.push({ l, valor: l.valor, natureza: 'gasto', categoriaId: l.categoriaId, detalheId: l.detalheId ?? null, etiquetas: l.etiquetas ?? [], projeto: ehProjeto(l) });
    } else if (l.tipo === 'estorno') {
      const compra = estado.lancamentos[l.estornoDe];
      const ref = {
        categoriaId: l.categoriaId ?? compra?.categoriaId ?? null,
        detalheId: l.detalheId ?? compra?.detalheId ?? null,
        etiquetas: l.etiquetas?.length ? l.etiquetas : compra?.etiquetas ?? [],
      };
      if (!casa(sel, l, ref)) continue;
      saida.push({ l, valor: -l.valor, natureza: 'gasto', ...ref, projeto: compra ? ehProjeto(compra) : false });
    } else if (l.tipo === 'receita') {
      if (!casa(sel, l, l)) continue;
      saida.push({ l, valor: l.valor, natureza: 'receita', categoriaId: l.categoriaId, detalheId: l.detalheId ?? null, etiquetas: l.etiquetas ?? [], projeto: false });
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

/**
 * O período da aba, sempre terminando no mês atual: '6' e '12' meses, 'ano'
 * (este ano) ou 'tudo' (desde o primeiro lançamento).
 */
export function periodoDoExplorar(estado, opcao, dia = hoje()) {
  const ate = mesDe(dia);
  let de;
  if (opcao === 'ano') de = `${dia.slice(0, 4)}-01`;
  else if (opcao === 'tudo') de = primeiroMes(estado) ?? ate;
  else de = somarMeses(`${ate}-01`, 1 - Number(opcao || 12)).slice(0, 7);
  if (de > ate) de = ate;
  return { de: `${de}-01`, ate: fimDoMes(`${ate}-01`), meses: mesesEntre(de, ate) };
}

/** Soma por chave: [{ chave, valor, vezes, lancamentos }], do maior para o menor. */
function agrupar(itens, chaveDe) {
  const mapa = new Map();
  for (const x of itens) {
    for (const chave of [].concat(chaveDe(x))) {
      if (chave == null) continue;
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
 * Tudo que a aba mostra de uma seleção num período.
 *
 * { meses, porMes: [{ mes, gasto, receita, partes: Map(chave → valor) }],
 *   total, receita, media, projeto, parteDoGasto, anoAnterior,
 *   empilha: 'categoria' | 'descricao', series: [{ chave, valor }],
 *   categorias, etiquetas, descricoes }
 */
export function explorar(estado, sel, periodo) {
  const { de, ate, meses } = periodo;
  const movs = movimentos(estado, sel, de, ate);
  const gasto = movs.filter((x) => x.natureza === 'gasto');
  const receitas = movs.filter((x) => x.natureza === 'receita');
  // Só receita na seleção: os gráficos mostram a receita.
  const base = gasto.length ? gasto : receitas;

  // Empilha por categoria — uma partição, nunca conta duas vezes; com uma
  // categoria só, pelas descrições dela.
  const cats = new Set(base.map((x) => x.categoriaId));
  const empilha = cats.size === 1 ? 'descricao' : 'categoria';
  const chaveDaPilha = (x) => (empilha === 'descricao' ? x.detalheId ?? '—' : x.categoriaId ?? '—');
  const ranking = agrupar(base, chaveDaPilha);
  // Até 6 com cor própria; o resto vira "outras".
  const comCor = ranking.slice(0, ranking.length > 7 ? 6 : 7).map((g) => g.chave);
  const series = [...comCor.map((chave) => ({ chave, valor: ranking.find((g) => g.chave === chave).valor })),
    ...(ranking.length > comCor.length ? [{ chave: 'outras', valor: ranking.slice(comCor.length).reduce((t, g) => t + g.valor, 0) }] : [])];

  const porMes = meses.map((mes) => ({ mes, gasto: 0, receita: 0, partes: new Map() }));
  const doMes = new Map(porMes.map((m) => [m.mes, m]));
  for (const x of movs) {
    const m = doMes.get(mesDe(x.l.dataCompetencia));
    if (!m) continue;
    if (x.natureza === 'gasto') m.gasto += x.valor; else m.receita += x.valor;
    if ((x.natureza === 'gasto') === (base === gasto)) {
      const k = comCor.includes(chaveDaPilha(x)) ? chaveDaPilha(x) : 'outras';
      m.partes.set(k, (m.partes.get(k) ?? 0) + x.valor);
    }
  }

  const total = gasto.reduce((t, x) => t + x.valor, 0);
  const receita = receitas.reduce((t, x) => t + x.valor, 0);
  const totalDaBase = base === gasto ? total : receita;
  const desde = primeiroMes(estado);
  const gastoGeral = gastos(estado, de, ate).reduce((t, x) => t + x.valor, 0);

  // O mesmo período um ano antes, quando já havia lançamento nele.
  const deAntes = somarMeses(de, -12);
  const ateAntes = fimDoMes(somarMeses(`${mesDe(ate)}-01`, -12));
  const anoAnterior = desde && desde <= mesDe(deAntes)
    ? movimentos(estado, sel, deAntes, ateAntes).filter((x) => x.natureza === (base === gasto ? 'gasto' : 'receita')).reduce((t, x) => t + x.valor, 0)
    : null;

  return {
    meses,
    porMes,
    natureza: base === gasto ? 'gasto' : 'receita',
    total,
    receita,
    totalDaBase,
    // A média conta só os meses desde que o app tem lançamento: o mês de
    // antes do app não é mês de gasto zero.
    media: Math.round(totalDaBase / Math.max(1, meses.filter((m) => !desde || m >= desde).length)),
    projeto: gasto.filter((x) => x.projeto).reduce((t, x) => t + x.valor, 0),
    parteDoGasto: gastoGeral > 0 && total > 0 ? total / gastoGeral : null,
    anoAnterior,
    empilha,
    series,
    vazia: !movs.length,
    categorias: agrupar(base, (x) => x.categoriaId),
    etiquetas: agrupar(base, (x) => x.etiquetas),
    descricoes: agrupar(base.filter((x) => x.detalheId), (x) => x.detalheId),
  };
}

/** O total de cada mês de uma seleção: para comparar seleções numa linha cada. */
export function serieDaSelecao(estado, sel, periodo) {
  const movs = movimentos(estado, sel, periodo.de, periodo.ate);
  const temGasto = movs.some((x) => x.natureza === 'gasto');
  const valores = periodo.meses.map(() => 0);
  const indice = new Map(periodo.meses.map((m, i) => [m, i]));
  for (const x of movs) {
    if ((x.natureza === 'gasto') !== temGasto) continue;
    const i = indice.get(mesDe(x.l.dataCompetencia));
    if (i != null) valores[i] += x.valor;
  }
  return valores;
}

/**
 * Ano contra ano: o acumulado mês a mês deste ano (até o mês atual) e do ano
 * passado (o ano inteiro). Null quando o ano passado não tem lançamento.
 */
export function anoContraAno(estado, sel, dia = hoje()) {
  const ano = Number(dia.slice(0, 4));
  const desde = primeiroMes(estado);
  if (!desde || desde > `${ano - 1}-12`) return null;
  const acumulado = (a, ateMes) => {
    const movs = movimentos(estado, sel, `${a}-01-01`, fimDoMes(`${a}-${String(ateMes).padStart(2, '0')}-01`));
    const temGasto = movs.some((x) => x.natureza === 'gasto');
    const porMes = Array(ateMes).fill(0);
    for (const x of movs) if ((x.natureza === 'gasto') === temGasto) porMes[Number(x.l.dataCompetencia.slice(5, 7)) - 1] += x.valor;
    let soma = 0;
    return porMes.map((v) => (soma += v));
  };
  return {
    ano,
    este: acumulado(ano, Number(dia.slice(5, 7))),
    passado: acumulado(ano - 1, 12),
    desdeOPassado: desde > `${ano - 1}-01` ? desde : null,
  };
}
