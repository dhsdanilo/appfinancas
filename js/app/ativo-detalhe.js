// A tela de leitura de um ativo: resumo, gráfico e detalhes, sem formulário nenhum.
// Registrar uma operação e editar o ativo moram na janela de alteração (js/app/ativo.js),
// a um botão daqui.

import * as estado from '../core/estado.js';
import { formatar } from '../core/dinheiro.js';
import { hoje, diaCurto, somarMeses } from '../core/datas.js';
import { visiveis } from '../core/lancamentos.js';
import { nomeDaClasse, posicao, serieDoAtivo } from '../core/investimentos.js';
import { liquidoDaVenda } from '../core/ir-venda.js';
import { areas, cor } from './graficos.js';
import { graficoDeLinha } from './grafico.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const sinal = (v) => `${v >= 0 ? '+' : '−'}${formatar(Math.abs(v))}`;
const quantos = (q) => q.toLocaleString('pt-BR', { maximumFractionDigits: 8 });
const eixo = (v) => {
  const abs = Math.abs(v / 100);
  return `${v < 0 ? '−' : ''}${abs >= 1000 ? `${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: abs >= 10000 ? 0 : 1 })} mil` : Math.round(abs).toLocaleString('pt-BR')}`;
};

const PERIODOS = [['3m', '3 meses'], ['12m', '12 meses'], ['tudo', 'tudo']];
const NOME_DA_OP = { aplicacao: 'aplicação', resgate: 'resgate', provento: 'provento' };
const NOME_DA_OP_COTAS = { aplicacao: 'compra', resgate: 'venda', provento: 'provento' };

const MARCACAO = `
<dialog id="dialogo-ativo-detalhe" class="dialogo-captura dialogo-ativo-detalhe" data-area="investimentos" aria-labelledby="titulo-ativo-detalhe">
  <div class="cabecalho-dialogo">
    <strong id="titulo-ativo-detalhe">Ativo</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="corpo-detalhe">
    <p class="nota" data-det="cabeca"></p>
    <div class="acoes-detalhe">
      <button type="button" class="principal" data-det="b-registrar"></button>
      <button type="button" data-det="b-editar">editar ativo</button>
    </div>
    <div class="numeros-detalhe" data-det="numeros"></div>
    <div class="ferramentas-detalhe" data-det="ferramentas"></div>
    <div data-det="grafico"></div>
    <div class="blocos-detalhe" data-det="blocos"></div>
    <div data-det="movimentos"></div>
  </div>
</dialog>`;

