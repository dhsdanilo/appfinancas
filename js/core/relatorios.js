// Os relatórios (design/12-relatorios.md, D28). Nada daqui é gravado: tudo é
// conta sobre os lançamentos, as séries, os contratos e os ativos.
//
// As regras que valem para todos (§2):
//   gasto  = despesa por competência, menos as devoluções dela; despesa
//            obrigatória da folha (IR, previdência oficial) não é gasto.
//   projeto = gasto pago por envelope ou marcado extraordinário (D19); os
//            relatórios abrem em rotina, com os projetos à vista ao lado.
//   renda disponível = receitas − obrigatórias (D25).

import { hoje, inicioDoMes, fimDoMes, somarMeses, somarDias, proximoMes } from './datas.js';
import { lancados, visiveis, saldoReal, sinalDeSaida } from './lancamentos.js';
import { ocorrenciasPrevistas, faturas, valorDaSerie } from './previsto.js';
import { posicao, resumoDaConta, ativosDaConta, saldoAte, CLASSES, nomeDaClasse } from './investimentos.js';
import { saldoDevedor, cronograma } from './divida.js';
import { rendaDisponivel, liquidoPrevisto } from './holerite.js';
import { donosNoDia } from './envelopes.js';

const CAIXA = new Set(['corrente', 'especie']);
const ehCaixa = (estado, id) => CAIXA.has(estado.contas[id]?.tipo);
const mesDe = (dia) => dia.slice(0, 7);
const somar = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);

/** Os meses de `de` a `ate`, inclusive ('2026-01' … '2026-10'). */
export function mesesEntre(de, ate) {
  const lista = [];
  for (let m = de; m <= ate; m = proximoMes(m)) lista.push(m);
  return lista;
}

// ── o gasto ─────────────────────────────────────────────────────────────────

/** Gasto de projeto: pago por envelope, ou marcado extraordinário (D19). */
export const ehProjeto = (l) => Boolean(l.custeadoPor) || Boolean(l.extraordinario);

/**
 * O gasto de um período por competência: [{ l, valor, categoriaId, projeto }].
 * Devolução entra com valor negativo, na categoria e no mês da compra.
 */
export function gastos(estado, de, ate) {
  const saida = [];
  for (const l of lancados(estado)) {
    if (!l.confirmado || l.dataCompetencia < de || l.dataCompetencia > ate) continue;
    if (l.tipo === 'despesa') {
      if (estado.categorias[l.categoriaId]?.obrigatoria) continue;
      saida.push({ l, valor: l.valor, categoriaId: l.categoriaId, projeto: ehProjeto(l) });
    } else if (l.tipo === 'estorno') {
      const compra = estado.lancamentos[l.estornoDe];
      saida.push({ l, valor: -l.valor, categoriaId: l.categoriaId ?? compra?.categoriaId ?? null, projeto: compra ? ehProjeto(compra) : false });
    }
  }
  return saida;
}

const intervaloDoMes = (mes) => ({ de: `${mes}-01`, ate: fimDoMes(`${mes}-01`) });

// ── Mês ─────────────────────────────────────────────────────────────────────

/**
 * O mês em categorias (R2), contra o mês anterior. Rotina nas linhas; os
 * projetos à parte, por envelope (D19).
 */
export function mesEmCategorias(estado, mes) {
  const atual = gastos(estado, ...Object.values(intervaloDoMes(mes)));
  const anterior = gastos(estado, ...Object.values(intervaloDoMes(somarMeses(`${mes}-01`, -1).slice(0, 7))));
  const porCat = new Map();
  const linha = (id) => {
    if (!porCat.has(id)) porCat.set(id, { categoriaId: id, valor: 0, anterior: 0, lancamentos: [] });
    return porCat.get(id);
  };
  for (const g of atual) {
    if (g.projeto) continue;
    const x = linha(g.categoriaId ?? '');
    x.valor += g.valor;
    x.lancamentos.push(g.l.id);
  }
  for (const g of anterior) if (!g.projeto) linha(g.categoriaId ?? '').anterior += g.valor;
  const linhas = [...porCat.values()]
    .map((x) => ({ ...x, diferenca: x.valor - x.anterior }))
    .filter((x) => x.valor || x.anterior)
    .sort((a, b) => b.valor - a.valor || b.anterior - a.anterior);

  const projetos = new Map();
  for (const g of atual) {
    if (!g.projeto) continue;
    const chave = g.l.custeadoPor ?? '';
    if (!projetos.has(chave)) projetos.set(chave, { envelopeId: g.l.custeadoPor ?? null, valor: 0, lancamentos: [] });
    projetos.get(chave).valor += g.valor;
    projetos.get(chave).lancamentos.push(g.l.id);
  }
  const rotina = linhas.reduce((t, x) => t + x.valor, 0);
  const listaProjetos = [...projetos.values()].sort((a, b) => b.valor - a.valor);
  return {
    linhas,
    rotina,
    rotinaAnterior: linhas.reduce((t, x) => t + x.anterior, 0),
    projetos: listaProjetos,
    totalProjetos: listaProjetos.reduce((t, x) => t + x.valor, 0),
  };
}

