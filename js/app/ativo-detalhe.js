// A página de um ativo (#/ativo/<id>): resumo, gráfico, rendimento por período e detalhes,
// sem formulário nenhum. Registrar uma operação e editar o ativo moram na janela de
// alteração (js/app/ativo.js), a um botão daqui.

import * as estado from '../core/estado.js';
import { formatar } from '../core/dinheiro.js';
import { hoje, diaCurto, somarMeses } from '../core/datas.js';
import { visiveis } from '../core/lancamentos.js';
import { nomeDaClasse, posicao, serieDoAtivo, rendimentoDoAtivo } from '../core/investimentos.js';
import { liquidoDaVenda } from '../core/ir-venda.js';
import { donosNoDia } from '../core/envelopes.js';
import { areas, cor } from './graficos.js';
import { graficoDeLinha } from './grafico.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const sinal = (v) => `${v >= 0 ? '+' : '−'}${formatar(Math.abs(v))}`;
const quantos = (q) => q.toLocaleString('pt-BR', { maximumFractionDigits: 8 });
const dataCompleta = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
const eixo = (v) => {
  const abs = Math.abs(v / 100);
  return `${v < 0 ? '−' : ''}${abs >= 1000 ? `${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: abs >= 10000 ? 0 : 1 })} mil` : Math.round(abs).toLocaleString('pt-BR')}`;
};

const PERIODOS = [['1m', '1 mês'], ['3m', '3 meses'], ['6m', '6 meses'], ['12m', '12 meses'], ['ano', 'este ano'], ['tudo', 'desde o início'], ['outro', 'outro…']];
const NOME_DA_OP = { aplicacao: 'aplicação', resgate: 'resgate', provento: 'provento' };
const NOME_DA_OP_COTAS = { aplicacao: 'compra', resgate: 'venda', provento: 'provento' };
const MODOS = ['periodo', 'mes', 'ano'];
const CHAVE_MODO = 'appfinancas:rendimento-modo';

function modoGuardado() {
  try { const m = localStorage.getItem(CHAVE_MODO); return MODOS.includes(m) ? m : 'periodo'; } catch { return 'periodo'; }
}

/** De onde até onde vai o período escolhido. */
function intervalo(periodo, outro) {
  const ate = hoje();
  if (periodo === 'outro') return { de: outro.de || somarMeses(ate, -1), ate: outro.ate && outro.ate <= ate ? outro.ate : ate };
  if (periodo === 'tudo') return { de: '2000-01-01', ate };
  if (periodo === 'ano') return { de: `${ate.slice(0, 4)}-01-01`, ate };
  return { de: somarMeses(ate, -{ '1m': 1, '3m': 3, '6m': 6, '12m': 12 }[periodo]), ate };
}

