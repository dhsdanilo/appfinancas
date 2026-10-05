// A tela Relatórios (design/12-relatorios.md, D28): seis abas — Mês, Futuro,
// Para onde vai, Explorar (design/14, D32), Patrimônio e Tendência. Toda soma desce até os lançamentos
// que a formam (toque na linha); o que precisa de histórico diz quanto falta.

import * as estado from './core/estado.js';
import { formatar } from './core/dinheiro.js';
import { hoje, diaCurto, nomeDoMes, somarMeses } from './core/datas.js';
import { nomeDaCategoria } from './core/lancamentos.js';
import * as rel from './core/relatorios.js';
import * as ex from './core/explorar.js';
import { novoId } from './core/id.js';
import { graficoDeLinha } from './app/grafico.js';
import { colunas, areas, linhas as graficoDeLinhas, pizza, mapaDeBlocos, cor } from './app/graficos.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${(v * 100).toFixed(0)}%`;
const comSinal = (v) => (v > 0 ? `+${formatar(v)}` : v < 0 ? `−${formatar(-v)}` : formatar(0));
const numero = (rotulo, valor, classe = '') =>
  `<div class="numero-faixa ${classe}"><span class="rotulo-numero">${esc(rotulo)}</span><span class="valor-numero">${valor}</span></div>`;
const mesCurto = (mes) => `${nomeDoMes(mes).split(' ')[0].slice(0, 3)}/${mes.slice(2, 4)}`;
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const ABAS = [
  { id: 'mes', nome: 'Mês' },
  { id: 'futuro', nome: 'Futuro' },
  { id: 'onde', nome: 'Para onde vai' },
  { id: 'explorar', nome: 'Explorar' },
  { id: 'patrimonio', nome: 'Patrimônio' },
  { id: 'tendencia', nome: 'Tendência' },
];

const vista = { aba: 'mes', mes: hoje().slice(0, 7), quantos: 1, trabalho: 1 };
try {
  const v = JSON.parse(localStorage.getItem('relatorios.vista') ?? 'null');
  if (v?.aba && ABAS.some((a) => a.id === v.aba)) vista.aba = v.aba;
  if ([1, 3, 12].includes(v?.quantos)) vista.quantos = v.quantos;
} catch {
  // sem armazenamento: abre no padrão
}
// O Explorar (design/14): a seleção na tela, a salva de onde ela veio (se
// veio), o período, as salvas escolhidas para comparar e o "salvar como".
const selVazia = () => ({ categorias: [], etiquetas: [], descricoes: [], contas: [], cruzar: false });
const exp = { sel: selVazia(), salvaId: null, periodo: '12', comparar: [], salvando: false };
try {
  const v = JSON.parse(localStorage.getItem('relatorios.explorar') ?? 'null');
  if (v?.sel) Object.assign(exp, { sel: { ...selVazia(), ...v.sel }, salvaId: v.salvaId ?? null, periodo: v.periodo ?? '12', comparar: v.comparar ?? [] });
} catch {
  // sem armazenamento: começa vazio
}
const guardar = () => {
  try {
    localStorage.setItem('relatorios.vista', JSON.stringify({ aba: vista.aba, quantos: vista.quantos }));
    localStorage.setItem('relatorios.explorar', JSON.stringify({ sel: exp.sel, salvaId: exp.salvaId, periodo: exp.periodo, comparar: exp.comparar }));
  } catch { /* só não lembra */ }
};

let ativa = false;
let app = null;
// As linhas abertas (desce até os lançamentos): chave → ids.
const abertas = new Set();

// ── pintura ───────────────────────────────────────────────────────────────

async function pintar() {
  if (!ativa) return;
  app = await estado.calcular();
  document.body.dataset.area = 'relatorios';
  $('abas-relatorios').innerHTML = ABAS
    .map((a) => `<button type="button" data-rel-aba="${a.id}" aria-pressed="${a.id === vista.aba}">${esc(a.nome)}</button>`).join('');
  pintarPeriodo();
  const corpo = { mes: abaMes, futuro: abaFuturo, onde: abaOnde, explorar: abaExplorar, patrimonio: abaPatrimonio, tendencia: abaTendencia }[vista.aba]();
  $('corpo-relatorios').innerHTML = corpo;
  if (vista.aba === 'mes') desenharMes();
  if (vista.aba === 'explorar') desenharExplorar();
  if (vista.aba === 'futuro') { desenharProjecao(); desenharComprometimento(); }
  if (vista.aba === 'patrimonio') desenharPatrimonio();
  guardar();
}

function pintarPeriodo() {
  const comMes = ['mes', 'onde', 'tendencia'].includes(vista.aba);
  const chips = vista.aba === 'onde'
    ? `<span class="chips-periodo" role="group" aria-label="Quantos meses">${[1, 3, 12].map((q) =>
      `<button type="button" data-rel-quantos="${q}" aria-pressed="${q === vista.quantos}">${q === 1 ? 'o mês' : `${q} meses`}</button>`).join('')}</span>`
    : '';
  $('periodo-relatorios').hidden = !comMes;
  $('periodo-relatorios').innerHTML = comMes
    ? `<button type="button" class="passo" data-rel-mes="-1" aria-label="Mês anterior">‹</button>
      <strong class="rotulo-periodo">${esc(vista.aba === 'onde' && vista.quantos > 1 ? `${mesCurto(somarMeses(`${vista.mes}-01`, 1 - vista.quantos).slice(0, 7))} a ${mesCurto(vista.mes)}` : nomeDoMes(vista.mes))}</strong>
      <button type="button" class="passo" data-rel-mes="1" aria-label="Mês seguinte"${vista.mes >= hoje().slice(0, 7) ? ' disabled' : ''}>›</button>
      ${chips}`
    : '';
}

/**
 * Uma linha que abre nos lançamentos que a formam. Aberta a linha de uma
 * categoria, etiqueta ou descrição, o "explorar ›" leva ao Explorar já com
 * ela (design/14 §1).
 */
function linhaQueAbre(chave, conteudo, ids) {
  const aberta = abertas.has(chave);
  const exploravel = /^(cat|et|desc):./.test(chave) && !chave.endsWith(':null');
  return `<button type="button" class="linha-rel ${aberta ? 'aberta' : ''}" data-rel-abrir="${esc(chave)}" aria-expanded="${aberta}">${conteudo}</button>
    ${aberta && exploravel ? `<p class="explorar-daqui"><button type="button" class="elo" data-explorar="${esc(chave)}">explorar ›</button></p>` : ''}
    ${aberta ? listaDeLancamentos(ids) : ''}`;
}

function listaDeLancamentos(ids) {
  const lista = ids.map((id) => app.lancamentos[id]).filter(Boolean)
    .sort((a, b) => (a.dataCompetencia < b.dataCompetencia ? 1 : -1));
  return `<ol class="lancamentos-rel">${lista.map((l) => {
    const descricao = app.detalhes?.[l.detalheId]?.nome ?? nomeDaCategoria(app, l.categoriaId) ?? l.tipo;
    const sinal = l.tipo === 'estorno' ? '+' : '−';
    return `<li><span class="quando">${diaCurto(l.dataCompetencia)}</span>
      <span class="nome-linha">${esc(descricao)}<span class="fino">${esc([nomeDaCategoria(app, l.categoriaId), app.contas[l.contaId]?.nome].filter(Boolean).join(' · '))}</span></span>
      <span class="valor-lancado">${sinal} ${formatar(l.valor)}</span></li>`;
  }).join('')}</ol>`;
}

