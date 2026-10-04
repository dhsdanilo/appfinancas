// A tela Relatórios (design/12-relatorios.md, D28): cinco abas — Mês, Futuro,
// Para onde vai, Patrimônio e Tendência. Toda soma desce até os lançamentos
// que a formam (toque na linha); o que precisa de histórico diz quanto falta.

import * as estado from './core/estado.js';
import { formatar } from './core/dinheiro.js';
import { hoje, diaCurto, nomeDoMes, somarMeses } from './core/datas.js';
import { nomeDaCategoria } from './core/lancamentos.js';
import * as rel from './core/relatorios.js';
import { graficoDeLinha } from './app/grafico.js';

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
const guardar = () => {
  try { localStorage.setItem('relatorios.vista', JSON.stringify({ aba: vista.aba, quantos: vista.quantos })); } catch { /* só não lembra */ }
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
  const corpo = { mes: abaMes, futuro: abaFuturo, onde: abaOnde, patrimonio: abaPatrimonio, tendencia: abaTendencia }[vista.aba]();
  $('corpo-relatorios').innerHTML = corpo;
  if (vista.aba === 'futuro') desenharProjecao();
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
    </div></div>
    <div class="secao-rel">
      <p class="classe-ativos"><span>categorias · rotina</span><span>${formatar(cats.rotina)} · antes ${formatar(cats.rotinaAnterior)}</span></p>
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

function desenharPatrimonio() {
  const raiz = $('grafico-patrimonio');
  if (!raiz) return;
  if (curva.length < 2) { raiz.innerHTML = '<p class="nota-rel">A curva aparece a partir do segundo mês com lançamentos.</p>'; return; }
  graficoDeLinha(raiz, {
    pontos: curva.map((p, i) => ({
      y: p.total,
      dica: `<strong>${p.total < 0 ? '−' : ''}${formatar(Math.abs(p.total))}</strong><span>${i === curva.length - 1 ? 'hoje' : `fim de ${nomeDoMes(p.dia.slice(0, 7))}`}</span>
        <span class="fino">contas ${formatar(p.caixa)} · investimentos ${formatar(p.investimentos)}</span>
        <span class="fino">cartões −${formatar(p.cartoes)} · dívidas −${formatar(p.dividas)}</span>`,
    })),
    formatar: compacto,
    marcas: [{ i: curva.length - 1, texto: 'hoje' }],
    rotulosX: curva.map((p, i) => ({ i, texto: i === curva.length - 1 ? 'hoje' : mesCurto(p.dia.slice(0, 7)) })),
    altura: 200,
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

document.addEventListener('click', (e) => {
  if (!ativa) return;
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

document.addEventListener('app:tela', (e) => {
  ativa = e.detail.tela === 'relatorios';
  if (ativa) pintar();
});
estado.aoAplicar(() => pintar());