/**
 * Gasto × pagamento (R13): o que se consumiu no mês (competência) e o que de
 * fato saiu das contas de caixa no mês — inclusive a fatura do mês anterior.
 */
export function gastoEPagamento(estado, mes) {
  const { de, ate } = intervaloDoMes(mes);
  const gasto = gastos(estado, de, ate).reduce((t, g) => t + g.valor, 0);
  let despesasNoCaixa = 0;
  let faturasPagas = 0;
  for (const l of lancados(estado)) {
    if (!l.confirmado || l.dataCaixa < de || l.dataCaixa > ate || !ehCaixa(estado, l.contaId)) continue;
    if (l.tipo === 'despesa' && !estado.categorias[l.categoriaId]?.obrigatoria) despesasNoCaixa += l.valor;
    if (l.tipo === 'estorno') despesasNoCaixa -= l.valor;
    if (l.tipo === 'pagamento_fatura') faturasPagas += l.valor;
  }
  const saiu = despesasNoCaixa + faturasPagas;
  return { gasto, saiu, despesasNoCaixa, faturasPagas, diferenca: gasto - saiu };
}

/** Taxa de poupança (I4): (renda disponível − gasto de rotina) ÷ renda disponível. */
export function taxaDePoupanca(estado, mes) {
  const { de, ate } = intervaloDoMes(mes);
  const doMes = lancados(estado).filter((l) => l.confirmado && l.dataCompetencia >= de && l.dataCompetencia <= ate);
  const renda = rendaDisponivel(estado, doMes);
  const rotina = gastos(estado, de, ate).filter((g) => !g.projeto).reduce((t, g) => t + g.valor, 0);
  return { renda, rotina, sobrou: renda - rotina, taxa: renda > 0 ? (renda - rotina) / renda : null };
}

/** Gastos pequenos (R9): os de rotina abaixo do corte. */
export function gastosPequenos(estado, mes, corte = 5000) {
  const { de, ate } = intervaloDoMes(mes);
  const rotina = gastos(estado, de, ate).filter((g) => !g.projeto && g.l.tipo === 'despesa');
  const pequenos = rotina.filter((g) => g.valor < corte);
  const total = rotina.reduce((t, g) => t + g.valor, 0);
  const soma = pequenos.reduce((t, g) => t + g.valor, 0);
  return { corte, quantos: pequenos.length, soma, parte: total ? soma / total : 0, lancamentos: pequenos.map((g) => g.l.id) };
}

/**
 * O ritmo do mês (I5): o gasto de rotina acumulado dia a dia, este mês e o
 * anterior, no mesmo dia. { dias, atual: [centavos|null], anterior: [centavos],
 * hoje, parte } — `parte` é quanto do mês anterior inteiro já foi gasto até
 * hoje.
 */
export function ritmoDoMes(estado, mes, dia = hoje()) {
  const ant = somarMeses(`${mes}-01`, -1).slice(0, 7);
  const ultimoDia = (m) => Number(fimDoMes(`${m}-01`).slice(8, 10));
  const dias = Math.max(ultimoDia(mes), ultimoDia(ant));
  const acumulado = (m, ate) => {
    const porDia = new Array(dias + 1).fill(0);
    for (const g of gastos(estado, `${m}-01`, fimDoMes(`${m}-01`))) {
      if (!g.projeto) porDia[Number(g.l.dataCompetencia.slice(8, 10))] += g.valor;
    }
    const saida = [];
    let t = 0;
    for (let d = 1; d <= dias; d += 1) {
      t += porDia[d];
      saida.push(d > ate ? null : t);
    }
    return saida;
  };
  const corrente = mes === mesDe(dia);
  const hojeNoMes = corrente ? Number(dia.slice(8, 10)) : ultimoDia(mes);
  const atual = acumulado(mes, hojeNoMes);
  const anterior = acumulado(ant, ultimoDia(ant));
  const totalAnterior = anterior[ultimoDia(ant) - 1] ?? 0;
  const agora = atual[hojeNoMes - 1] ?? 0;
  return {
    dias, atual, anterior, mesAnterior: ant, hoje: hojeNoMes, corrente,
    noMesmoDia: anterior[Math.min(hojeNoMes, ultimoDia(ant)) - 1] ?? 0,
    agora, parte: totalAnterior ? agora / totalAnterior : null,
  };
}