/** A barra de uma linha: o tamanho dela contra o maior da lista. */
const barra = (valor, maior) => `<span class="barra-rel"><i style="width:${maior > 0 ? Math.max(1, Math.round((Math.max(0, valor) / maior) * 100)) : 0}%"></i></span>`;

const nomeCat = (id) => nomeDaCategoria(app, id) || 'sem categoria';

// ── Mês ───────────────────────────────────────────────────────────────────

function abaMes() {
  const mes = vista.mes;
  const cats = rel.mesEmCategorias(app, mes);
  const dupla = rel.gastoEPagamento(app, mes);
  const poup = rel.taxaDePoupanca(app, mes);
  const peq = rel.gastosPequenos(app, mes);
  if (!cats.linhas.length && !cats.projetos.length && !poup.renda) {
    return `<p class="vazio">Nenhum gasto nem renda em ${esc(nomeDoMes(mes))}.</p>`;
  }
  const numeros = [numero('gasto de rotina', formatar(cats.rotina))];
  if (cats.totalProjetos) numeros.push(numero('pago por envelope', formatar(cats.totalProjetos)));
  numeros.push(numero('renda disponível', formatar(poup.renda)));
  if (poup.renda) {
    numeros.push(numero('sobrou', comSinal(poup.sobrou), poup.sobrou < 0 ? 'negativo-rel' : ''));
    numeros.push(numero('taxa de poupança', poup.taxa == null ? '—' : pct(poup.taxa), poup.taxa < 0 ? 'negativo-rel' : ''));
  }
  const maior = Math.max(...cats.linhas.map((x) => x.valor), 1);
  const linhas = cats.linhas.map((x) => linhaQueAbre(`cat:${x.categoriaId}`, `
      <span class="nome-rel">${esc(nomeCat(x.categoriaId))}<span class="fino">${x.anterior ? `${formatar(x.anterior)} no mês anterior` : 'nada no mês anterior'}</span></span>
      ${barra(x.valor, maior)}
      <span class="valor-rel">${formatar(x.valor)}</span>
      <span class="dif-rel ${x.diferenca > 0 ? 'ruim' : x.diferenca < 0 ? 'bom' : ''}">${comSinal(x.diferenca)}</span>`, x.lancamentos)).join('');
  const projetos = cats.projetos.map((p) => linhaQueAbre(`proj:${p.envelopeId ?? ''}`, `
      <span class="nome-rel">${esc(p.envelopeId ? app.envelopes?.[p.envelopeId]?.nome ?? 'envelope' : 'extraordinário')}<span class="fino">${p.envelopeId ? 'pago pelo envelope' : 'marcado como extraordinário'}</span></span>
      <span></span><span class="valor-rel">${formatar(p.valor)}</span><span></span>`, p.lancamentos)).join('');

  return `<div class="blocos"><div class="bloco largo total">
      <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${esc(nomeDoMes(mes))}</p>
      <div class="numeros-renda">${numeros.join('')}</div>
      ${poup.renda ? '<p class="nota-rel">Taxa de poupança: da renda disponível (receitas menos IR e previdência oficial), quanto não virou gasto de rotina. O que o envelope pagou já estava guardado.</p>' : ''}
    </div>
    <div class="bloco largo">
      <p class="nome-bloco">o mês do gasto e o mês do pagamento</p>
      <div class="numeros-renda">
        ${numero('consumido no mês', formatar(dupla.gasto))}
        ${numero('saiu das contas', formatar(dupla.saiu))}
        ${numero(dupla.diferenca >= 0 ? 'vai sair depois' : 'veio de antes', formatar(Math.abs(dupla.diferenca)))}
      </div>
      <p class="nota-rel">Saiu das contas: ${formatar(dupla.despesasNoCaixa)} em gastos direto da conta e ${formatar(dupla.faturasPagas)} em faturas pagas. A compra no cartão conta no mês dela; a fatura, no mês em que se paga.</p>
    </div>
    <div class="bloco largo">
      <p class="nome-bloco">ritmo do mês · gasto de rotina acumulado</p>
      <p class="titulo-rel" id="frase-ritmo"></p>
      <div id="g-ritmo"></div>
    </div>
    <div class="bloco largo">
      <p class="nome-bloco">entrou × saiu · mês a mês</p>
      <div id="g-fluxo"></div>
    </div></div>
    <div class="secao-rel">
      <p class="classe-ativos"><span>categorias · rotina</span><span>${formatar(cats.rotina)} · antes ${formatar(cats.rotinaAnterior)}</span></p>
      <div id="g-mapa"></div>
      ${linhas || '<p class="nota">Nenhum gasto de rotina.</p>'}
      ${projetos ? `<p class="classe-ativos"><span>pago por envelope · fora da rotina</span><span>${formatar(cats.totalProjetos)}</span></p>${projetos}` : ''}
      ${peq.quantos ? `<p class="classe-ativos"><span>gastos pequenos</span><span></span></p>
        ${linhaQueAbre('pequenos', `<span class="nome-rel">${peq.quantos} ${peq.quantos === 1 ? 'gasto' : 'gastos'} abaixo de ${formatar(peq.corte)}<span class="fino">${pct(peq.parte)} da rotina — o que não se registra na cabeça</span></span><span></span><span class="valor-rel">${formatar(peq.soma)}</span><span></span>`, peq.lancamentos)}` : ''}
    </div>`;
}

// ── Futuro ────────────────────────────────────────────────────────────────

let projecao = null;