export function iniciarPaginaDoAtivo({ aoRegistrar, aoEditar, aoCorrigir } = {}) {
  const raiz = document.getElementById('corpo-ativo');
  if (!raiz) return { pintar: () => {} };
  let ativa = false;
  let aberto = null;
  let periodo = '12m';
  let outro = { de: '', ate: '' };
  let modo = modoGuardado();
  let vista = 'valor';
  let todosOsMovimentos = false;

  const numero = (rotulo, valor, nota = '', classe = '') =>
    `<div class="numero-det"><span class="rotulo-numero">${esc(rotulo)}</span><span class="valor-numero ${classe}">${valor}</span>${nota ? `<span class="fino">${esc(nota)}</span>` : ''}</div>`;
  const linha = (nome, valor, classe = '') => `<li><span>${nome}</span><span class="${classe}">${valor}</span></li>`;

  async function pintar() {
    if (!ativa || !aberto) return;
    const app = await estado.calcular();
    const ativo = app.ativos[aberto];
    if (!ativo) { location.hash = '#/investimentos'; return; }
    const conta = app.contas[ativo.contaId];
    const p = posicao(app, ativo.id);
    const cotas = Boolean(p.porCotas);
    if (!cotas) vista = 'valor';
    const { de, ate } = intervalo(periodo, outro);
    const r = rendimentoDoAtivo(app, ativo.id, de, ate);

    // O título e o subtítulo do cabeçalho da página.
    document.getElementById('titulo-tela').textContent = ativo.nome;
    document.getElementById('sub-tela').textContent =
      `${nomeDaClasse(ativo.classe)} · ${conta?.nome ?? ''}${ativo.vencimento ? ` · vence ${diaCurto(ativo.vencimento)}/${ativo.vencimento.slice(0, 4)}` : ''}${ativo.arquivado ? ' · arquivado' : ''}`;
    document.title = `${ativo.nome} — App Finanças`;

    // O rendimento que alterna: no período, por mês (média composta) ou ao ano.
    let rendimento = { valor: '—', nota: 'sem histórico no período' };
    if (r) {
      if (modo === 'periodo') rendimento = { valor: pct(r.pct), nota: 'no período' };
      else if (modo === 'mes') rendimento = r.mensal == null ? { valor: '—', nota: 'precisa de cerca de 1 mês' } : { valor: `${pct(r.mensal)} ao mês`, nota: 'média composta' };
      else rendimento = r.anual == null ? { valor: '—', nota: 'precisa de cerca de 1 mês' } : { valor: `≈ ${pct(r.anual)} ao ano`, nota: r.meses < 12 ? 'projeção de um período curto' : 'equivalente anual' };
    }
    const proximo = { periodo: 'por mês', mes: 'ao ano', ano: 'no período' }[modo];

    const numeros =
      numero('valor hoje', `${p.estimado && p.valorAtual ? '~' : ''}${formatar(p.valorAtual)}`,
        p.cotacao ? `preço de ${diaCurto(p.cotacao.data)}` : p.avaliacao ? `valor de ${diaCurto(p.avaliacao.data)}` : 'sem valor informado') +
      numero('investido', formatar(p.investido), p.resgatado ? `já resgatado ${formatar(p.resgatado)}` : '') +
      numero('rendeu no período', r ? sinal(r.rendeu) : '—', r ? `${dataCompleta(r.desde)} a ${dataCompleta(ate)}` : '',
        r && r.rendeu > 0 ? 'positivo' : r && r.rendeu < 0 ? 'negativo' : '') +
      `<button type="button" class="numero-det alterna" data-det-modo title="Tocar para ver ${proximo}">
        <span class="rotulo-numero">rendimento <span aria-hidden="true">⇄</span></span><span class="valor-numero">${esc(rendimento.valor)}</span>
        <span class="fino">${esc(rendimento.nota)} · toque para ver ${proximo}</span></button>`;

    const periodos = `<div class="periodos-det" role="group" aria-label="Período">${PERIODOS.map(([id, nome]) =>
      `<button type="button" data-det-periodo="${id}" aria-pressed="${id === periodo}">${nome}</button>`).join('')}</div>
      ${periodo === 'outro' ? `<div class="outro-periodo"><label>de <input type="date" data-det-de value="${esc(de)}" max="${hoje()}"></label>
        <label>até <input type="date" data-det-ate value="${esc(ate)}" max="${hoje()}"></label></div>` : ''}`;

    // Os blocos: se vender hoje, na mão, compras, de quem é o dinheiro.
    const blocos = [];
    const venda = (ativo.classe === 'tesouro' || ativo.cotacao?.fonte === 'tesouro') && cotas ? liquidoDaVenda(p) : null;
    if (venda) {
      const aliquota = venda.aliquotas.map((x) => `${(x * 100).toFixed(1).replace('.', ',').replace(',0', '')}%`).join(' e ');
      blocos.push(`<div><p class="miudo titulo-linhas">se vender hoje · preço de venda de ${diaCurto(venda.data)}</p>
        <ul class="tabelinha">${linha('valor bruto', formatar(venda.bruto))}
        ${linha('ganho', formatar(venda.ganho))}
        ${linha(`IR${aliquota ? ` <span class="fino">${aliquota}</span>` : ''}`, venda.ir ? `− ${formatar(venda.ir)}` : formatar(0), venda.ir ? 'negativo' : '')}
        ${linha('<strong>líquido do IR</strong>', `<strong>${formatar(venda.liquido)}</strong>`)}</ul>
        <p class="miudo">Não inclui a taxa de custódia da B3.</p></div>`);
    }
    if (cotas) {
      blocos.push(`<div><p class="miudo titulo-linhas">na mão</p>
        <ul class="tabelinha">${linha('quantidade', quantos(p.quantidade))}
        ${p.quantidade ? linha('preço médio', formatar(Math.round(p.precoMedio))) : ''}
        ${p.cotacao ? linha(`cotação de ${diaCurto(p.cotacao.data)}`, formatar(p.cotacao.preco)) : ''}
        ${p.proventos ? linha('proventos recebidos', formatar(p.proventos)) : ''}</ul></div>`);
      if (p.lotes.length > 1) {
        blocos.push(`<div><p class="miudo titulo-linhas">compras na mão</p><ul class="tabelinha">${p.lotes.map((l) =>
          linha(`${dataCompleta(l.data)} <span class="fino">${quantos(l.resta)} × ${formatar(Math.round(l.preco))}</span>`,
            l.variacao == null ? '—' : `${l.variacao >= 0 ? '+' : ''}${pct(l.variacao)}`, l.variacao > 0 ? 'positivo' : l.variacao < 0 ? 'negativo' : '')).join('')}</ul></div>`);
      }
    } else if (p.proventos) {
      blocos.push(`<div><p class="miudo titulo-linhas">proventos</p><ul class="tabelinha">${linha('recebidos', formatar(p.proventos))}</ul></div>`);
    }
    // De quem é o dinheiro: cada envelope com a sua parte, a um toque do envelope.
    const lugar = donosNoDia(app).porLugar.get(ativo.id);
    if (lugar && lugar.valor > 0 && (lugar.donos.size || lugar.semDono > 0)) {
      const partes = [...lugar.donos.entries()].filter(([id]) => app.envelopes[id]).sort((a, b) => b[1] - a[1]);
      blocos.push(`<div><p class="miudo titulo-linhas">de quem é este dinheiro</p><ul class="tabelinha donos-det">${partes.map(([id, v]) =>
        `<li><a href="#/envelopes/${esc(id)}" class="elo-envelope">${esc(app.envelopes[id].nome)}</a><span>${formatar(v)} <span class="fino">${Math.round((v / lugar.valor) * 100)}%</span></span></li>`).join('')}
        ${lugar.semDono > 0 ? linha('<span class="fino">sem dono</span>', `${formatar(lugar.semDono)} <span class="fino">${Math.round((lugar.semDono / lugar.valor) * 100)}%</span>`) : ''}</ul></div>`);
    }

    // Os últimos movimentos: só as operações; a lista completa e a correção ficam na janela de alteração.
    const nomes = cotas ? NOME_DA_OP_COTAS : NOME_DA_OP;
    const ops = visiveis(app).filter((l) => l.ativoId === ativo.id && l.confirmado)
      .sort((a, b) => (a.dataCompetencia < b.dataCompetencia ? 1 : -1));
    const mostradas = todosOsMovimentos ? ops : ops.slice(0, 5);
    const movimentos = ops.length
      ? `<p class="miudo titulo-linhas">${todosOsMovimentos ? 'movimentos' : 'últimos movimentos'} <span class="fino">· toque para corrigir</span></p>
        <ul class="tabelinha movimentos-det">${mostradas.map((l) =>
          `<li><button type="button" class="movimento-det" data-det-op="${esc(l.id)}" aria-label="Corrigir ${esc(nomes[l.tipo] ?? l.tipo)} de ${esc(dataCompleta(l.dataCompetencia))}">
            <span>${dataCompleta(l.dataCompetencia)} · ${nomes[l.tipo] ?? l.tipo}${l.quantidade ? ` <span class="fino">${quantos(Number(l.quantidade))} × ${formatar(l.preco ?? 0)}</span>` : ''}</span>
            <span>${formatar(l.valor)} <span class="fino" aria-hidden="true">✎</span></span></button></li>`).join('')}</ul>
        ${ops.length > 5 ? `<button type="button" class="elo" data-det="b-ver-tudo">${todosOsMovimentos ? 'mostrar só os últimos' : `ver todos (${ops.length})`}</button>` : ''}`
      : '';

    raiz.innerHTML = `<div class="pagina-ativo">
      <div class="topo-ativo">
        <a class="voltar-ativo" href="#/investimentos">‹ Investimentos</a>
        <span class="acoes-detalhe">
          <button type="button" class="principal" data-det="b-registrar">${cotas ? 'comprar ou vender' : 'registrar operação'}</button>
          <button type="button" data-det="b-editar">editar ativo</button>
        </span>
      </div>
      ${periodos}
      <div class="numeros-detalhe">${numeros}</div>
      ${cotas ? `<div class="ferramentas-detalhe"><span class="seg-det" role="group" aria-label="O que mostrar">
        <button type="button" data-det-vista="valor" aria-pressed="${vista === 'valor'}">valor × investido</button>
        <button type="button" data-det-vista="preco" aria-pressed="${vista === 'preco'}">preço</button></span></div>` : ''}
      <div data-det="grafico"></div>
      <div class="blocos-detalhe">${blocos.join('')}</div>
      <div>${movimentos}</div>
    </div>`;
    desenhar(serieDoAtivo(app, ativo.id, de, ate));
  }

  function desenhar(serie) {
    const grafico = raiz.querySelector('[data-det="grafico"]');
    const semDados = (texto) => { grafico.innerHTML = `<p class="nota-rel">${texto}</p>`; };
    if (serie.length < 2) return semDados('Ainda não há histórico suficiente neste período.');
    const rotulo = (s) => dataCompleta(s.data);
    if (vista === 'preco') {
      const comPreco = serie.filter((s) => s.preco != null);
      if (comPreco.length < 2) return semDados('Sem preços suficientes neste período.');
      graficoDeLinha(grafico, {
        pontos: comPreco.map((s) => ({ y: s.preco, rotulo: rotulo(s), dica: `<strong>${formatar(s.preco)}</strong><span>${esc(rotulo(s))}</span>` })),
        rotulosX: comPreco.map((s, i) => ({ i, texto: rotulo(s) })),
        marcas: [{ i: comPreco.length - 1, texto: formatar(comPreco[comPreco.length - 1].preco) }],
        formatar,
        altura: 220,
      });
      return;
    }
    areas(grafico, {
      pontos: serie.map((s) => ({
        rotulo: rotulo(s),
        acima: [s.investido, Math.max(0, s.valor - s.investido)],
        abaixo: [],
        linha: s.valor,
        dica: `<strong>${formatar(s.valor)}</strong><span>${esc(rotulo(s))}</span>
          <span class="fino">investido ${formatar(s.investido)} · ${s.valor - s.investido >= 0 ? 'rendeu' : 'perdeu'} ${formatar(Math.abs(s.valor - s.investido))}</span>`,
      })),
      acima: [{ nome: 'investido', cor: cor(1) }, { nome: 'rendimento', cor: cor(3) }],
      abaixo: [],
      linha: { nome: 'valor', cor: 'var(--tinta)' },
      formatar: eixo,
      altura: 220,
    });
  }

  raiz.addEventListener('click', async (e) => {
    const per = e.target.closest('[data-det-periodo]');
    if (per) {
      periodo = per.dataset.detPeriodo;
      if (periodo === 'outro' && !outro.de) outro = { de: somarMeses(hoje(), -3), ate: hoje() };
      await pintar();
      return;
    }
    const vis = e.target.closest('[data-det-vista]');
    if (vis) { vista = vis.dataset.detVista; await pintar(); return; }
    if (e.target.closest('[data-det-modo]')) {
      modo = MODOS[(MODOS.indexOf(modo) + 1) % MODOS.length];
      try { localStorage.setItem(CHAVE_MODO, modo); } catch { /* só não lembra na próxima */ }
      await pintar();
      return;
    }
    const op = e.target.closest('[data-det-op]');
    if (op) { if (aoCorrigir) await aoCorrigir(aberto, op.dataset.detOp); return; }
    if (e.target.closest('[data-det="b-ver-tudo"]')) { todosOsMovimentos = !todosOsMovimentos; await pintar(); return; }
    if (e.target.closest('[data-det="b-registrar"]')) { if (aoRegistrar) await aoRegistrar(aberto); return; }
    if (e.target.closest('[data-det="b-editar"]')) { if (aoEditar) await aoEditar(aberto); }
  });
  raiz.addEventListener('change', async (e) => {
    if (e.target.matches('[data-det-de]')) { outro.de = e.target.value; await pintar(); }
    if (e.target.matches('[data-det-ate]')) { outro.ate = e.target.value; await pintar(); }
  });

  document.addEventListener('app:tela', (e) => {
    ativa = e.detail.tela === 'ativo';
    if (!ativa) return;
    if (e.detail.sub !== aberto) { vista = 'valor'; todosOsMovimentos = false; }
    aberto = e.detail.sub;
    pintar();
  });
  estado.aoAplicar(() => pintar());
  return { pintar };
}
