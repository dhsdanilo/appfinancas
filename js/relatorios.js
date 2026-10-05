// A tela Relatórios (design/12 §0, D33): duas abas flexíveis — Gastos e
// Patrimônio. Cada uma é número no topo, um gráfico e uma lista que se toca,
// com os filtros dentro (as regras da seleção em design/14). Um relatório
// flexível no lugar de muitos engessados (pedido dele, 05/10/2026).

import * as estado from './core/estado.js';
import { formatar } from './core/dinheiro.js';
import { hoje, diaCurto, nomeDoMes, somarMeses, somarDias } from './core/datas.js';
import { nomeDaCategoria } from './core/lancamentos.js';
import * as rel from './core/relatorios.js';
import * as ex from './core/explorar.js';
import { novoId } from './core/id.js';
import { AREAS } from './app/areas.js';
import { colunas, areas, linhas as graficoDeLinhas, cor } from './app/graficos.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${(v * 100).toFixed(0)}%`;
const comSinal = (v) => (v > 0 ? `+${formatar(v)}` : v < 0 ? `−${formatar(-v)}` : formatar(0));
const valorComSinal = (v) => `${v < 0 ? '−' : ''}${formatar(Math.abs(v))}`;
const mesCurto = (mes) => `${nomeDoMes(mes).split(' ')[0].slice(0, 3)}/${mes.slice(2, 4)}`;
const rotuloDoBalde = (b) => (b.length === 4 ? b : mesCurto(b));
// A variação em %, só quando diz algo: sobre uma base pequena, +1.700% assusta
// e não informa — fica a diferença em reais.
const variacao = (agora, antes) => {
  if (!antes || antes < 0) return '';
  const p = (agora / antes - 1) * 100;
  return Math.abs(p) > 200 ? '' : `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(0)}%`;
};
// Cada período abre no agrupamento natural: anos longos por ano, o resto por mês.
const tempoNatural = (periodo) => (periodo === '5anos' || periodo === 'tudo' ? 'ano' : 'mes');

const ABAS = [
  { id: 'gastos', nome: 'Gastos' },
  { id: 'patrimonio', nome: 'Patrimônio' },
];
const AGRUPAR = [['categoria', 'categoria'], ['etiqueta', 'etiqueta'], ['descricao', 'descrição'], ['conta', 'conta']];
const DIMENSOES = [
  { id: 'categorias', rotulo: 'categorias', mais: '+ categoria' },
  { id: 'etiquetas', rotulo: 'etiquetas', mais: '+ etiqueta' },
  { id: 'descricoes', rotulo: 'descrições', mais: '+ descrição' },
  { id: 'contas', rotulo: 'contas', mais: '+ conta ou cartão' },
];

const semFiltro = () => ({ categorias: [], etiquetas: [], descricoes: [], contas: [], cruzar: false });
const vistaPadrao = () => ({ periodo: 'mes', tempo: 'mes', natureza: 'gasto', agrupar: 'categoria' });

// O que está na tela. A seleção (filtros + vista) é o que se salva.
const tela = {
  aba: 'gastos',
  mes: hoje().slice(0, 7),
  filtros: semFiltro(),
  vista: vistaPadrao(),
  salvaId: null,
  filtrosAbertos: false,
  salvando: false,
  pat: { periodo: '12', tempo: 'mes', contas: [], filtrosAbertos: false },
};
try {
  const v = JSON.parse(localStorage.getItem('relatorios.tela') ?? 'null');
  if (v) {
    if (ABAS.some((a) => a.id === v.aba)) tela.aba = v.aba;
    tela.filtros = { ...semFiltro(), ...v.filtros };
    tela.vista = { ...vistaPadrao(), ...v.vista };
    tela.salvaId = v.salvaId ?? null;
    tela.pat = { ...tela.pat, ...v.pat, filtrosAbertos: false };
  }
} catch {
  // sem armazenamento: abre no padrão
}
const guardar = () => {
  try {
    localStorage.setItem('relatorios.tela', JSON.stringify({ aba: tela.aba, filtros: tela.filtros, vista: tela.vista, salvaId: tela.salvaId, pat: tela.pat }));
  } catch { /* só não lembra */ }
};