function abaFuturo() {
  projecao = rel.projecaoDeSaldo(app, 90);
  const p = projecao;
  const comp = rel.comprometimento(app, 12);
  const custo = rel.custoDeExistir(app);
  const til = p.estimado ? '~' : '';
  const proximos = p.pontos.filter((x) => x.itens.length).slice(0, 12);

  const maiorComp = Math.max(...comp.map((x) => Math.max(x.total, x.renda ?? 0)), 1);
  const linhasComp = comp.map((x) => `<div class="linha-rel fixa">
      <span class="nome-rel">${esc(mesCurto(x.mes))}<span class="fino">${esc([
        x.cartao ? `cartão ${formatar(x.cartao)}` : '', x.contratos ? `contratos ${formatar(x.contratos)}` : '',
        x.recorrentes ? `recorrentes ${formatar(x.recorrentes)}` : '', x.agendados ? `agendados ${formatar(x.agendados)}` : '',
      ].filter(Boolean).join(' · ') || 'nada ainda')}</span></span>
      ${barra(x.total, maiorComp)}
      <span class="valor-rel">${x.estimado ? '~' : ''}${formatar(x.total)}</span>
      <span class="dif-rel">${x.renda ? `${pct(x.total / x.renda)} de ${formatar(x.renda)}` : ''}</span>
    </div>`).join('');

  const linhasCusto = custo.itens.map((x) => `<div class="linha-rel fixa">
      <span class="nome-rel">${esc(x.nome)}<span class="fino">${x.anualDeVerdade ? `anual: ${formatar(x.anual)} ÷ 12` : `${formatar(x.anual)} por ano`}</span></span>
      <span></span><span class="valor-rel">${x.estimado ? '~' : ''}${formatar(x.mensal)}</span><span class="dif-rel">por mês</span>
    </div>`).join('');

  return `<p class="aviso-rel">Só o que é conhecido: recorrentes, faturas, parcelas e agendados. Mercado, combustível e outros gastos que variam <strong>não estão na curva</strong> — ela mostra o piso do que vai sair.</p>
    <div class="blocos"><div class="bloco largo total">
      <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>saldo das contas, dia a dia · 90 dias</p>
      <div class="numeros-renda">
        ${numero('hoje', formatar(p.inicio))}
        ${numero(`pior dia · ${diaCurto(p.pior.dia)}`, `${til}${p.pior.saldo < 0 ? '−' : ''}${formatar(Math.abs(p.pior.saldo))}`, p.pior.saldo < 0 ? 'negativo-rel' : '')}
        ${numero(`em 90 dias · ${diaCurto(p.pontos[p.pontos.length - 1].dia)}`, `${til}${p.fim < 0 ? '−' : ''}${formatar(Math.abs(p.fim))}`, p.fim < 0 ? 'negativo-rel' : '')}
      </div>
      <div id="grafico-projecao"></div>
      ${proximos.length ? `<p class="miudo titulo-linhas">o que vem</p>
        <ol class="lancamentos-rel">${proximos.flatMap((d) => d.itens.map((it) => `<li><span class="quando">${diaCurto(d.dia)}</span>
          <span class="nome-linha">${esc(it.nome)}</span><span class="valor-lancado">${comSinal(it.valor)}</span></li>`)).slice(0, 15).join('')}</ol>` : ''}
    </div></div>
    <div class="secao-rel">
      <p class="classe-ativos"><span>comprometimento · o que de cada mês já tem dono</span><span></span></p>
      <div id="g-comp"></div>
      ${linhasComp}
      <p class="nota-rel">Faturas (com as parcelas já compradas), parcelas de contrato, recorrentes e agendados. Poupar não entra: é escolha, não compromisso.${comp.some((x) => x.renda) ? '' : ' Com uma recorrência de receita (o salário), aparece quanto da renda cada mês já leva.'}</p>
      <p class="classe-ativos"><span>custo de existir · as contas fixas</span><span>${custo.estimado ? '~' : ''}${formatar(custo.total)}/mês${custo.parte != null ? ` · ${pct(custo.parte)} da renda` : ''}</span></p>
      ${linhasCusto || '<p class="nota">Nenhuma recorrência de despesa ainda. Cadastre as contas fixas em Planejamento.</p>'}
      <p class="nota-rel">A conta que chega mesmo sem sair de casa. A anual entra dividida por 12. Imposto e poupar ficam fora; parcela de dívida está no comprometimento.</p>
    </div>`;
}

function desenharProjecao() {
  const raiz = $('grafico-projecao');
  if (!raiz || !projecao) return;
  const p = projecao;
  const iPior = p.pontos.findIndex((x) => x.dia === p.pior.dia);
  graficoDeLinha(raiz, {
    pontos: p.pontos.map((x) => ({
      y: x.saldo,
      dica: `<strong>${x.saldo < 0 ? '−' : ''}${formatar(Math.abs(x.saldo))}</strong><span>${diaCurto(x.dia)}</span>${x.itens.map((it) => `<span class="fino">${esc(it.nome)} ${comSinal(it.valor)}</span>`).join('')}`,
    })),
    formatar: (v) => compacto(v),
    marcas: iPior > 0 ? [{ i: iPior, texto: `pior dia ${diaCurto(p.pior.dia)}`, alerta: p.pior.saldo < 0 }] : [],
    rotulosX: [0, 30, 60, 90].filter((i) => i < p.pontos.length).map((i) => ({ i, texto: diaCurto(p.pontos[i].dia) })),
  });
}

/** R$ 12,3 mil — o eixo não precisa dos centavos. */
function compacto(v) {
  const reais = v / 100;
  const abs = Math.abs(reais);
  const sinal = reais < 0 ? '−' : '';
  if (abs >= 1000) return `${sinal}${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: abs >= 10000 ? 0 : 1 })} mil`;
  return `${sinal}${Math.round(abs).toLocaleString('pt-BR')}`;
}

// ── Para onde vai ─────────────────────────────────────────────────────────

function abaOnde() {
  const { de, ate, meses } = rel.periodo(vista.mes, vista.quantos);
  const r = rel.paraOndeVai(app, de, ate, meses);
  const custo = rel.custoDeExistir(app);
  if (!r.total) return `<p class="vazio">Nenhum gasto no período.</p>`;

  const maiorEt = Math.max(...r.etiquetas.map((x) => x.valor), 1);
  const etiquetas = r.etiquetas.map((x) => linhaQueAbre(`et:${x.etiquetaId}`, `
      <span class="nome-rel">${esc(app.etiquetas?.[x.etiquetaId]?.nome ?? 'etiqueta')}<span class="fino">${x.vezes} ${x.vezes === 1 ? 'lançamento' : 'lançamentos'} · ${x.categorias} ${x.categorias === 1 ? 'categoria' : 'categorias'}</span></span>
      ${barra(x.valor, maiorEt)}
      <span class="valor-rel">${formatar(x.valor)}</span>
      <span class="dif-rel">${meses > 1 ? `${formatar(x.porMes)}/mês` : ''}</span>`, x.lancamentos)).join('');

  const maiorDesc = Math.max(...r.descricoes.map((x) => x.valor), 1);
  const descricoes = r.descricoes.slice(0, 15).map((x) => linhaQueAbre(`desc:${x.detalheId}`, `
      <span class="nome-rel">${esc(app.detalhes?.[x.detalheId]?.nome ?? '—')}<span class="fino">${esc(nomeCat(x.categoriaId))}</span></span>
      ${barra(x.valor, maiorDesc)}
      <span class="valor-rel">${formatar(x.valor)}</span>
      <span class="dif-rel">${x.vezes} ${x.vezes === 1 ? 'vez' : 'vezes'}</span>`, x.lancamentos)).join('');

  const assinaturas = [...custo.itens].sort((a, b) => b.anual - a.anual).map((x) => `<div class="linha-rel fixa">
      <span class="nome-rel">${esc(x.nome)}<span class="fino">${x.anualDeVerdade ? 'anual' : `${formatar(x.mensal)} por mês`}</span></span>
      <span></span><span class="valor-rel">${x.estimado ? '~' : ''}${formatar(x.anual)}</span><span class="dif-rel">por ano</span>
    </div>`).join('');

  const titulares = r.titulares.map((x) => `<div class="linha-rel fixa">
      <span class="nome-rel">${esc(x.pessoaId ? app.pessoas?.[x.pessoaId]?.nome ?? 'pessoa' : 'conta sem titular')}</span>
      ${barra(x.valor, r.total)}
      <span class="valor-rel">${formatar(x.valor)}</span><span class="dif-rel">${pct(x.valor / r.total)}</span>
    </div>`).join('');

  const maiorDia = Math.max(...r.semana, 1);
  const semana = `<div class="colunas-semana">${r.semana.map((v, i) => `<div class="coluna-dia" title="${SEMANA[i]}: ${formatar(v)}">
      <span class="valor-dia">${v ? compacto(v) : ''}</span>
      <span class="barra-dia"><i style="height:${Math.round((v / maiorDia) * 100)}%"></i></span>
      <span class="rotulo-dia">${SEMANA[i]}</span></div>`).join('')}</div>`;
  const q = r.quinzenas;
  const qTotal = q[0] + q[1];

  return `<div class="secao-rel">
      <p class="classe-ativos"><span>custo de cada objeto · pela etiqueta</span><span>${formatar(r.total)} no período</span></p>
      ${etiquetas || '<p class="nota">Nenhum gasto com etiqueta no período. A etiqueta responde "de quem é": o carro, a casa, o cachorro — e aqui vira quanto cada um custa somando todas as categorias.</p>'}
      <p class="classe-ativos"><span>por descrição · para quem se paga</span><span></span></p>
      ${descricoes || '<p class="nota">Nenhum gasto com descrição no período.</p>'}
      <p class="classe-ativos"><span>assinaturas e contas fixas · por ano</span><span>${formatar(custo.itens.reduce((t, x) => t + x.anual, 0))}/ano</span></p>
      ${assinaturas || '<p class="nota">Nenhuma recorrência de despesa.</p>'}
      <p class="classe-ativos"><span>de qual conta saiu</span><span></span></p>
      ${titulares}
      <p class="nota-rel">Pelo titular da conta de onde saiu o dinheiro. Informação, não acerto de contas.</p>
      <p class="classe-ativos"><span>quando se gasta · rotina</span><span></span></p>
      ${semana}
      <p class="nota-rel">Primeira quinzena ${formatar(q[0])}${qTotal ? ` (${pct(q[0] / qTotal)})` : ''} · segunda ${formatar(q[1])}${qTotal ? ` (${pct(q[1] / qTotal)})` : ''}.</p>
    </div>`;
}