/**
 * Entrou × saiu (12 meses terminando em `mes`): renda disponível, gasto de
 * rotina e o pago por envelope, mês a mês. Os meses antes do primeiro
 * lançamento ficam de fora.
 */
export function fluxoDosMeses(estado, mes, quantos = 12) {
  const primeiro = primeiroMes(estado);
  if (!primeiro) return [];
  const inicio = [primeiro, somarMeses(`${mes}-01`, -(quantos - 1)).slice(0, 7)].sort()[1];
  if (inicio > mes) return [];
  const meses = mesesEntre(inicio, mes).map((m) => {
    const de = `${m}-01`;
    const ate = fimDoMes(de);
    const doMes = lancados(estado).filter((l) => l.confirmado && l.dataCompetencia >= de && l.dataCompetencia <= ate);
    let rotina = 0;
    let projeto = 0;
    for (const g of gastos(estado, de, ate)) {
      if (g.projeto) projeto += g.valor; else rotina += g.valor;
    }
    const renda = Math.max(0, rendaDisponivel(estado, doMes));
    return { mes: m, renda, rotina: Math.max(0, rotina), projeto: Math.max(0, projeto), sobrou: renda - rotina };
  });
  // Os meses vazios do começo (antes de haver renda ou gasto) não dizem nada.
  const primeiroCheio = meses.findIndex((x) => x.renda || x.rotina || x.projeto);
  return primeiroCheio < 0 ? [] : meses.slice(primeiroCheio);
}

/**
 * O investido hoje, por classe (as contas sem ativos e o caixa parado da
 * corretora entram como "caixa e poupança") e por dono — de qual envelope é,
 * e o sem dono (design/11).
 */
export function investido(estado, dia = hoje()) {
  const porClasse = new Map();
  for (const c of Object.values(estado.contas)) {
    if (c.tipo !== 'investimento') continue;
    const r = resumoDaConta(estado, c, dia);
    for (const p of r.posicoes) somar(porClasse, p.ativo.classe, p.valorAtual);
    if (r.caixa > 0) somar(porClasse, 'caixa', r.caixa);
  }
  const classes = [...porClasse.entries()]
    .map(([id, valor]) => ({ id, nome: id === 'caixa' ? 'Caixa e poupança' : nomeDaClasse(id), valor, ordem: CLASSES.findIndex((x) => x.id === id) }))
    .filter((x) => x.valor > 0);

  // De quem é: só os lugares que são investimento (ativos, a conta que rende
  // e o caixa parado da corretora) — a corrente fica de fora.
  const donos = donosNoDia(estado, dia);
  const porDono = new Map();
  for (const x of donos.porLugar.values()) {
    const conta = estado.contas[x.lugar.contaId];
    if (!x.lugar.ativo && conta?.tipo !== 'investimento') continue;
    for (const [env, v] of x.donos) somar(porDono, env, v);
    if (x.semDono > 0) somar(porDono, '', x.semDono);
  }
  const envelopes = [...porDono.entries()]
    .map(([id, valor]) => ({ id, nome: id ? estado.envelopes?.[id]?.nome ?? 'envelope' : 'sem dono', valor }))
    .filter((x) => x.valor > 0);
  return { classes, envelopes, total: classes.reduce((t, x) => t + x.valor, 0) };
}

// ── Futuro ──────────────────────────────────────────────────────────────────

/**
 * O saldo das contas de caixa, dia a dia, pelos próximos `dias` (R14). Só o
 * que é conhecido (decisão dele, design/12 §3): agendados, recorrentes,
 * faturas, parcelas de contrato. O gasto variável não está dentro.
 *
 * { pontos: [{ dia, saldo, itens }], inicio, pior: { dia, saldo }, estimado }
 */