let ativa = false;
let app = null;
// As linhas abertas (descem até os lançamentos): chave → ids.
const abertas = new Set();
// O que a aba calculou, para os gráficos desenharem depois do HTML.
let calculado = null;

// ── pintura ───────────────────────────────────────────────────────────────

async function pintar() {
  if (!ativa) return;
  app = await estado.calcular();
  document.body.dataset.area = 'relatorios';
  $('abas-relatorios').innerHTML = ABAS
    .map((a) => `<button type="button" data-rel-aba="${a.id}" aria-pressed="${a.id === tela.aba}">${esc(a.nome)}</button>`).join('');
  $('periodo-relatorios').hidden = true;
  $('corpo-relatorios').innerHTML = tela.aba === 'gastos' ? abaGastos() : abaPatrimonio();
  if (tela.aba === 'gastos') desenharGastos(); else desenharPatrimonio();
  guardar();
}

/** Uma linha que abre nos lançamentos que a formam. */
function linhaQueAbre(chave, conteudo, ids) {
  const aberta = abertas.has(chave);
  return `<button type="button" class="linha-rel ${aberta ? 'aberta' : ''}" data-rel-abrir="${esc(chave)}" aria-expanded="${aberta}">${conteudo}</button>
    ${aberta ? listaDeLancamentos(ids) : ''}`;
}

function listaDeLancamentos(ids) {
  const lista = ids.map((id) => app.lancamentos[id]).filter(Boolean)
    .sort((a, b) => (a.dataCompetencia < b.dataCompetencia ? 1 : -1));
  return `<ol class="lancamentos-rel">${lista.map((l) => {
    const descricao = app.detalhes?.[l.detalheId]?.nome ?? nomeDaCategoria(app, l.categoriaId) ?? l.tipo;
    const sinal = l.tipo === 'despesa' ? '−' : '+';
    return `<li><span class="quando">${diaCurto(l.dataCompetencia)}</span>
      <span class="nome-linha">${esc(descricao)}<span class="fino">${esc([nomeDaCategoria(app, l.categoriaId), app.contas[l.contaId]?.nome].filter(Boolean).join(' · '))}</span></span>
      <span class="valor-lancado">${sinal} ${formatar(l.valor)}</span></li>`;
  }).join('')}</ol>`;
}

/** A barra de uma linha: o tamanho dela contra o maior da lista. */
const barra = (valor, maior) => `<span class="barra-rel"><i style="width:${maior > 0 ? Math.max(1, Math.round((Math.max(0, valor) / maior) * 100)) : 0}%"></i></span>`;

const nomeCat = (id) => nomeDaCategoria(app, id) || 'sem categoria';

/** O nome de uma chave da lista ou da pilha, em qualquer agrupamento. */
function nomeDaChave(agrupar, chave) {
  if (chave === 'outras') return 'outras';
  if (agrupar === 'etiqueta') return chave === '—' ? 'sem etiqueta' : app.etiquetas?.[chave]?.nome ?? 'etiqueta';
  if (agrupar === 'descricao') return chave === '—' ? 'sem descrição' : app.detalhes?.[chave]?.nome ?? 'descrição';
  if (agrupar === 'conta') return app.contas?.[chave]?.nome ?? 'conta';
  return nomeCat(chave === '—' ? null : chave);
}

function compacto(v) {
  const reais = v / 100;
  const abs = Math.abs(reais);
  const sinal = reais < 0 ? '−' : '';
  if (abs >= 1000) return `${sinal}${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: abs >= 10000 ? 0 : 1 })} mil`;
  return `${sinal}${Math.round(abs).toLocaleString('pt-BR')}`;
}

/** Os botões de escolha única (período, mês/ano, agrupamento). */
const chips = (dado, opcoes, atual, rotulo) => `<span class="chips-periodo inline" role="group" aria-label="${esc(rotulo)}">${opcoes.map(([v, n]) =>
  `<button type="button" data-${dado}="${v}" aria-pressed="${v === atual}">${esc(n)}</button>`).join('')}</span>`;