// ── Explorar (design/14, D32) ─────────────────────────────────────────────

const DIMENSOES = [
  { id: 'categorias', rotulo: 'categorias', mais: '+ categoria' },
  { id: 'etiquetas', rotulo: 'etiquetas', mais: '+ etiqueta' },
  { id: 'descricoes', rotulo: 'descrições', mais: '+ descrição' },
  { id: 'contas', rotulo: 'contas', mais: '+ conta ou cartão' },
];
const PERIODOS = [['6', '6 meses'], ['12', '12 meses'], ['ano', 'este ano'], ['tudo', 'tudo']];

/** O nome de um item escolhido, em qualquer dimensão. */
function nomeDoItem(dim, id) {
  if (dim === 'categorias') return nomeCat(id);
  if (dim === 'etiquetas') return app.etiquetas?.[id]?.nome ?? 'etiqueta';
  if (dim === 'descricoes') return app.detalhes?.[id]?.nome ?? 'descrição';
  return app.contas?.[id]?.nome ?? 'conta';
}

/** As opções que ainda dá para acrescentar a uma dimensão. */
function opcoesDe(dim) {
  const ja = new Set(exp.sel[dim]);
  const por = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  const opt = (x) => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`;
  if (dim === 'categorias') {
    const todas = Object.values(app.categorias).filter((c) => !c.arquivada && !ja.has(c.id)).map((c) => ({ ...c, nome: nomeCat(c.id) })).sort(por);
    const grupo = (nat, rotulo) => {
      const daqui = todas.filter((c) => c.natureza === nat);
      return daqui.length ? `<optgroup label="${rotulo}">${daqui.map(opt).join('')}</optgroup>` : '';
    };
    return grupo('despesa', 'despesa') + grupo('receita', 'receita');
  }
  if (dim === 'etiquetas') return Object.values(app.etiquetas ?? {}).filter((t) => !t.arquivada && !ja.has(t.id)).sort(por).map(opt).join('');
  if (dim === 'descricoes') return Object.values(app.detalhes ?? {}).filter((d) => !d.arquivado && !ja.has(d.id)).sort(por).map(opt).join('');
  return Object.values(app.contas).filter((c) => !c.arquivada && !ja.has(c.id) && !['investimento', 'divida'].includes(c.tipo)).sort(por).map(opt).join('');
}

/** A seleção na tela é diferente da salva de onde veio? */
function mexida() {
  const salva = app.selecoes?.[exp.salvaId];
  if (!salva) return false;
  const igual = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  return !DIMENSOES.every((d) => igual(exp.sel[d.id], salva[d.id] ?? [])) || Boolean(exp.sel.cruzar) !== Boolean(salva.cruzar);
}

// O que a aba calculou, para os gráficos desenharem depois do HTML.
let explorado = null;

function abaExplorar() {
  if (exp.salvaId && !app.selecoes?.[exp.salvaId]) exp.salvaId = null;
  const salvas = Object.values(app.selecoes ?? {}).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const chipsSalvas = `<div class="salvas-ex" role="group" aria-label="Seleções salvas">
      ${salvas.map((x) => `<button type="button" data-ex-abrir="${esc(x.id)}" aria-pressed="${x.id === exp.salvaId}">${esc(x.nome)}</button>`).join('')}
      <button type="button" class="nova-ex" data-ex-nova>+ nova</button>
    </div>`;

  const linhasFiltro = DIMENSOES.map((d) => {
    const escolhidos = exp.sel[d.id].map((id) => `<button type="button" class="chip-ex" data-ex-tirar="${d.id}:${esc(id)}" aria-label="Tirar ${esc(nomeDoItem(d.id, id))}">${esc(nomeDoItem(d.id, id))} <span aria-hidden="true">×</span></button>`).join('');
    const opcoes = opcoesDe(d.id);
    return `<div class="linha-filtro-ex"><span class="rotulo-ex">${d.rotulo}</span>${escolhidos}
      ${opcoes ? `<select data-ex-add="${d.id}" aria-label="${esc(d.mais)}"><option value="">${esc(d.mais)}</option>${opcoes}</select>` : ''}</div>`;
  }).join('');

  const tipos = ['categorias', 'etiquetas', 'descricoes'].filter((d) => exp.sel[d].length).length;
  const cruzar = tipos >= 2
    ? `<label class="cruzar-ex"><input type="checkbox" data-ex-cruzar ${exp.sel.cruzar ? 'checked' : ''}> só o que tem os dois</label>`
    : '';
  const periodo = `<span class="chips-periodo inline" role="group" aria-label="Período">${PERIODOS.map(([v, n]) =>
    `<button type="button" data-ex-periodo="${v}" aria-pressed="${v === exp.periodo}">${n}</button>`).join('')}</span>`;
  const vazia = ex.selecaoVazia(exp.sel);
  const acoes = exp.salvando
    ? `<span class="salvar-ex"><input type="text" data-ex-nome maxlength="40" placeholder="nome da seleção" aria-label="Nome da seleção">
        <button type="button" class="principal" data-ex-confirmar>Salvar</button><button type="button" class="elo" data-ex-cancelar>cancelar</button></span>`
    : `<span class="acoes-ex">
        ${exp.salvaId && mexida() ? '<button type="button" class="elo" data-ex-atualizar>salvar</button>' : ''}
        ${vazia ? '' : '<button type="button" class="elo" data-ex-salvar-como>salvar como…</button>'}
        ${exp.salvaId ? '<button type="button" class="elo" data-ex-apagar>apagar</button>' : ''}
      </span>`;

  const painel = `<div class="filtro-ex">${linhasFiltro}<div class="rodape-ex">${cruzar}${periodo}${acoes}</div></div>`;
  if (vazia) {
    explorado = null;
    return `${chipsSalvas}${painel}<p class="nota-rel">Escolha uma categoria, etiqueta, descrição ou conta para ver a evolução dela. Várias juntas somam; salve a seleção para abrir num toque depois.</p>`;
  }

  const per = ex.periodoDoExplorar(app, exp.periodo);
  const r = ex.explorar(app, exp.sel, per);
  explorado = { r, per };
  if (r.vazia) return `${chipsSalvas}${painel}<p class="nota-rel">Nada com esta seleção no período.</p>`;

  const gasto = r.natureza === 'gasto';
  const antes = r.anoAnterior;
  const numeros = `<div class="numeros-renda numeros-ex">
      ${numero(gasto ? 'gasto no período' : 'entrou no período', formatar(r.totalDaBase))}
      ${numero('média por mês', formatar(r.media))}
      ${gasto && r.parteDoGasto != null ? numero('do gasto total', pct(r.parteDoGasto)) : ''}
      ${antes ? numero('contra um ano antes', `${r.totalDaBase >= antes ? '+' : '−'}${Math.abs((r.totalDaBase / antes - 1) * 100).toFixed(0)}%`) : ''}
      ${gasto && r.receita ? numero('entrou', formatar(r.receita)) : ''}
    </div>
    ${r.projeto ? `<p class="nota-rel">Dos quais ${formatar(r.projeto)} pagos por envelope.</p>` : ''}`;

  const lista = (titulo, itens, prefixo, nome) => {
    if (!itens.length) return '';
    const maior = Math.max(...itens.map((x) => x.valor), 1);
    return `<p class="classe-ativos"><span>${titulo}</span><span></span></p>
      ${itens.slice(0, 12).map((x) => linhaQueAbre(`${prefixo}:${x.chave}`, `
        <span class="nome-rel">${esc(nome(x.chave))}<span class="fino">${x.vezes} ${x.vezes === 1 ? 'vez' : 'vezes'}${x.vezes ? ` · ${formatar(Math.round(x.valor / x.vezes))} cada` : ''}</span></span>
        ${barra(x.valor, maior)}
        <span class="valor-rel">${formatar(x.valor)}</span>
        <span class="dif-rel">${r.totalDaBase ? pct(x.valor / r.totalDaBase) : ''}</span>`, x.lancamentos)).join('')}`;
  };

  const outras = salvas.filter((x) => x.id !== exp.salvaId);
  const comparar = outras.length
    ? `<p class="classe-ativos"><span>comparar com</span><span></span></p>
      <div class="salvas-ex" role="group" aria-label="Comparar com">${outras.map((x) =>
        `<button type="button" data-ex-comparar="${esc(x.id)}" aria-pressed="${exp.comparar.includes(x.id)}">${esc(x.nome)}</button>`).join('')}</div>
      ${exp.comparar.some((id) => app.selecoes?.[id]) ? '<div class="grafico-rel" id="g-ex-comparar"></div>' : ''}`
    : '';

  return `${chipsSalvas}${painel}
    <div class="blocos"><div class="bloco largo total">${numeros}</div></div>
    <div class="secao-rel">
      <p class="classe-ativos"><span>mês a mês · ${r.empilha === 'descricao' ? 'pelas descrições' : 'por categoria'}</span><span>tracejado: a média</span></p>
      <div class="grafico-rel" id="g-ex-meses"></div>
      <p class="classe-ativos"><span>ano contra ano · acumulado</span><span></span></p>
      <div class="grafico-rel" id="g-ex-ano"></div>
      ${comparar}
      ${lista('onde mais pesa · por categoria', r.categorias, 'xc', nomeCat)}
      ${lista('por etiqueta', r.etiquetas, 'xe', (k) => app.etiquetas?.[k]?.nome ?? 'etiqueta')}
      ${lista('por descrição', r.descricoes, 'xd', (k) => app.detalhes?.[k]?.nome ?? '—')}
    </div>`;
}

const nomeDaSerie = (r, chave) => (chave === 'outras' ? 'outras'
  : r.empilha === 'descricao' ? (app.detalhes?.[chave]?.nome ?? 'sem descrição') : nomeCat(chave === '—' ? null : chave));

function desenharExplorar() {
  if (!explorado) return;
  const { r, per } = explorado;
  const cores = new Map(r.series.map((x, i) => [x.chave, x.chave === 'outras' ? 'var(--serie-outros)' : cor(i + 1)]));
  if ($('g-ex-meses')) {
    colunas($('g-ex-meses'), {
      grupos: r.porMes.map((m) => {
        const total = [...m.partes.values()].reduce((t, v) => t + v, 0);
        return {
          rotulo: mesCurto(m.mes),
          barras: [r.series.map((x) => ({ valor: m.partes.get(x.chave) ?? 0, cor: cores.get(x.chave) }))],
          dica: `<strong>${esc(nomeDoMes(m.mes))}: ${formatar(total)}</strong>${r.series.filter((x) => m.partes.get(x.chave)).map((x) =>
            `<span>${esc(nomeDaSerie(r, x.chave))}: ${formatar(m.partes.get(x.chave))}</span>`).join('')}<span class="fino">média ${formatar(r.media)}</span>`,
        };
      }),
      series: r.series.map((x) => ({ nome: `${nomeDaSerie(r, x.chave)} · ${formatar(x.valor)}`, cor: cores.get(x.chave) })),
      linha: r.porMes.map(() => r.media),
      formatar: compacto,
    });
    $('g-ex-meses').querySelector('.linha-sobre')?.setAttribute('stroke-dasharray', '5 4');
  }
  const ano = ex.anoContraAno(app, exp.sel);
  if ($('g-ex-ano')) {
    if (!ano) $('g-ex-ano').innerHTML = '<p class="nota-rel">Aparece quando houver lançamento no ano passado.</p>';
    else {
      const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
      const este = [...ano.este, ...Array(12 - ano.este.length).fill(null)];
      graficoDeLinhas($('g-ex-ano'), {
        series: [
          { nome: String(ano.ano), cor: cor(1), valores: este },
          { nome: String(ano.ano - 1), cor: 'var(--tinta-fraca)', valores: ano.passado, fina: true },
        ],
        rotulos: MESES,
        dica: (i) => `<strong>até ${MESES[i]}</strong>${este[i] != null ? `<span>${ano.ano}: ${formatar(este[i])}</span>` : ''}<span class="fino">${ano.ano - 1}: ${formatar(ano.passado[i])}</span>`,
        formatar: compacto,
      });
      if (ano.desdeOPassado) $('g-ex-ano').insertAdjacentHTML('beforeend', `<p class="nota-rel">${ano.ano - 1} só tem lançamentos desde ${esc(nomeDoMes(ano.desdeOPassado))}.</p>`);
    }
  }
  const comparadas = exp.comparar.map((id) => app.selecoes?.[id]).filter(Boolean);
  if ($('g-ex-comparar') && comparadas.length) {
    const atual = app.selecoes?.[exp.salvaId]?.nome ?? 'esta seleção';
    const series = [{ nome: atual, cor: cor(1), valores: ex.serieDaSelecao(app, exp.sel, per) },
      ...comparadas.map((x, i) => ({ nome: x.nome, cor: cor(i + 2), valores: ex.serieDaSelecao(app, x, per) }))];
    graficoDeLinhas($('g-ex-comparar'), {
      series,
      rotulos: per.meses.map(mesCurto),
      dica: (i) => `<strong>${esc(nomeDoMes(per.meses[i]))}</strong>${series.map((x) => `<span>${esc(x.nome)}: ${formatar(x.valores[i])}</span>`).join('')}`,
      formatar: compacto,
    });
  }
}

/** Abre o Explorar com uma linha de outro relatório (cat:, et:, desc:). */
function explorarDaqui(chave) {
  const i = chave.indexOf(':');
  const dim = { cat: 'categorias', et: 'etiquetas', desc: 'descricoes' }[chave.slice(0, i)];
  if (!dim) return;
  exp.sel = selVazia();
  exp.sel[dim] = [chave.slice(i + 1)];
  exp.salvaId = null;
  exp.salvando = false;
  vista.aba = 'explorar';
  abertas.clear();
  pintar();
}

async function salvarSelecao(id, nome) {
  exp.salvaId = id;
  exp.salvando = false;
  await estado.aplicarEvento('selecao.salva', { id, nome, ...exp.sel });
}

// ── Patrimônio ────────────────────────────────────────────────────────────

let curva = [];

function abaPatrimonio() {
  const agora = rel.patrimonioNoDia(app);
  curva = rel.curvaDoPatrimonio(app);
  const fim = hoje();
  const de = vista.trabalho === 12 ? `${somarMeses(fim, -11).slice(0, 7)}-01` : `${fim.slice(0, 7)}-01`;
  const t = rel.dinheiroTrabalhando(app, de, fim);
  const linhas = curva.map((p, i) => {
    const antes = curva[i - 1];
    return `<div class="linha-rel fixa">
      <span class="nome-rel">${i === curva.length - 1 ? 'hoje' : esc(mesCurto(p.dia.slice(0, 7)))}</span>
      <span></span><span class="valor-rel">${p.total < 0 ? '−' : ''}${formatar(Math.abs(p.total))}</span>
      <span class="dif-rel ${antes && p.total > antes.total ? 'bom' : antes && p.total < antes.total ? 'ruim' : ''}">${antes ? comSinal(p.total - antes.total) : ''}</span>
    </div>`;
  }).reverse().join('');
  return `<div class="blocos"><div class="bloco largo total">
      <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>patrimônio financeiro · hoje</p>
      <div class="numeros-renda">
        ${numero('contas', formatar(agora.caixa))}
        ${numero('investimentos', formatar(agora.investimentos))}
        ${numero('cartões a pagar', `−${formatar(agora.cartoes)}`)}
        ${numero('dívidas', `−${formatar(agora.dividas)}`)}
        ${numero('patrimônio', `${agora.total < 0 ? '−' : ''}${formatar(Math.abs(agora.total))}`, 'destaque-rel')}
      </div>
      <p class="nota-rel">O que se tem menos o que se deve. A compra no cartão já é dívida; o empréstimo entra pelo saldo devedor, nunca pela soma das parcelas.</p>
      <div id="grafico-patrimonio"></div>
    </div>
    <div class="bloco largo">
      <p class="nome-bloco">o investido · ${formatar(rel.investido(app).total)}</p>
      <div class="pizzas">
        <div><p class="miudo titulo-linhas">por classe</p><div id="g-classes"></div></div>
        <div><p class="miudo titulo-linhas">de quem é · por envelope</p><div id="g-donos"></div></div>
      </div>
    </div>
    <div class="bloco largo">
      <p class="nome-bloco">o dinheiro trabalhando · <span class="chips-periodo inline" role="group" aria-label="Período">${[1, 12].map((q) =>
        `<button type="button" data-rel-trabalho="${q}" aria-pressed="${q === vista.trabalho}">${q === 1 ? 'este mês' : '12 meses'}</button>`).join('')}</span></p>
      <div class="numeros-renda">
        ${numero('investimentos renderam', comSinal(t.rendeu))}
        ${numero('juros pagos nas dívidas', formatar(t.juros))}
        ${numero('saldo', comSinal(t.saldo), t.saldo < 0 ? 'negativo-rel' : '')}
      </div>
      ${t.porDivida.length ? `<p class="nota-rel">${t.porDivida.map((d) => `${esc(d.conta.nome)}: ${formatar(d.juros)} de juros em ${d.parcelas} ${d.parcelas === 1 ? 'parcela' : 'parcelas'}`).join(' · ')}.</p>` : ''}
      <p class="nota-rel">Números, não conselho: rendimento passado não se repete, e o juro da dívida é pela taxa do contrato.</p>
    </div></div>
    <div class="secao-rel">
      <p class="classe-ativos"><span>mês a mês · no fim de cada mês</span><span></span></p>
      ${linhas}
    </div>`;
}

// As cores seguem a coisa, em todos os gráficos (paleta validada, base.css):
// contas, investimentos e dívidas são sempre as mesmas três.
const COR = { renda: cor(1), gasto: cor(2), envelope: cor(3), contas: cor(3), investimentos: cor(1), dividas: cor(2),
  contratos: cor(1), cartao: cor(2), recorrentes: cor(3), agendados: cor(4) };
const valorComSinal = (v) => `${v < 0 ? '−' : ''}${formatar(Math.abs(v))}`;

/** Do que é feito o patrimônio: o que se tem acima do zero, o que se deve abaixo, e ele no meio. */
function desenharPatrimonio() {
  const raiz = $('grafico-patrimonio');
  if (!raiz) return;
  if (curva.length < 2) { raiz.innerHTML = '<p class="nota-rel">A curva aparece a partir do segundo mês com lançamentos.</p>'; }
  else {
    areas(raiz, {
      pontos: curva.map((p, i) => ({
        rotulo: i === curva.length - 1 ? 'hoje' : mesCurto(p.dia.slice(0, 7)),
        acima: [Math.max(0, p.caixa), p.investimentos],
        abaixo: [p.cartoes + p.dividas],
        linha: p.total,
        dica: `<strong>${valorComSinal(p.total)}</strong><span>${i === curva.length - 1 ? 'hoje' : `fim de ${nomeDoMes(p.dia.slice(0, 7))}`}</span>
          <span class="fino">contas ${formatar(p.caixa)} · investimentos ${formatar(p.investimentos)}</span>
          <span class="fino">cartões −${formatar(p.cartoes)} · dívidas −${formatar(p.dividas)}</span>`,
      })),
      acima: [{ nome: 'contas', cor: COR.contas }, { nome: 'investimentos', cor: COR.investimentos }],
      abaixo: [{ nome: 'cartões e dívidas', cor: COR.dividas }],
      linha: { nome: 'patrimônio', cor: 'var(--tinta)' },
      formatar: compacto,
    });
  }
  const inv = rel.investido(app);
  const fatias = (lista) => lista.map((x, i) => ({ nome: x.nome, valor: x.valor, cor: cor(i + 1) }));
  pizza($('g-classes'), {
    fatias: fatias([...inv.classes].sort((a, b) => b.valor - a.valor)),
    formatar, centro: compacto(inv.total),
  });
  // O sem dono é o neutro: não é envelope nenhum.
  const env = [...inv.envelopes].sort((a, b) => b.valor - a.valor);
  const comCor = env.filter((x) => x.id).map((x, i) => ({ nome: x.nome, valor: x.valor, cor: cor(i + 1) }));
  const semDono = env.find((x) => !x.id);
  pizza($('g-donos'), {
    fatias: semDono ? [...comCor, { nome: 'sem dono', valor: semDono.valor, cor: 'var(--serie-outros)' }] : comCor,
    formatar, centro: compacto(inv.total),
    subtitulo: comCor.length ? '' : 'nenhum envelope',
  });
}

/** O Mês: o ritmo contra o mês anterior, entrou × saiu e o mapa das categorias. */
function desenharMes() {
  const r = rel.ritmoDoMes(app, vista.mes);
  if ($('g-ritmo')) {
    const nomeAnt = nomeDoMes(r.mesAnterior).split(' ')[0];
    $('frase-ritmo').textContent = r.parte == null
      ? `Gasto de rotina até o dia ${r.hoje}: ${formatar(r.agora)}.`
      : `${r.corrente ? `No dia ${r.hoje}` : 'No mês'}, ${formatar(r.agora)} — ${pct(r.parte)} de tudo o que se gastou em ${nomeAnt}${r.corrente ? ` (no mesmo dia de ${nomeAnt}: ${formatar(r.noMesmoDia)})` : ''}.`;
    graficoDeLinhas($('g-ritmo'), {
      series: [
        { nome: nomeDoMes(vista.mes).split(' ')[0], cor: 'var(--tinta)', valores: r.atual },
        { nome: nomeAnt, cor: 'var(--tinta-fraca)', valores: r.anterior, fina: true },
      ],
      rotulos: r.atual.map((_, i) => String(i + 1)),
      dica: (i) => `<strong>dia ${i + 1}</strong>${r.atual[i] != null ? `<span>${esc(nomeDoMes(vista.mes).split(' ')[0])}: ${formatar(r.atual[i])}</span>` : ''}<span class="fino">${esc(nomeAnt)}: ${formatar(r.anterior[i] ?? 0)}</span>`,
      formatar: compacto,
      marcas: r.atual[r.hoje - 1] != null ? [{ serie: 0, i: r.hoje - 1, texto: formatar(r.agora) }] : [],
    });
  }
  const fluxo = rel.fluxoDosMeses(app, vista.mes, 12);
  if ($('g-fluxo')) {
    if (fluxo.length < 2) $('g-fluxo').innerHTML = '<p class="nota-rel">Aparece a partir do segundo mês com lançamentos.</p>';
    else {
      colunas($('g-fluxo'), {
        grupos: fluxo.map((m) => ({
          rotulo: mesCurto(m.mes),
          barras: [[{ valor: m.renda, cor: COR.renda }], [{ valor: m.rotina, cor: COR.gasto }, { valor: m.projeto, cor: COR.envelope }]],
          dica: `<strong>${esc(nomeDoMes(m.mes))}</strong><span>entrou ${formatar(m.renda)}</span><span>gasto ${formatar(m.rotina)}${m.projeto ? ` + ${formatar(m.projeto)} do envelope` : ''}</span><span class="fino">${m.sobrou >= 0 ? `sobrou ${formatar(m.sobrou)}` : `faltou ${formatar(-m.sobrou)}`}</span>`,
        })),
        series: [{ nome: 'renda disponível', cor: COR.renda }, { nome: 'gasto de rotina', cor: COR.gasto }, { nome: 'pago por envelope', cor: COR.envelope }],
        formatar: compacto,
      });
    }
  }
  const cats = rel.mesEmCategorias(app, vista.mes);
  if ($('g-mapa') && cats.linhas.filter((x) => x.valor > 0).length > 1) {
    mapaDeBlocos($('g-mapa'), {
      itens: cats.linhas.filter((x) => x.valor > 0).map((x) => ({
        nome: nomeCat(x.categoriaId), valor: x.valor,
        dica: `<strong>${formatar(x.valor)}</strong><span>${esc(nomeCat(x.categoriaId))} · ${pct(x.valor / cats.rotina)}</span>${x.anterior ? `<span class="fino">mês anterior ${formatar(x.anterior)}</span>` : ''}`,
      })),
      formatar,
      altura: 200,
    });
  }
}

/** O comprometimento em colunas empilhadas, com a renda por cima. */
function desenharComprometimento() {
  const raiz = $('g-comp');
  if (!raiz) return;
  const comp = rel.comprometimento(app, 12);
  const renda = comp.map((x) => x.renda);
  colunas(raiz, {
    grupos: comp.map((x) => ({
      rotulo: mesCurto(x.mes),
      barras: [[
        // Na ordem da paleta: só ficam vizinhas as cores validadas como par.
        { valor: x.contratos, cor: COR.contratos },
        { valor: x.cartao, cor: COR.cartao },
        { valor: x.recorrentes, cor: COR.recorrentes },
        { valor: x.agendados, cor: COR.agendados },
      ]],
      dica: `<strong>${x.estimado ? '~' : ''}${formatar(x.total)}</strong><span>${esc(nomeDoMes(x.mes))}${x.renda ? ` · ${pct(x.total / x.renda)} da renda` : ''}</span>
        ${x.contratos ? `<span class="fino">contratos ${formatar(x.contratos)}</span>` : ''}${x.recorrentes ? `<span class="fino">recorrentes ${formatar(x.recorrentes)}</span>` : ''}
        ${x.cartao ? `<span class="fino">cartão ${formatar(x.cartao)}</span>` : ''}${x.agendados ? `<span class="fino">agendados ${formatar(x.agendados)}</span>` : ''}`,
    })),
    series: [
      { nome: 'contratos', cor: COR.contratos }, { nome: 'cartão', cor: COR.cartao },
      { nome: 'recorrentes', cor: COR.recorrentes }, { nome: 'agendados', cor: COR.agendados },
      ...(renda.some((v) => v) ? [{ nome: 'renda prevista', cor: 'var(--tinta)', linha: true }] : []),
    ],
    linha: renda.some((v) => v) ? renda : null,
    formatar: compacto,
  });
}

// ── Tendência ─────────────────────────────────────────────────────────────

function abaTendencia() {
  const mes = vista.mes;
  const historico = rel.mesesDeHistorico(app, mes);
  if (historico < 3) {
    return `<p class="vazio">A tendência precisa de histórico: com ~3 meses de uso aparece "por que o mês apertou", com ~6 "a minha inflação", com 13 "ano contra ano". Antes de ${esc(nomeDoMes(mes))} há ${historico} ${historico === 1 ? 'mês' : 'meses'} com gastos — desenhar tendência com isso seria inventar.</p>`;
  }
  const r = rel.porQueApertou(app, mes);
  const maior = Math.max(...r.linhas.map((x) => Math.abs(x.desvio)), 1);
  const linhas = r.linhas.slice(0, 10).map((x) => `<div class="linha-rel fixa">
      <span class="nome-rel">${esc(nomeCat(x.categoriaId))}<span class="fino">${x.evento
        ? `1 lançamento: ${esc(app.detalhes?.[x.evento.detalheId]?.nome ?? nomeCat(x.categoriaId))}, ${diaCurto(x.evento.dataCompetencia)}`
        : x.desvio > 0 ? `${x.vezes} ${x.vezes === 1 ? 'lançamento' : 'lançamentos'}, nenhum fora do normal` : 'gastou menos que o normal'} · normal ${formatar(x.normal)}</span></span>
      ${barra(Math.abs(x.desvio), maior)}
      <span class="valor-rel">${formatar(x.valor)}</span>
      <span class="dif-rel ${x.desvio > 0 ? 'ruim' : 'bom'}">${comSinal(x.desvio)}</span>
    </div>`).join('');
  const titulo = r.acima > 0
    ? `${nomeDoMes(mes)} custou ${formatar(r.acima)} acima do normal`
    : `${nomeDoMes(mes)} custou ${formatar(-r.acima)} abaixo do normal`;

  const inf = historico >= 6 ? rel.minhaInflacao(app, mes) : null;
  const infHTML = inf?.geral != null
    ? `<p class="classe-ativos"><span>a minha inflação · ${inf.n} meses contra os ${inf.n} anteriores</span><span>${inf.geral >= 0 ? '+' : '−'}${Math.abs(inf.geral * 100).toFixed(1).replace('.', ',')}%</span></p>
      ${inf.linhas.slice(0, 10).map((x) => `<div class="linha-rel fixa">
        <span class="nome-rel">${esc(nomeCat(x.categoriaId))}<span class="fino">${formatar(x.antes)} → ${formatar(x.agora)} por mês${x.pct != null ? ` · ${x.pct >= 0 ? '+' : '−'}${Math.abs(x.pct * 100).toFixed(0)}%` : ''}</span></span>
        <span></span><span class="valor-rel"></span>
        <span class="dif-rel ${x.porMes > 0 ? 'ruim' : 'bom'}">${comSinal(x.porMes)}/mês</span></div>`).join('')}
      <p class="nota-rel">O crescimento do gasto de rotina, não o IPCA de ninguém: junta preço e quantidade. Esporádicos e o que o envelope pagou ficam fora.</p>`
    : `<p class="nota-rel">A minha inflação aparece com 6 meses de histórico (hoje: ${historico}).</p>`;

  const ano = historico >= 13 ? rel.anoContraAno(app, mes) : null;
  const variacao = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs((a / b - 1) * 100).toFixed(0)}%` : '—');
  const anoHTML = ano
    ? `<p class="classe-ativos"><span>ano contra ano · rotina</span><span></span></p>
      <div class="linha-rel fixa"><span class="nome-rel">${esc(mesCurto(mes))} contra ${esc(mesCurto(ano.anoPassado))}</span><span></span>
        <span class="valor-rel">${formatar(ano.mesmoMes.agora)}</span><span class="dif-rel">${variacao(ano.mesmoMes.agora, ano.mesmoMes.antes)}</span></div>
      <div class="linha-rel fixa"><span class="nome-rel">o ano até ${esc(mesCurto(mes))}</span><span></span>
        <span class="valor-rel">${formatar(ano.ateAqui.agora)}</span><span class="dif-rel">${variacao(ano.ateAqui.agora, ano.ateAqui.antes)}</span></div>
      <p class="nota-rel">Um aumento de 5% num ano de inflação de 5% não é aumento.</p>`
    : `<p class="nota-rel">Ano contra ano aparece com 13 meses de histórico (hoje: ${historico}).</p>`;

  return `<div class="blocos"><div class="bloco largo total">
      <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>por que o mês apertou</p>
      <p class="titulo-rel">${esc(titulo)}${r.totalEsporadicos ? `, dos quais ${formatar(r.totalEsporadicos)} são gastos anuais previsíveis` : ''}.</p>
      <p class="nota-rel">Cada categoria contra a mediana dos ${r.meses} meses anteriores, em reais. ${r.totalProjetos ? `${formatar(r.totalProjetos)} pagos por envelope ficam fora: estavam guardados.` : ''}</p>
    </div></div>
    <div class="secao-rel">
      ${linhas}
      ${r.esporadicos.length ? `<p class="classe-ativos"><span>anuais previsíveis · fora do normal</span><span>${formatar(r.totalEsporadicos)}</span></p>
        ${r.esporadicos.map((x) => `<div class="linha-rel fixa"><span class="nome-rel">${esc(app.recorrencias?.[x.l.recorrenciaId]?.nome ?? nomeCat(x.l.categoriaId))}</span><span></span><span class="valor-rel">${formatar(x.valor)}</span><span></span></div>`).join('')}` : ''}
      ${infHTML}
      ${anoHTML}
    </div>`;
}