export function projecaoDeSaldo(estado, dias = 90, dia = hoje()) {
  const caixas = Object.values(estado.contas).filter((c) => CAIXA.has(c.tipo) && !c.arquivada);
  const ids = new Set(caixas.map((c) => c.id));
  const inicio = caixas.reduce((t, c) => t + saldoReal(estado, c.id), 0);
  const ate = somarDias(dia, dias);
  const porDia = new Map();
  let estimado = false;
  const lancar = (quando, valor, nome) => {
    if (!valor) return;
    const d = quando < dia ? dia : quando;
    if (d > ate) return;
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push({ valor, nome });
  };
  const nomeDe = (l) => estado.detalhes?.[l.detalheId]?.nome
    ?? estado.recorrencias?.[l.recorrenciaId]?.nome
    ?? estado.categorias[l.categoriaId]?.nome
    ?? estado.contas[l.contaDestinoId]?.nome
    ?? l.tipo;

  // O que foi lançado e ainda não saiu (agendado ou vencido).
  for (const l of visiveis(estado, dia)) {
    if (l.confirmado) continue;
    if (ids.has(l.contaId)) lancar(l.dataCaixa, -sinalDeSaida(l), nomeDe(l));
    if (ids.has(l.contaDestinoId)) lancar(l.dataCaixa, l.valor, nomeDe(l));
  }
  // As ocorrências de recorrência e as parcelas de contrato que ainda vão cair.
  // A do cartão sai, no vencimento da fatura dela, da conta que paga o cartão.
  for (const o of ocorrenciasPrevistas(estado, dia, ate, dia)) {
    const conta = estado.contas[o.contaId];
    // O que sai da folha para o caixa é o líquido, previsto logo abaixo.
    if (conta?.tipo === 'folha') continue;
    if (o.estimado) estimado = true;
    if (conta?.tipo === 'cartao') {
      if (ids.has(conta.pagaCom)) lancar(o.dataCaixa, -sinalDeSaida(o), nomeDe(o));
      continue;
    }
    if (ids.has(o.contaId)) lancar(o.dataCaixa, -sinalDeSaida(o), nomeDe(o));
    if (ids.has(o.contaDestinoId)) lancar(o.dataCaixa, o.valor, nomeDe(o));
  }
  // O salário: o líquido de cada folha que ainda vai cair no caixa (D31).
  for (const folha of Object.values(estado.contas)) {
    if (folha.tipo !== 'folha' || !ids.has(folha.liquidoPara)) continue;
    for (const mes of mesesEntre(mesDe(dia), mesDe(ate))) {
      const lp = liquidoPrevisto(estado, folha.id, mes, dia);
      if (!lp) continue;
      if (lp.estimado) estimado = true;
      lancar(lp.data, lp.valor, `Salário ${folha.nome}`);
    }
  }
  // As faturas que faltam pagar, no vencimento (a vencida, hoje).
  for (const c of Object.values(estado.contas)) {
    if (c.tipo !== 'cartao' || !ids.has(c.pagaCom)) continue;
    for (const f of faturas(estado, c.id, dia) ?? []) {
      if (f.aPagar > 0) lancar(f.vencimento, -f.aPagar, `Fatura ${c.nome}`);
    }
  }

  const pontos = [];
  let saldo = inicio;
  let pior = { dia, saldo: inicio };
  for (let d = dia; d <= ate; d = somarDias(d, 1)) {
    const itens = porDia.get(d) ?? [];
    saldo += itens.reduce((t, x) => t + x.valor, 0);
    pontos.push({ dia: d, saldo, itens });
    if (saldo < pior.saldo) pior = { dia: d, saldo };
  }
  return { pontos, inicio, pior, estimado, fim: saldo };
}

/**
 * Comprometimento (R15): de cada um dos próximos `meses` (o corrente
 * incluído), quanto já tem dono — cartão, contratos, recorrentes, agendados —
 * e a renda prevista quando houver recorrência de receita.
 */
export function comprometimento(estado, meses = 12, dia = hoje()) {
  const lista = mesesEntre(mesDe(dia), somarMeses(dia, meses - 1).slice(0, 7));
  const ate = fimDoMes(`${lista[lista.length - 1]}-01`);
  const linhas = new Map(lista.map((m) => [m, { mes: m, cartao: 0, contratos: 0, recorrentes: 0, agendados: 0, renda: 0, estimado: false }]));
  const em = (dataCaixa) => linhas.get(mesDe(dataCaixa < dia ? dia : dataCaixa));

  for (const c of Object.values(estado.contas)) {
    if (c.tipo !== 'cartao') continue;
    for (const f of faturas(estado, c.id, dia) ?? []) {
      const x = f.aPagar > 0 ? em(f.vencimento) : null;
      if (x) x.cartao += f.aPagar;
    }
  }
  for (const o of ocorrenciasPrevistas(estado, dia, ate, dia)) {
    const x = em(o.dataCaixa);
    if (!x) continue;
    if (o.estimado) x.estimado = true;
    const destino = estado.contas[o.contaDestinoId];
    if (o.tipo === 'receita') x.renda += o.valor;
    else if (o.tipo === 'despesa' && estado.categorias[o.categoriaId]?.obrigatoria) x.renda -= o.valor;
    else if (destino?.tipo === 'divida') x.contratos += o.valor;
    else if (estado.contas[o.contaId]?.tipo === 'cartao') x.cartao += sinalDeSaida(o);
    else if (o.tipo === 'despesa') x.recorrentes += o.valor;
  }
  for (const l of lancados(estado)) {
    if (l.confirmado || l.tipo !== 'despesa' || !ehCaixa(estado, l.contaId)) continue;
    const x = em(l.dataCaixa);
    if (x) x.agendados += l.valor;
  }
  return [...linhas.values()].map((x) => ({
    ...x,
    total: x.cartao + x.contratos + x.recorrentes + x.agendados,
    renda: x.renda > 0 ? x.renda : null,
  }));
}