export function criarDetalheDoAtivo({ aoRegistrar, aoEditar } = {}) {
  document.body.insertAdjacentHTML('beforeend', MARCACAO);
  const janela = document.getElementById('dialogo-ativo-detalhe');
  const el = (papel) => janela.querySelector(`[data-det="${papel}"]`);
  let aberto = null;
  let periodo = '12m';
  let vista = 'valor';

  const numero = (rotulo, valor, nota = '', classe = '') =>
    `<div class="numero-det"><span class="rotulo-numero">${esc(rotulo)}</span><span class="valor-numero ${classe}">${valor}</span>${nota ? `<span class="fino">${esc(nota)}</span>` : ''}</div>`;
  const linha = (nome, valor, classe = '') =>
    `<li><span>${nome}</span><span class="${classe}">${valor}</span></li>`;

  async function pintar() {
    const app = await estado.calcular();
    const ativo = app.ativos[aberto];
    if (!ativo) { janela.close(); return; }
    const conta = app.contas[ativo.contaId];
    const p = posicao(app, ativo.id);
    const cotas = Boolean(p.porCotas);

    document.getElementById('titulo-ativo-detalhe').textContent = ativo.nome;
    el('cabeca').textContent = `${nomeDaClasse(ativo.classe)} · ${conta?.nome ?? ''}${ativo.vencimento ? ` · vence ${diaCurto(ativo.vencimento)}/${ativo.vencimento.slice(0, 4)}` : ''}${ativo.arquivado ? ' · arquivado' : ''}`;
    el('b-registrar').textContent = cotas ? 'comprar ou vender' : 'registrar operação';

    // Os quatro números.
    const nota = p.cotacao ? `preço de ${diaCurto(p.cotacao.data)}` : p.avaliacao ? `valor de ${diaCurto(p.avaliacao.data)}` : 'sem valor informado';
    el('numeros').innerHTML =
      numero('valor hoje', `${p.estimado && p.valorAtual ? '~' : ''}${formatar(p.valorAtual)}`, nota) +
      numero('investido', formatar(p.investido), p.resgatado ? `já resgatado ${formatar(p.resgatado)}` : '') +
      numero('rendeu', p.aplicado ? sinal(p.rendeu) : '—', p.aplicado ? pct(p.pct) : '', p.rendeu > 0 ? 'positivo' : p.rendeu < 0 ? 'negativo' : '') +
      numero('ao ano', p.aoAno == null ? '—' : `≈ ${pct(p.aoAno)}`, p.desde ? `desde ${diaCurto(p.desde)}/${p.desde.slice(0, 4)}` : '');

    // O gráfico: o período e a vista.
    if (!cotas) vista = 'valor';
    el('ferramentas').innerHTML = `<span class="seg-det" role="group" aria-label="Período">${PERIODOS.map(([id, nome]) =>
      `<button type="button" data-det-periodo="${id}" aria-pressed="${id === periodo}">${nome}</button>`).join('')}</span>
      ${cotas ? `<span class="seg-det" role="group" aria-label="O que mostrar">
        <button type="button" data-det-vista="valor" aria-pressed="${vista === 'valor'}">valor × investido</button>
        <button type="button" data-det-vista="preco" aria-pressed="${vista === 'preco'}">preço</button></span>` : ''}`;
    const de = periodo === 'tudo' ? '2000-01-01' : somarMeses(hoje(), periodo === '3m' ? -3 : -12);
    desenhar(serieDoAtivo(app, ativo.id, de));

    // Se vender hoje (Tesouro) e o que está na mão.
    const blocos = [];
    const venda = (ativo.classe === 'tesouro' || ativo.cotacao?.fonte === 'tesouro') && cotas ? liquidoDaVenda(p) : null;
    if (venda) {
      const aliquota = venda.aliquotas.map((x) => `${(x * 100).toFixed(1).replace('.', ',').replace(',0', '')}%`).join(' e ');
      blocos.push(`<div><p class="miudo titulo-linhas">se vender hoje · preço de venda de ${diaCurto(venda.data)}</p>
        <ul class="tabelinha">${linha(`bruto <span class="fino">${quantos(p.quantidade)} × ${formatar(venda.preco)}</span>`, formatar(venda.bruto))}
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
          linha(`${diaCurto(l.data)}/${l.data.slice(2, 4)} <span class="fino">${quantos(l.resta)} × ${formatar(Math.round(l.preco))}</span>`,
            l.variacao == null ? '—' : `${l.variacao >= 0 ? '+' : ''}${pct(l.variacao)}`, l.variacao > 0 ? 'positivo' : l.variacao < 0 ? 'negativo' : '')).join('')}</ul></div>`);
      }
    } else if (p.proventos) {
      blocos.push(`<div><p class="miudo titulo-linhas">proventos</p><ul class="tabelinha">${linha('recebidos', formatar(p.proventos))}</ul></div>`);
    }
    el('blocos').innerHTML = blocos.join('');

    // Os últimos movimentos: só as operações; a lista completa e a correção ficam na janela de alteração.
    const nomes = cotas ? NOME_DA_OP_COTAS : NOME_DA_OP;
    const ops = visiveis(app).filter((l) => l.ativoId === ativo.id && l.confirmado)
      .sort((a, b) => (a.dataCompetencia < b.dataCompetencia ? 1 : -1));
    el('movimentos').innerHTML = ops.length
      ? `<p class="miudo titulo-linhas">últimos movimentos</p><ul class="tabelinha">${ops.slice(0, 5).map((l) =>
          linha(`${diaCurto(l.dataCompetencia)}/${l.dataCompetencia.slice(2, 4)} · ${nomes[l.tipo] ?? l.tipo}${l.quantidade ? ` <span class="fino">${quantos(Number(l.quantidade))} × ${formatar(l.preco ?? 0)}</span>` : ''}`, formatar(l.valor))).join('')}</ul>
        ${ops.length > 5 ? `<button type="button" class="elo" data-det="b-ver-tudo">ver tudo (${ops.length})</button>` : ''}`
      : '';
  }

  function desenhar(serie) {
    const raiz = el('grafico');
    const semDados = (texto) => { raiz.innerHTML = `<p class="nota-rel">${texto}</p>`; };
    if (serie.length < 2) return semDados('Ainda não há histórico suficiente para o gráfico.');
    const rotulo = (s) => `${diaCurto(s.data)}/${s.data.slice(2, 4)}`;
    if (vista === 'preco') {
      const comPreco = serie.filter((s) => s.preco != null);
      if (comPreco.length < 2) return semDados('Sem preços suficientes neste período.');
      graficoDeLinha(raiz, {
        pontos: comPreco.map((s) => ({ y: s.preco, rotulo: rotulo(s), dica: `<strong>${formatar(s.preco)}</strong><span>${esc(rotulo(s))}</span>` })),
        rotulosX: comPreco.map((s, i) => ({ i, texto: rotulo(s) })),
        marcas: [{ i: comPreco.length - 1, texto: formatar(comPreco[comPreco.length - 1].preco) }],
        formatar,
        altura: 200,
      });
      return;
    }
    areas(raiz, {
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
      altura: 200,
    });
  }

  janela.addEventListener('click', async (e) => {
    if (e.target.closest('[data-fechar]')) { janela.close(); return; }
    const per = e.target.closest('[data-det-periodo]');
    if (per) { periodo = per.dataset.detPeriodo; await pintar(); return; }
    const vis = e.target.closest('[data-det-vista]');
    if (vis) { vista = vis.dataset.detVista; await pintar(); return; }
    if (e.target.closest('[data-det="b-registrar"], [data-det="b-ver-tudo"]')) {
      const id = aberto;
      janela.close();
      if (aoRegistrar) await aoRegistrar(id);
      return;
    }
    if (e.target.closest('[data-det="b-editar"]')) {
      const id = aberto;
      janela.close();
      if (aoEditar) await aoEditar(id);
    }
  });

  return {
    async abrir(ativoId) {
      aberto = ativoId;
      vista = 'valor';
      janela.showModal();
      await pintar();
    },
    /** Depois que algo mudou por baixo: se estiver aberta, repinta. */
    async repintar() {
      if (janela.open) await pintar();
    },
  };
}