// ── eventos ───────────────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  if (!ativa) return;
  const daqui = e.target.closest('[data-explorar]');
  if (daqui) { explorarDaqui(daqui.dataset.explorar); return; }
  if (e.target.closest('[data-ex-nova]')) { exp.sel = selVazia(); exp.salvaId = null; exp.salvando = false; abertas.clear(); pintar(); return; }
  const abrirSalva = e.target.closest('[data-ex-abrir]');
  if (abrirSalva) {
    const s = app.selecoes?.[abrirSalva.dataset.exAbrir];
    if (!s) return;
    exp.sel = { categorias: [...s.categorias], etiquetas: [...s.etiquetas], descricoes: [...s.descricoes], contas: [...s.contas], cruzar: s.cruzar };
    exp.salvaId = s.id;
    exp.comparar = exp.comparar.filter((id) => id !== s.id);
    exp.salvando = false;
    abertas.clear();
    pintar();
    return;
  }
  const tirar = e.target.closest('[data-ex-tirar]');
  if (tirar) {
    const valor = tirar.dataset.exTirar;
    const i = valor.indexOf(':');
    exp.sel[valor.slice(0, i)] = exp.sel[valor.slice(0, i)].filter((x) => x !== valor.slice(i + 1));
    pintar();
    return;
  }
  const per = e.target.closest('[data-ex-periodo]');
  if (per) { exp.periodo = per.dataset.exPeriodo; pintar(); return; }
  const comp = e.target.closest('[data-ex-comparar]');
  if (comp) {
    const id = comp.dataset.exComparar;
    exp.comparar = exp.comparar.includes(id) ? exp.comparar.filter((x) => x !== id) : [...exp.comparar, id].slice(-5);
    pintar();
    return;
  }
  if (e.target.closest('[data-ex-salvar-como]')) {
    exp.salvando = true;
    await pintar();
    document.querySelector('[data-ex-nome]')?.focus();
    return;
  }
  if (e.target.closest('[data-ex-cancelar]')) { exp.salvando = false; pintar(); return; }
  if (e.target.closest('[data-ex-confirmar]')) {
    const campo = document.querySelector('[data-ex-nome]');
    const nome = campo?.value.trim();
    if (!nome) { campo?.focus(); return; }
    await salvarSelecao(novoId('sel'), nome);
    return;
  }
  if (e.target.closest('[data-ex-atualizar]')) {
    const s = app.selecoes?.[exp.salvaId];
    if (s) await salvarSelecao(s.id, s.nome);
    return;
  }
  if (e.target.closest('[data-ex-apagar]')) {
    const s = app.selecoes?.[exp.salvaId];
    if (!s || !confirm(`Apagar a seleção "${s.nome}"? Os lançamentos não mudam.`)) return;
    exp.salvaId = null;
    await estado.aplicarEvento('selecao.removida', { id: s.id });
    return;
  }
  const aba = e.target.closest('[data-rel-aba]');
  if (aba) { vista.aba = aba.dataset.relAba; abertas.clear(); pintar(); return; }
  const mes = e.target.closest('[data-rel-mes]');
  if (mes) {
    vista.mes = somarMeses(`${vista.mes}-01`, Number(mes.dataset.relMes)).slice(0, 7);
    if (vista.mes > hoje().slice(0, 7)) vista.mes = hoje().slice(0, 7);
    abertas.clear();
    pintar();
    return;
  }
  const quantos = e.target.closest('[data-rel-quantos]');
  if (quantos) { vista.quantos = Number(quantos.dataset.relQuantos); abertas.clear(); pintar(); return; }
  const trabalho = e.target.closest('[data-rel-trabalho]');
  if (trabalho) { vista.trabalho = Number(trabalho.dataset.relTrabalho); pintar(); return; }
  const abrir = e.target.closest('[data-rel-abrir]');
  if (abrir) {
    const chave = abrir.dataset.relAbrir;
    if (abertas.has(chave)) abertas.delete(chave); else abertas.add(chave);
    pintar();
  }
});

// O Explorar: acrescentar à seleção, cruzar, e Enter no nome salva.
document.addEventListener('change', (e) => {
  if (!ativa) return;
  const add = e.target.closest('[data-ex-add]');
  if (add && add.value) {
    exp.sel[add.dataset.exAdd] = [...exp.sel[add.dataset.exAdd], add.value];
    pintar();
    return;
  }
  const cruzar = e.target.closest('[data-ex-cruzar]');
  if (cruzar) { exp.sel.cruzar = cruzar.checked; pintar(); }
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