// ── filtros (design/14 §2) ────────────────────────────────────────────────

function nomeDoItem(dim, id) {
  if (dim === 'categorias') return nomeCat(id);
  if (dim === 'etiquetas') return app.etiquetas?.[id]?.nome ?? 'etiqueta';
  if (dim === 'descricoes') return app.detalhes?.[id]?.nome ?? 'descrição';
  return app.contas?.[id]?.nome ?? 'conta';
}

/** As opções que ainda dá para acrescentar a uma dimensão. */
function opcoesDe(dim, escolhidos, tiposDeConta) {
  const ja = new Set(escolhidos);
  const por = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  const opt = (x) => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`;
  if (dim === 'categorias') {
    const nat = tela.vista.natureza === 'renda' ? 'receita' : 'despesa';
    return Object.values(app.categorias).filter((c) => !c.arquivada && !ja.has(c.id) && c.natureza === nat)
      .map((c) => ({ ...c, nome: nomeCat(c.id) })).sort(por).map(opt).join('');
  }
  if (dim === 'etiquetas') return Object.values(app.etiquetas ?? {}).filter((t) => !t.arquivada && !ja.has(t.id)).sort(por).map(opt).join('');
  if (dim === 'descricoes') return Object.values(app.detalhes ?? {}).filter((d) => !d.arquivado && !ja.has(d.id)).sort(por).map(opt).join('');
  return Object.values(app.contas).filter((c) => !c.arquivada && !ja.has(c.id) && tiposDeConta(c)).sort(por).map(opt).join('');
}

function linhaDeFiltro(dim, rotulo, mais, escolhidos, tiposDeConta, prefixo) {
  const chipsEscolhidos = escolhidos.map((id) => `<button type="button" class="chip-ex" data-${prefixo}-tirar="${dim}:${esc(id)}" aria-label="Tirar ${esc(nomeDoItem(dim, id))}">${esc(nomeDoItem(dim, id))} <span aria-hidden="true">×</span></button>`).join('');
  const opcoes = opcoesDe(dim, escolhidos, tiposDeConta);
  return `<div class="linha-filtro-ex"><span class="rotulo-ex">${rotulo}</span>${chipsEscolhidos}
    ${opcoes ? `<select data-${prefixo}-add="${dim}" aria-label="${esc(mais)}"><option value="">${esc(mais)}</option>${opcoes}</select>` : ''}</div>`;
}

const quantosFiltros = (f) => DIMENSOES.reduce((t, d) => t + f[d.id].length, 0);

// ── Gastos ────────────────────────────────────────────────────────────────

/** A seleção na tela é diferente da salva de onde veio? */
function mexida() {
  const salva = app.selecoes?.[tela.salvaId];
  if (!salva) return false;
  const igual = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const v = { ...vistaPadrao(), ...salva.vista };
  return !DIMENSOES.every((d) => igual(tela.filtros[d.id], salva[d.id] ?? []))
    || Boolean(tela.filtros.cruzar) !== Boolean(salva.cruzar)
    || Object.keys(v).some((k) => v[k] !== tela.vista[k]);
}

function abaGastos() {
  if (tela.salvaId && !app.selecoes?.[tela.salvaId]) tela.salvaId = null;
  const v = tela.vista;
  const salvas = Object.values(app.selecoes ?? {}).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const topo = `<div class="salvas-ex" role="group" aria-label="Seleções salvas">
      <button type="button" data-ex-tudo aria-pressed="${!tela.salvaId && !quantosFiltros(tela.filtros)}">Tudo</button>
      ${salvas.map((x) => `<button type="button" data-ex-abrir="${esc(x.id)}" aria-pressed="${x.id === tela.salvaId}">${esc(x.nome)}</button>`).join('')}
    </div>`;

  const n = quantosFiltros(tela.filtros);
  const umMes = v.periodo === 'mes';
  const controles = `<div class="controles-rel">
      ${chips('rel-natureza', [['gasto', 'gastos'], ['renda', 'renda']], v.natureza, 'Gasto ou renda')}
      ${chips('rel-periodo', ex.PERIODOS, v.periodo, 'Período')}
      ${umMes
        ? `<span class="passos-rel"><button type="button" class="passo" data-rel-mes="-1" aria-label="Mês anterior">‹</button>
            <strong>${esc(nomeDoMes(tela.mes))}</strong>
            <button type="button" class="passo" data-rel-mes="1" aria-label="Mês seguinte"${tela.mes >= hoje().slice(0, 7) ? ' disabled' : ''}>›</button></span>`
        : chips('rel-tempo', [['mes', 'por mês'], ['ano', 'por ano']], v.tempo, 'Agrupar no tempo')}
      <button type="button" class="elo botao-filtros" data-rel-filtros aria-expanded="${tela.filtrosAbertos}">filtros${n ? ` (${n})` : ''} ${tela.filtrosAbertos ? '▴' : '▾'}</button>
    </div>`;

  const tipos = ['categorias', 'etiquetas', 'descricoes'].filter((d) => tela.filtros[d].length).length;
  const salvar = tela.salvando
    ? `<span class="salvar-ex"><input type="text" data-ex-nome maxlength="40" placeholder="nome da seleção" aria-label="Nome da seleção">
        <button type="button" class="principal" data-ex-confirmar>Salvar</button><button type="button" class="elo" data-ex-cancelar>cancelar</button></span>`
    : `<span class="acoes-ex">
        ${tela.salvaId && mexida() ? '<button type="button" class="elo" data-ex-atualizar>salvar</button>' : ''}
        <button type="button" class="elo" data-ex-salvar-como>salvar como…</button>
        ${tela.salvaId ? '<button type="button" class="elo" data-ex-apagar>apagar</button>' : ''}
      </span>`;
  const painel = tela.filtrosAbertos
    ? `<div class="filtro-ex">
        ${DIMENSOES.map((d) => linhaDeFiltro(d.id, d.rotulo, d.mais, tela.filtros[d.id], (c) => !['investimento', 'divida'].includes(c.tipo), 'ex')).join('')}
        <div class="rodape-ex">${tipos >= 2 ? `<label class="cruzar-ex"><input type="checkbox" data-ex-cruzar ${tela.filtros.cruzar ? 'checked' : ''}> só o que tem os dois</label>` : ''}${salvar}</div>
      </div>`
    : (tela.salvando || (tela.salvaId && mexida()) ? `<div class="rodape-ex solto">${salvar}</div>` : '');

  const per = ex.periodo(app, v.periodo, tela.mes);
  const r = ex.relatorio(app, tela.filtros, per, v);
  calculado = { r, per };
  const gasto = v.natureza === 'gasto';
  if (r.vazia) {
    calculado = null;
    return `${topo}${controles}${painel}<p class="nota-rel vazio-rel">Nada ${gasto ? 'gasto' : 'recebido'} ${umMes ? `em ${esc(nomeDoMes(tela.mes))}` : 'no período'}${n ? ' com estes filtros' : ''}.</p>`;
  }

  // O número: total, média, a diferença contra o período anterior de mesmo
  // tamanho — e, num mês só sem filtro, o gasto × pagamento.
  const dif = r.anterior != null ? r.total - r.anterior : null;
  const bomOuRuim = (d) => (!d ? '' : (d > 0) === gasto ? 'ruim' : 'bom');
  const nomeAnterior = umMes
    ? `${nomeDoMes(somarMeses(`${tela.mes}-01`, -1).slice(0, 7)).split(' ')[0]}${r.ateODia ? ` até o dia ${r.ateODia}` : ''}`
    : 'o período anterior';
  let extra = '';
  if (umMes && gasto && !n) {
    const gp = rel.gastoEPagamento(app, tela.mes);
    extra = `<p class="nota-rel">Consumido no mês ${formatar(gp.gasto)} · saiu das contas ${formatar(gp.saiu)}${gp.faturasPagas ? ` (inclui ${formatar(gp.faturasPagas)} de fatura)` : ''}.</p>`;
  }
  const numero = `<div class="numero-rel">
      <p class="rotulo-numero">${gasto ? 'gasto' : 'renda'} ${umMes ? `em ${esc(nomeDoMes(tela.mes).split(' ')[0])}` : 'no período'}</p>
      <p class="valor-rel-grande">${formatar(r.total)}</p>
      <p class="nota-rel">${umMes ? '' : `média ${formatar(r.media)} por ${r.porAno ? 'ano' : 'mês'} · `}${dif != null
        ? `<span class="dif-rel ${bomOuRuim(dif)}">${comSinal(dif)} ${variacao(r.total, r.anterior) ? `(${variacao(r.total, r.anterior)})` : ''}</span> contra ${esc(nomeAnterior)}`
        : 'sem período anterior para comparar'}${gasto && r.projeto ? ` · ${formatar(r.projeto)} pagos por envelope` : ''}</p>
      ${extra}
    </div>`;

  const maior = Math.max(...r.grupos.map((x) => x.valor), 1);
  const lista = r.grupos.slice(0, 30).map((x) => {
    const d = x.valor - x.anterior;
    return linhaQueAbre(`g:${v.agrupar}:${x.chave}`, `
      <span class="nome-rel">${esc(nomeDaChave(v.agrupar, x.chave))}<span class="fino">${x.vezes} ${x.vezes === 1 ? 'vez' : 'vezes'} · ${r.total ? pct(x.valor / r.total) : ''}</span></span>
      ${barra(x.valor, maior)}
      <span class="valor-rel">${formatar(x.valor)}</span>
      <span class="dif-rel ${r.anterior != null ? bomOuRuim(d) : ''}">${r.anterior != null ? comSinal(d) : ''}</span>`, x.lancamentos);
  }).join('');

  return `${topo}${controles}${painel}${numero}
    <div class="grafico-rel" id="g-rel"></div>
    <div class="secao-rel">
      <p class="classe-ativos"><span>por ${chips('rel-agrupar', AGRUPAR, v.agrupar, 'Agrupar a lista')}</span><span>${r.anterior != null ? `contra ${esc(nomeAnterior)}` : ''}</span></p>
      ${lista}
      ${v.agrupar === 'etiqueta' ? '<p class="nota-rel">Um lançamento com duas etiquetas aparece nas duas.</p>' : ''}
    </div>`;
}

function desenharGastos() {
  if (!calculado || !$('g-rel')) return;
  const { r } = calculado;
  const v = tela.vista;
  if (v.periodo === 'mes') {
    // O ritmo: o acumulado do mês contra o mês anterior, pontilhado.
    const rt = ex.ritmo(app, tela.filtros, tela.mes, v.natureza);
    const nome = nomeDoMes(tela.mes).split(' ')[0];
    const nomeAnt = nomeDoMes(rt.mesAnterior).split(' ')[0];
    graficoDeLinhas($('g-rel'), {
      series: [
        { nome, cor: cor(1), valores: rt.atual },
        { nome: nomeAnt, cor: 'var(--tinta-fraca)', valores: rt.anterior, fina: true },
      ],
      rotulos: rt.atual.map((_, i) => String(i + 1)),
      dica: (i) => `<strong>dia ${i + 1}</strong>${rt.atual[i] != null ? `<span>${esc(nome)}: ${formatar(rt.atual[i])}</span>` : ''}<span class="fino">${esc(nomeAnt)}: ${formatar(rt.anterior[i] ?? 0)}</span>`,
      formatar: compacto,
      marcas: rt.corrente && rt.atual[rt.hoje - 1] != null ? [{ serie: 0, i: rt.hoje - 1, texto: formatar(rt.atual[rt.hoje - 1]) }] : [],
    });
    $('g-rel').querySelectorAll('polyline.fina').forEach((p) => p.setAttribute('stroke-dasharray', '4 4'));
    return;
  }
  // Vários meses ou anos: colunas empilhadas, com a média tracejada.
  const cores = new Map(r.series.map((x, i) => [x.chave, x.chave === 'outras' ? 'var(--serie-outros)' : cor(i + 1)]));
  colunas($('g-rel'), {
    grupos: r.baldes.map((b) => ({
      rotulo: rotuloDoBalde(b.chave),
      barras: [r.series.map((x) => ({ valor: b.partes.get(x.chave) ?? 0, cor: cores.get(x.chave) }))],
      dica: `<strong>${esc(b.chave.length === 4 ? b.chave : nomeDoMes(b.chave))}: ${formatar(b.total)}</strong>${r.series.filter((x) => b.partes.get(x.chave)).map((x) =>
        `<span>${esc(nomeDaChave(r.pilha, x.chave))}: ${formatar(b.partes.get(x.chave))}</span>`).join('')}<span class="fino">média ${formatar(r.media)}</span>`,
    })),
    series: r.series.map((x) => ({ nome: nomeDaChave(r.pilha, x.chave), cor: cores.get(x.chave) })),
    linha: r.baldes.length > 1 ? r.baldes.map(() => r.media) : null,
    formatar: compacto,
  });
  $('g-rel').querySelector('.linha-sobre')?.setAttribute('stroke-dasharray', '5 4');
}

// ── Patrimônio ────────────────────────────────────────────────────────────

// As cores seguem a coisa (paleta validada, base.css).
const COR = { contas: cor(3), investimentos: cor(1), dividas: cor(2) };
const PERIODOS_PAT = ex.PERIODOS.filter(([v]) => v !== 'mes');
const entraNoPatrimonio = (c) => c.tipo !== 'folha';

function abaPatrimonio() {
  const p = tela.pat;
  const ids = p.contas.length ? new Set(p.contas) : null;
  const per = ex.periodo(app, p.periodo);
  const curva = rel.patrimonioNoTempo(app, per.meses, p.tempo, ids);
  const agora = curva.at(-1) ?? rel.patrimonioNoDia(app, hoje(), ids);
  // O ponto de partida: o fim do mês (ou ano) antes do período.
  const vespera = somarDias(per.de, -1);
  const inicio = rel.patrimonioNoDia(app, vespera, ids);
  const mudou = agora.total - inicio.total;
  const t = rel.dinheiroTrabalhando(app, per.de, hoje());
  calculado = { curva };

  const n = p.contas.length;
  const controles = `<div class="controles-rel">
      ${chips('pat-periodo', PERIODOS_PAT, p.periodo, 'Período')}
      ${chips('pat-tempo', [['mes', 'por mês'], ['ano', 'por ano']], p.tempo, 'Agrupar no tempo')}
      <button type="button" class="elo botao-filtros" data-pat-filtros aria-expanded="${p.filtrosAbertos}">contas${n ? ` (${n})` : ''} ${p.filtrosAbertos ? '▴' : '▾'}</button>
    </div>
    ${p.filtrosAbertos ? `<div class="filtro-ex">${linhaDeFiltro('contas', 'contas', '+ conta', p.contas, entraNoPatrimonio, 'pat')}<p class="nota-rel">Sem conta escolhida, entram todas.</p></div>` : ''}`;

  const numero = `<div class="numero-rel">
      <p class="rotulo-numero">patrimônio hoje${n ? ' · contas escolhidas' : ''}</p>
      <p class="valor-rel-grande ${agora.total < 0 ? 'negativo' : ''}">${valorComSinal(agora.total)}</p>
      <p class="nota-rel"><span class="dif-rel ${mudou > 0 ? 'bom' : mudou < 0 ? 'ruim' : ''}">${comSinal(mudou)}</span> no período${
        !n && (t.rendeu || t.juros) ? ` · investimentos renderam ${comSinal(t.rendeu)} · juros pagos ${formatar(t.juros)}` : ''}</p>
    </div>`;

  // A lista: cada conta no fim do período e quanto mudou, por área.
  // A arquivada que ainda tem saldo entra: o número do topo conta com ela.
  const contas = Object.values(app.contas).filter((c) => entraNoPatrimonio(c) && (!ids || ids.has(c.id)));
  const lista = AREAS.filter((a) => a.id !== 'folha').map((a) => {
    const daArea = contas.filter((c) => a.tipos.includes(c.tipo))
      .map((c) => ({ c, agora: rel.valorDaConta(app, c, hoje()), antes: rel.valorDaConta(app, c, vespera) }))
      .filter((x) => x.agora || x.antes);
    if (!daArea.length) return '';
    const soma = daArea.reduce((s, x) => s + x.agora, 0);
    return `<p class="classe-ativos"><span>${esc(a.titulo.toLowerCase())}</span><span>${valorComSinal(soma)}</span></p>
      ${daArea.sort((x, y) => Math.abs(y.agora) - Math.abs(x.agora)).map((x) => {
        const d = x.agora - x.antes;
        return `<div class="linha-rel fixa"><span class="nome-rel">${esc(x.c.nome)}${x.c.arquivada ? '<span class="fino">arquivada</span>' : ''}</span><span></span>
          <span class="valor-rel">${valorComSinal(x.agora)}</span>
          <span class="dif-rel ${d > 0 ? 'bom' : d < 0 ? 'ruim' : ''}">${d ? comSinal(d) : ''}</span></div>`;
      }).join('')}`;
  }).join('');

  return `${controles}${numero}
    <div class="grafico-rel" id="g-rel"></div>
    <div class="secao-rel">${lista}
      <p class="nota-rel">O que se tem menos o que se deve. A compra no cartão já é dívida; o empréstimo entra pelo saldo devedor, nunca pela soma das parcelas.</p>
    </div>`;
}

function desenharPatrimonio() {
  const raiz = $('g-rel');
  if (!raiz || !calculado?.curva) return;
  const curva = calculado.curva;
  if (curva.length < 2) { raiz.innerHTML = '<p class="nota-rel">A curva aparece com dois pontos no período — escolha um período maior ou "por mês".</p>'; return; }
  const ultimo = curva.length - 1;
  areas(raiz, {
    pontos: curva.map((p, i) => ({
      rotulo: i === ultimo && p.dia === hoje() ? 'hoje' : rotuloDoBalde(p.balde),
      acima: [Math.max(0, p.caixa), p.investimentos],
      abaixo: [p.cartoes + p.dividas + Math.max(0, -p.caixa)],
      linha: p.total,
      dica: `<strong>${valorComSinal(p.total)}</strong><span>${i === ultimo && p.dia === hoje() ? 'hoje' : `fim de ${p.balde.length === 4 ? p.balde : nomeDoMes(p.balde)}`}</span>
        <span class="fino">contas ${formatar(p.caixa)} · investimentos ${formatar(p.investimentos)}</span>
        <span class="fino">cartões −${formatar(p.cartoes)} · dívidas −${formatar(p.dividas)}</span>`,
    })),
    acima: [{ nome: 'contas', cor: COR.contas }, { nome: 'investimentos', cor: COR.investimentos }],
    abaixo: [{ nome: 'cartões e dívidas', cor: COR.dividas }],
    linha: { nome: 'patrimônio', cor: 'var(--tinta)' },
    formatar: compacto,
  });
}

// ── seleções salvas (design/14 §4) ────────────────────────────────────────

async function salvarSelecao(id, nome) {
  tela.salvaId = id;
  tela.salvando = false;
  await estado.aplicarEvento('selecao.salva', { id, nome, ...tela.filtros, vista: { ...tela.vista } });
}

function abrirSalva(s) {
  tela.filtros = { categorias: [...(s.categorias ?? [])], etiquetas: [...(s.etiquetas ?? [])], descricoes: [...(s.descricoes ?? [])], contas: [...(s.contas ?? [])], cruzar: Boolean(s.cruzar) };
  tela.vista = { ...vistaPadrao(), ...s.vista };
  tela.salvaId = s.id;
  tela.salvando = false;
  abertas.clear();
}

// ── eventos ───────────────────────────────────────────────────────────────

const ESCOLHAS = {
  'relNatureza': (v) => { tela.vista.natureza = v; tela.filtros.categorias = []; },
  'relPeriodo': (v) => { tela.vista.periodo = v; tela.vista.tempo = tempoNatural(v); if (v === 'mes') tela.mes = hoje().slice(0, 7); },
  'relTempo': (v) => { tela.vista.tempo = v; },
  'relAgrupar': (v) => { tela.vista.agrupar = v; },
  'patPeriodo': (v) => { tela.pat.periodo = v; tela.pat.tempo = tempoNatural(v); },
  'patTempo': (v) => { tela.pat.tempo = v; },
};

document.addEventListener('click', async (e) => {
  if (!ativa) return;
  const alvo = e.target.closest('button');
  if (!alvo) return;
  const d = alvo.dataset;
  for (const [chave, aplicar] of Object.entries(ESCOLHAS)) {
    if (d[chave] != null) { aplicar(d[chave]); abertas.clear(); pintar(); return; }
  }
  if (d.relAba) { tela.aba = d.relAba; abertas.clear(); pintar(); return; }
  if (d.relMes) {
    tela.mes = somarMeses(`${tela.mes}-01`, Number(d.relMes)).slice(0, 7);
    if (tela.mes > hoje().slice(0, 7)) tela.mes = hoje().slice(0, 7);
    abertas.clear();
    pintar();
    return;
  }
  if (d.relFiltros != null) { tela.filtrosAbertos = !tela.filtrosAbertos; pintar(); return; }
  if (d.patFiltros != null) { tela.pat.filtrosAbertos = !tela.pat.filtrosAbertos; pintar(); return; }
  if (d.exTudo != null) { tela.filtros = semFiltro(); tela.salvaId = null; tela.salvando = false; abertas.clear(); pintar(); return; }
  if (d.exAbrir) {
    const s = app.selecoes?.[d.exAbrir];
    if (s) { abrirSalva(s); pintar(); }
    return;
  }
  for (const [prefixo, alvoDosFiltros] of [['exTirar', () => tela.filtros], ['patTirar', () => tela.pat]]) {
    if (!d[prefixo]) continue;
    const i = d[prefixo].indexOf(':');
    const dim = d[prefixo].slice(0, i);
    const f = alvoDosFiltros();
    f[dim] = f[dim].filter((x) => x !== d[prefixo].slice(i + 1));
    pintar();
    return;
  }
  if (d.exSalvarComo != null) {
    tela.salvando = true;
    await pintar();
    document.querySelector('[data-ex-nome]')?.focus();
    return;
  }
  if (d.exCancelar != null) { tela.salvando = false; pintar(); return; }
  if (d.exConfirmar != null) {
    const campo = document.querySelector('[data-ex-nome]');
    const nome = campo?.value.trim();
    if (!nome) { campo?.focus(); return; }
    await salvarSelecao(novoId('sel'), nome);
    return;
  }
  if (d.exAtualizar != null) {
    const s = app.selecoes?.[tela.salvaId];
    if (s) await salvarSelecao(s.id, s.nome);
    return;
  }
  if (d.exApagar != null) {
    const s = app.selecoes?.[tela.salvaId];
    if (!s || !confirm(`Apagar a seleção "${s.nome}"? Os lançamentos não mudam.`)) return;
    tela.salvaId = null;
    await estado.aplicarEvento('selecao.removida', { id: s.id });
    return;
  }
  if (d.relAbrir) {
    if (abertas.has(d.relAbrir)) abertas.delete(d.relAbrir); else abertas.add(d.relAbrir);
    pintar();
  }
});

// Acrescentar a um filtro, cruzar, e Enter no nome salva.
document.addEventListener('change', (e) => {
  if (!ativa) return;
  const add = e.target.closest('[data-ex-add], [data-pat-add]');
  if (add && add.value) {
    const f = add.dataset.exAdd ? tela.filtros : tela.pat;
    const dim = add.dataset.exAdd ?? add.dataset.patAdd;
    f[dim] = [...f[dim], add.value];
    pintar();
    return;
  }
  const cruzar = e.target.closest('[data-ex-cruzar]');
  if (cruzar) { tela.filtros.cruzar = cruzar.checked; pintar(); }
});
document.addEventListener('keydown', (e) => {
  if (!ativa || e.key !== 'Enter' || !e.target.closest('[data-ex-nome]')) return;
  e.preventDefault();
  document.querySelector('[data-ex-confirmar]')?.click();
});

document.addEventListener('app:tela', (e) => {
  ativa = e.detail.tela === 'relatorios';
  if (ativa) pintar();
});
estado.aoAplicar(() => pintar());