/**
 * Custo de existir (R5): as recorrentes de despesa, mensalizadas. Poupar
 * (transferência) não entra, nem imposto (obrigatória). Com a renda mensal
 * prevista das recorrentes de receita, quando houver.
 */
export function custoDeExistir(estado, dia = hoje()) {
  const seriesDeContrato = new Set(Object.values(estado.contas).map((c) => c.contrato?.recorrenciaId).filter(Boolean));
  const todos = lancados(estado);
  const ativa = (r) => !r.arquivada && !seriesDeContrato.has(r.id) && (!r.fim || r.fim >= dia) && estado.contas[r.contaId] && !estado.contas[r.contaId].arquivada;
  const mensal = (r) => {
    const { valor, estimado } = valorDaSerie(r, todos.filter((l) => l.recorrenciaId === r.id), dia);
    return { valor: r.periodicidade === 'anual' ? Math.round(valor / 12) : valor, cheio: valor, estimado };
  };
  const itens = [];
  let renda = 0;
  for (const r of Object.values(estado.recorrencias ?? {})) {
    if (!ativa(r)) continue;
    const obrigatoria = estado.categorias[r.categoriaId]?.obrigatoria;
    const v = mensal(r);
    if (r.tipo === 'receita') { renda += v.valor; continue; }
    if (r.tipo !== 'despesa') continue;
    if (obrigatoria) { renda -= v.valor; continue; }
    itens.push({
      recorrencia: r, nome: r.nome || estado.categorias[r.categoriaId]?.nome || 'recorrente',
      mensal: v.valor, anual: r.periodicidade === 'anual' ? v.cheio : v.valor * 12, anualDeVerdade: r.periodicidade === 'anual', estimado: v.estimado,
    });
  }
  itens.sort((a, b) => b.mensal - a.mensal);
  const total = itens.reduce((t, x) => t + x.mensal, 0);
  return { itens, total, renda: renda > 0 ? renda : null, parte: renda > 0 ? total / renda : null, estimado: itens.some((x) => x.estimado) };
}

// ── Para onde vai ───────────────────────────────────────────────────────────

/** O período da aba: o mês, ou os últimos 3 ou 12 meses terminando nele. */
export function periodo(mes, quantos = 1) {
  const primeiro = somarMeses(`${mes}-01`, -(quantos - 1)).slice(0, 7);
  return { de: `${primeiro}-01`, ate: fimDoMes(`${mes}-01`), meses: quantos };
}

/**
 * Para onde vai, no período: por etiqueta (R4), por descrição (R8), por
 * titular da conta (R12) e quando (R10). Tudo sobre o gasto inteiro (rotina e
 * projeto): é recorte, não tendência.
 */
export function paraOndeVai(estado, de, ate, meses = 1) {
  const lista = gastos(estado, de, ate);
  const etiquetas = new Map();
  const descricoes = new Map();
  const titulares = new Map();
  const semana = [0, 0, 0, 0, 0, 0, 0];
  const quinzenas = [0, 0];
  let total = 0;
  for (const g of lista) {
    total += g.valor;
    for (const t of g.l.etiquetas ?? []) {
      if (!etiquetas.has(t)) etiquetas.set(t, { etiquetaId: t, valor: 0, vezes: 0, categorias: new Set(), lancamentos: [] });
      const x = etiquetas.get(t);
      x.valor += g.valor; x.vezes += 1; x.categorias.add(g.categoriaId); x.lancamentos.push(g.l.id);
    }
    if (g.l.detalheId) {
      if (!descricoes.has(g.l.detalheId)) descricoes.set(g.l.detalheId, { detalheId: g.l.detalheId, valor: 0, vezes: 0, categorias: new Map(), lancamentos: [] });
      const x = descricoes.get(g.l.detalheId);
      x.valor += g.valor; x.vezes += g.l.tipo === 'despesa' ? 1 : 0; somar(x.categorias, g.categoriaId, g.valor); x.lancamentos.push(g.l.id);
    }
    const titular = estado.contas[g.l.contaId]?.titular ?? '';
    somar(titulares, titular, g.valor);
    if (g.l.tipo === 'despesa' && !g.projeto) {
      semana[new Date(`${g.l.dataCompetencia}T12:00:00`).getDay()] += g.valor;
      quinzenas[Number(g.l.dataCompetencia.slice(8, 10)) > 15 ? 1 : 0] += g.valor;
    }
  }
  const ordenar = (m) => [...m.values()].sort((a, b) => b.valor - a.valor);
  return {
    total,
    meses,
    etiquetas: ordenar(etiquetas).map((x) => ({ ...x, porMes: Math.round(x.valor / meses), categorias: x.categorias.size })),
    descricoes: ordenar(descricoes).map((x) => ({ ...x, categoriaId: [...x.categorias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null })),
    titulares: [...titulares.entries()].map(([pessoaId, valor]) => ({ pessoaId, valor })).sort((a, b) => b.valor - a.valor),
    semana,
    quinzenas,
  };
}

// ── Patrimônio ──────────────────────────────────────────────────────────────

/** O que se deve no cartão num dia: compras até ali (pela data da compra) menos o que foi pago. */
function dividaDoCartao(estado, conta, dia) {
  let saldo = conta.dataInicial && conta.dataInicial > dia ? 0 : conta.saldoInicial ?? 0;
  for (const l of lancados(estado)) {
    if (!l.confirmado) continue;
    if (l.contaId === conta.id && l.dataCompetencia <= dia) saldo -= sinalDeSaida(l);
    if (l.contaDestinoId === conta.id && l.dataCaixa <= dia) saldo += l.valor;
  }
  return Math.max(0, -saldo);
}

/** O valor de uma conta de investimento num dia: os ativos e o caixa dela. */
function valorDoInvestimento(estado, conta, dia) {
  if (dia >= hoje()) return resumoDaConta(estado, conta, dia).valorAtual;
  const ativos = ativosDaConta(estado, conta.id);
  let valor = ativos.reduce((t, a) => t + (posicao(estado, a.id, dia)?.valorAtual ?? 0), 0);
  if (!conta.caixaEm) {
    valor += saldoAte(estado, conta.id, dia);
    if (!ativos.length) {
      const foto = (conta.fotos ?? []).filter((f) => f.data <= dia).pop();
      if (foto) valor += foto.valor - saldoAte(estado, conta.id, foto.data);
    }
  }
  return valor;
}

/**
 * O patrimônio financeiro num dia (R21, D23): contas + investimentos − o que
 * se deve nos cartões − o saldo devedor das dívidas. Conta que ainda não
 * existia no dia não entra.
 */
export function patrimonioNoDia(estado, dia = hoje()) {
  const existia = (c) => !c.dataInicial || c.dataInicial <= dia;
  let caixa = 0;
  let investimentos = 0;
  let cartoes = 0;
  let dividas = 0;
  for (const c of Object.values(estado.contas)) {
    // Conta e cartão só existem depois do marco deles; investimento e dívida
    // trazem a própria história (a aplicação de antes, o contrato).
    if ((CAIXA.has(c.tipo) || c.tipo === 'cartao') && !existia(c)) continue;
    if (CAIXA.has(c.tipo)) caixa += dia >= hoje() ? saldoReal(estado, c.id) : saldoAte(estado, c.id, dia);
    else if (c.tipo === 'investimento') investimentos += valorDoInvestimento(estado, c, dia);
    else if (c.tipo === 'cartao') cartoes += dividaDoCartao(estado, c, dia);
    else if (c.tipo === 'divida') dividas += saldoDevedor(estado, c.id, dia) ?? 0;
  }
  return { dia, caixa, investimentos, cartoes, dividas, total: caixa + investimentos - cartoes - dividas };
}

/** O primeiro mês com lançamento: daí em diante há o que mostrar. */
export function primeiroMes(estado) {
  let primeiro = null;
  for (const l of lancados(estado)) if (!primeiro || l.dataCompetencia < primeiro) primeiro = l.dataCompetencia;
  return primeiro ? mesDe(primeiro) : null;
}

/** O patrimônio no fim de cada mês (até 12 para trás) e hoje. */
export function curvaDoPatrimonio(estado, dia = hoje(), maximo = 12) {
  const desde = primeiroMes(estado);
  if (!desde) return [];
  const ultimoFechado = somarMeses(`${mesDe(dia)}-01`, -1).slice(0, 7);
  const inicio = [desde, somarMeses(`${mesDe(dia)}-01`, -maximo).slice(0, 7)].sort()[1];
  const pontos = inicio <= ultimoFechado ? mesesEntre(inicio, ultimoFechado).map((m) => patrimonioNoDia(estado, fimDoMes(`${m}-01`))) : [];
  pontos.push(patrimonioNoDia(estado, dia));
  return pontos;
}

/**
 * O dinheiro trabalhando, no período: quanto os investimentos renderam e
 * quanto foi pago de juros nas dívidas (ideia nova, design/12 §3).
 */
export function dinheiroTrabalhando(estado, de, ate) {
  const vespera = somarDias(de, -1);
  let rendeu = 0;
  for (const a of Object.values(estado.ativos ?? {})) {
    const fim = posicao(estado, a.id, ate)?.rendeu ?? 0;
    const comeco = posicao(estado, a.id, vespera)?.rendeu ?? 0;
    rendeu += fim - comeco;
  }
  // A poupança sem ativos rende pela foto.
  for (const c of Object.values(estado.contas)) {
    if (c.tipo !== 'investimento' || c.caixaEm || ativosDaConta(estado, c.id).length) continue;
    // O rendimento acumulado até um dia: a última foto menos o que tinha sido posto até ela.
    const r = (d) => {
      const foto = (c.fotos ?? []).filter((f) => f.data <= d).pop();
      return foto ? foto.valor - saldoAte(estado, c.id, foto.data) : 0;
    };
    rendeu += r(ate) - r(vespera);
  }
  let juros = 0;
  const porDivida = [];
  for (const c of Object.values(estado.contas)) {
    if (c.tipo !== 'divida') continue;
    const cr = cronograma(estado, c.id);
    if (!cr) continue;
    const doPeriodo = cr.parcelas.filter((p) => p.data >= de && p.data <= ate && !p.antesDoApp && p.data <= hoje());
    const j = doPeriodo.reduce((t, p) => t + p.juros, 0);
    if (j) porDivida.push({ conta: c, juros: j, parcelas: doPeriodo.length });
    juros += j;
  }
  return { rendeu, juros, porDivida, saldo: rendeu - juros };
}

// ── Tendência ───────────────────────────────────────────────────────────────

const esporadico = (estado, l) => Boolean(estado.recorrencias?.[l.recorrenciaId]?.esporadica);

/**
 * O primeiro mês com gasto. É dele que a tendência conta: o "como começou" de
 * um investimento de anos atrás não é histórico de gasto.
 */
export function primeiroMesDeGasto(estado) {
  let primeiro = null;
  for (const l of lancados(estado)) {
    if (!l.confirmado || (l.tipo !== 'despesa' && l.tipo !== 'estorno')) continue;
    if (!primeiro || l.dataCompetencia < primeiro) primeiro = l.dataCompetencia;
  }
  return primeiro ? mesDe(primeiro) : null;
}

/** Meses fechados com gasto antes de `mes` (o histórico que a tendência pede). */
export function mesesDeHistorico(estado, mes = mesDe(hoje())) {
  const primeiro = primeiroMesDeGasto(estado);
  if (!primeiro || primeiro >= mes) return 0;
  return mesesEntre(primeiro, somarMeses(`${mes}-01`, -1).slice(0, 7)).length;
}

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Por que o mês apertou (R3): cada categoria do mês contra a mediana dos meses
 * anteriores (até 6), em reais. Esporádicos (IPVA, matrícula) e projetos fora
 * da mediana e à parte na lista.
 */
export function porQueApertou(estado, mes) {
  const anteriores = mesesEntre(somarMeses(`${mes}-01`, -6).slice(0, 7), somarMeses(`${mes}-01`, -1).slice(0, 7))
    .filter((m) => m >= (primeiroMesDeGasto(estado) ?? m));
  const doMes = gastos(estado, ...Object.values(intervaloDoMes(mes)));
  const rotina = (g) => !g.projeto && !esporadico(estado, g.l);
  const historico = anteriores.map((m) => {
    const por = new Map();
    for (const g of gastos(estado, ...Object.values(intervaloDoMes(m)))) if (rotina(g)) somar(por, g.categoriaId ?? '', g.valor);
    return por;
  });
  const agora = new Map();
  const lancamentosDe = new Map();
  for (const g of doMes) {
    if (!rotina(g)) continue;
    somar(agora, g.categoriaId ?? '', g.valor);
    if (!lancamentosDe.has(g.categoriaId ?? '')) lancamentosDe.set(g.categoriaId ?? '', []);
    lancamentosDe.get(g.categoriaId ?? '').push(g.l);
  }
  const categorias = new Set([...agora.keys(), ...historico.flatMap((m) => [...m.keys()])]);
  const linhas = [...categorias].map((id) => {
    const normal = mediana(historico.map((m) => m.get(id) ?? 0));
    const valor = agora.get(id) ?? 0;
    const lancs = (lancamentosDe.get(id) ?? []).sort((a, b) => b.valor - a.valor);
    const desvio = valor - normal;
    // Um gasto grande (evento) ou muitos normais (hábito)? A parte valiosa.
    const evento = desvio > 0 && lancs[0] && lancs[0].valor >= desvio * 0.6 ? lancs[0] : null;
    return { categoriaId: id, valor, normal, desvio, vezes: lancs.length, evento };
  }).filter((x) => x.desvio !== 0).sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio));
  const esporadicos = doMes.filter((g) => !g.projeto && esporadico(estado, g.l));
  const projetos = doMes.filter((g) => g.projeto);
  return {
    meses: anteriores.length,
    linhas,
    acima: linhas.reduce((t, x) => t + x.desvio, 0),
    esporadicos: esporadicos.map((g) => ({ l: g.l, valor: g.valor })),
    totalEsporadicos: esporadicos.reduce((t, g) => t + g.valor, 0),
    totalProjetos: projetos.reduce((t, g) => t + g.valor, 0),
  };
}

/**
 * A minha inflação (R25): os últimos N meses fechados contra os N anteriores,
 * por categoria, em reais por mês. N vai até 12 — com 6 meses de histórico, 3
 * contra 3. Só rotina; esporádicos fora.
 */
export function minhaInflacao(estado, mes = mesDe(hoje())) {
  const historico = mesesDeHistorico(estado, mes);
  const n = Math.min(12, Math.floor(historico / 2));
  if (n < 3) return { n, historico, linhas: [], geral: null };
  const fimRecente = somarMeses(`${mes}-01`, -1).slice(0, 7);
  const iniRecente = somarMeses(`${mes}-01`, -n).slice(0, 7);
  const fimAntes = somarMeses(`${iniRecente}-01`, -1).slice(0, 7);
  const iniAntes = somarMeses(`${iniRecente}-01`, -n).slice(0, 7);
  const soma = (de, ate) => {
    const m = new Map();
    for (const g of gastos(estado, `${de}-01`, fimDoMes(`${ate}-01`))) {
      if (g.projeto || esporadico(estado, g.l)) continue;
      somar(m, g.categoriaId ?? '', g.valor);
    }
    return m;
  };
  const recente = soma(iniRecente, fimRecente);
  const antes = soma(iniAntes, fimAntes);
  const ids = new Set([...recente.keys(), ...antes.keys()]);
  const linhas = [...ids].map((id) => {
    const a = Math.round((antes.get(id) ?? 0) / n);
    const r = Math.round((recente.get(id) ?? 0) / n);
    return { categoriaId: id, antes: a, agora: r, porMes: r - a, pct: a ? r / a - 1 : null };
  }).filter((x) => x.porMes !== 0).sort((a, b) => Math.abs(b.porMes) - Math.abs(a.porMes));
  const totA = [...antes.values()].reduce((t, v) => t + v, 0);
  const totR = [...recente.values()].reduce((t, v) => t + v, 0);
  return { n, historico, de: iniRecente, ate: fimRecente, linhas, geral: totA ? totR / totA - 1 : null };
}

/**
 * Ano contra ano (R7): o mesmo mês do ano anterior, e o ano até aqui contra o
 * mesmo recorte do ano passado. Gasto inteiro e rotina.
 */
export function anoContraAno(estado, mes) {
  const total = (de, ate, soRotina) => gastos(estado, de, ate).filter((g) => !soRotina || !g.projeto).reduce((t, g) => t + g.valor, 0);
  const anoPassado = somarMeses(`${mes}-01`, -12).slice(0, 7);
  const mesmoMes = {
    agora: total(...Object.values(intervaloDoMes(mes)), true),
    antes: total(...Object.values(intervaloDoMes(anoPassado)), true),
  };
  const ano = mes.slice(0, 4);
  const anoAntes = String(Number(ano) - 1);
  const ateAqui = {
    agora: total(`${ano}-01-01`, fimDoMes(`${mes}-01`), true),
    antes: total(`${anoAntes}-01-01`, fimDoMes(`${anoPassado}-01`), true),
  };
  return { mes, anoPassado, mesmoMes, ateAqui };
}
