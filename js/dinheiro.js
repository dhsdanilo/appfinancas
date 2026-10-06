// As telas de dinheiro: Início, Lançamentos e as cinco áreas (Contas, Cartões,
// Renda, Investimentos, Dívidas). design/08-telas §1 e §4.1, reestruturado em
// 03/10/2026.
//
// Uma tela por natureza de dinheiro, cada uma com a sua cor: saldo de
// corrente, fatura de cartão, investimento e folha são números diferentes, e
// lado a lado eles se somariam na cabeça de quem lê. Lançamentos é a lista
// única (R1), com busca e filtros; Início é o resumo e a fila do que precisa
// de você.

import * as estado from './core/estado.js';
import { dinheiroHTML } from './app/dinheiro-html.js';
import { formatar, deTexto } from './core/dinheiro.js';
import { criarFormulario } from './app/formulario.js';
import { criarTransferencia } from './app/transferencia.js';
import { criarFila } from './app/fila.js';
import { criarDevolucao } from './app/devolucao.js';
import { criarConferencia } from './app/conferencia.js';
import { criarHolerite } from './app/holerite.js';
import { linhasDoHolerite, lancadosNoMes } from './core/holerite.js';
import { situacao, saldoDevedor, jurosDaParcela, cronograma, simularAmortizacao } from './core/divida.js';
import { fotografar, amortizar, pularParcela } from './app/contrato.js';
import { lancarOcorrencia } from './app/ocorrencia.js';
import { criarJanelaDoAtivo } from './app/ativo.js';
import { iniciarPaginaDoAtivo } from './app/ativo-detalhe.js';
import { criarImportacao } from './app/importar.js';
import { resumoDaConta, ativosDaConta, nomeDaClasse, CLASSES } from './core/investimentos.js';
import { donosNoDia, envelopesAtivos, numerosDoEnvelope } from './core/envelopes.js';
import { avisosDoInicio } from './core/avisos.js';
import { ultimaCopia } from './core/copia.js';
import { mesDosInvestimentos, rendimentoNoPeriodo } from './core/relatorios.js';
import { areas, cor as corDaSerie } from './app/graficos.js';
import { aoLancar } from './app/pagina.js';
import { enderecoDa } from './app/rotas.js';
import { BARRA, PRINCIPAL, DIALOGOS, ICONES } from './app/marcacao-dinheiro.js';
import { porOrdemDaConta, corDaConta } from './core/ordem.js';
import { bolinhaDaConta } from './core/icones-conta.js';
import { csvDosLancamentos } from './core/exportar.js';
import { rendaDaFolha, liquidoPrevisto } from './core/holerite.js';
import {
  visiveis, porDataDecrescente, estadoDoLancamento, saldoReal, nomeDaCategoria,
  sinalDeSaida, ehTransferencia, dataVista, estornado, ehDeInvestimento,
} from './core/lancamentos.js';
import { temCiclo } from './core/cartao.js';
import { provisaoDoCartao, temCofrinho } from './core/cofrinho.js';
import { disponivelDe, aReceber } from './core/repasse.js';
import { extratoDoMes, resultadoDoMes, aEntrarNoMes, saldoNoDia } from './core/mes-da-conta.js';
import { AREAS as ABAS } from './app/areas.js';
import {
  faturas, faturasNoPeriodo, resumoDoCartao, saldoPrevisto, ocorrenciasPrevistas,
} from './core/previsto.js';
import {
  hoje, inicioDoMes, fimDoMes, somarMeses, nomeDoMes, diaCurto, proximoMes,
} from './core/datas.js';

const $ = (id) => document.getElementById(id);

// Que tela é esta: a rota diz (js/app/rotas.js), e muda sem recarregar.
const AREA_DA_PAGINA = {
  contas: 'caixa', cartoes: 'cartoes', renda: 'folha', investimentos: 'investimentos', dividas: 'dividas',
};
const PAGINA_DA_AREA = Object.fromEntries(Object.entries(AREA_DA_PAGINA).map(([p, a]) => [a, p]));
let PAGINA = null;
let AREA = null;
// A tela de dinheiro está à vista? Fora dela não se pinta nada.
let ativa = false;

$('principal').innerHTML = BARRA + PRINCIPAL;
// As abas das contas sobem para o cabeçalho, no lugar do título (só nas cinco áreas).
document.querySelector('.topo .identidade')?.append($('subabas'));
const abasNoTopo = (sim) => document.body.classList.toggle('abas-no-topo', sim);
document.body.insertAdjacentHTML('beforeend', DIALOGOS);

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── a vista: aba, conta e período ─────────────────────────────────────────
//
// A vista não reseta ao navegar (08-telas §5): quem estava olhando uma conta
// volta pra ela. Guardada no aparelho, e só como conveniência — se o
// navegador recusar, a tela abre no padrão e funciona igual.

// O período vale para todas as telas (08-telas §4.1); o foco (conta, filtros)
// é de cada uma, e volta quando se volta a ela.
const CHAVE_PERIODO = 'dinheiro.periodo';
const chaveDaTela = (pagina) => `dinheiro.vista.${pagina}`;
const FOCO_PADRAO = { conta: 'todas', area: 'todas', busca: '', categoria: '' };

function lerGuardado(chave) {
  try {
    const v = JSON.parse(localStorage.getItem(chave) ?? 'null');
    if (v && typeof v === 'object') return v;
  } catch {
    // sem armazenamento: vale o padrão
  }
  return {};
}

// A data do último lançamento salvo e o mês da tela em que foi (D35).
let ultimaData = null;

const vista = {
  aba: 'caixa',
  ...FOCO_PADRAO,
  modo: 'mes',
  mes: hoje().slice(0, 7),
  de: inicioDoMes(hoje()),
  ate: hoje(),
  ...lerGuardado(CHAVE_PERIODO),
};
// O mês volta sempre ao corrente: abrir o app e cair em março passado
// confunde mais do que ajuda.
vista.mes = hoje().slice(0, 7);

// O foco de cada tela, enquanto o app está aberto.
const focos = {};

function guardarVista() {
  if (!PAGINA) return;
  focos[PAGINA] = { conta: vista.conta, area: vista.area, busca: vista.busca, categoria: vista.categoria };
  try {
    localStorage.setItem(chaveDaTela(PAGINA), JSON.stringify({ ...focos[PAGINA], busca: '' }));
    localStorage.setItem(CHAVE_PERIODO, JSON.stringify({ modo: vista.modo, de: vista.de, ate: vista.ate }));
  } catch {
    // sem armazenamento: a vista só não sobrevive ao recarregar
  }
}

// Em Cartões o mês é o da fatura, e a tela abre na fatura ABERTA — a que
// ainda recebe compras (pedido dele, 03/10/2026). O mês das outras telas fica
// guardado e volta quando se sai dela.
let mesForaDosCartoes = null;
let mesDaFaturaAberta = null;
let abrirNaFaturaAberta = false;
// Quem pediu "ir para esta conta": a próxima entrada na tela já cai nela.
let destinoPedido = null;

/** Cartões é sempre mês a mês: a fatura é mensal, um intervalo a cortaria. */
const modoDaTela = () => (PAGINA === 'cartoes' ? 'mes' : vista.modo);

/** Entra numa tela de dinheiro: troca o foco e pinta. */
function entrar(pagina) {
  if (PAGINA && PAGINA !== pagina) guardarVista();
  // O + e o transferir estão no cabeçalho só na página inicial; nas outras, na caixa.
  if (pagina !== 'inicio') document.querySelector('.linha-topo-painel')?.append($('barra-acoes'));
  // O mês acompanha entre as telas: Cartões só salta para a fatura aberta
  // quando o mês da tela é o corrente; noutro mês, mostra a fatura dele.
  if (pagina === 'cartoes' && PAGINA !== 'cartoes') {
    abrirNaFaturaAberta = vista.mes === hoje().slice(0, 7);
    mesForaDosCartoes = abrirNaFaturaAberta ? vista.mes : null;
    mesDaFaturaAberta = null;
  } else if (pagina !== 'cartoes' && PAGINA === 'cartoes' && mesForaDosCartoes && vista.mes === mesDaFaturaAberta) {
    // o mês só foi trocado pelo salto; se a pessoa navegou, vale o que ela fez
    vista.mes = mesForaDosCartoes;
  }
  PAGINA = pagina;
  AREA = AREA_DA_PAGINA[pagina] ?? null;
  Object.assign(vista, FOCO_PADRAO, focos[pagina] ?? lerGuardado(chaveDaTela(pagina)));
  if (destinoPedido?.pagina === pagina) {
    vista.conta = destinoPedido.conta;
    abrirNaFaturaAberta = false;
    mesForaDosCartoes = null;
  }
  destinoPedido = null;
  vista.aba = AREA ?? 'caixa';
  return pintar();
}

/** A tela onde mora uma conta: Contas, Cartões, Renda, Investimentos ou Dívidas. */
const paginaDaConta = (conta) => PAGINA_DA_AREA[ABAS.find((a) => a.tipos.includes(conta?.tipo))?.id] ?? null;

/**
 * Vai para a conta, no mesmo período (o mês é um só entre as telas). Com `mes`,
 * muda o mês antes — a fatura de Cartões é a daquele vencimento.
 */
function irParaConta(contaId, mes = null) {
  const conta = app?.contas?.[contaId];
  const pagina = paginaDaConta(conta);
  if (!pagina) return;
  if (mes) vista.mes = mes;
  destinoPedido = { pagina, conta: contaId };
  if (PAGINA === pagina) {
    PAGINA = null; // entrar de novo, pelo mesmo caminho das outras telas
    entrar(pagina);
  } else {
    location.hash = `#/${pagina}`;
  }
}

function intervalo() {
  if (modoDaTela() === 'intervalo' && vista.de && vista.ate) {
    return vista.de <= vista.ate ? { de: vista.de, ate: vista.ate } : { de: vista.ate, ate: vista.de };
  }
  const dia = `${vista.mes}-01`;
  return { de: dia, ate: fimDoMes(dia) };
}

// ── pintura ───────────────────────────────────────────────────────────────

let app = null;
// Os previstos que estão na tela, pelo id: tocar num deles abre exatamente o
// que se viu, sem refazer a conta com outro intervalo.
const previstosNaTela = new Map();
// As linhas desenhadas agora, com o texto delas: é o que o Exportar leva para a planilha.
const linhasNaTela = [];

async function pintar() {
  if (!ativa) return;
  // Mudou o mês da tela: a data do último lançamento salvo deixa de valer (D35).
  if (ultimaData && ultimaData.mes !== vista.mes) ultimaData = null;
  app = await estado.calcular();
  previstosNaTela.clear();
  linhasNaTela.length = 0;
  // No Início não há lista: nada a exportar.
  $('b-exportar').hidden = PAGINA === 'inicio';
  // A fila do que precisa de você mora no Início (08-telas §6).
  if (PAGINA === 'inicio') fila?.pintar(app);
  else $('pendencias').hidden = true;

  if (PAGINA === 'inicio') return pintarInicio();
  if (PAGINA === 'lancamentos') return pintarLancamentos();
  return pintarArea();
}

/** Uma área: Contas, Cartões, Renda, Investimentos ou Dívidas. */
function pintarArea() {
  vista.aba = AREA;
  const aba = ABAS.find((a) => a.id === AREA);
  const contas = contasDaAba(aba);
  if (vista.conta !== 'todas' && !contas.some((c) => c.id === vista.conta)) vista.conta = 'todas';

  // A tela inteira veste a cor da área (09-identidade §3) — inclusive o
  // "novo lançamento", que por isso abre nela.
  $('painel').dataset.area = aba.id;
  $('barra-acoes').dataset.area = aba.id;
  document.body.dataset.area = aba.id;
  if (aba.id === 'dividas') return pintarDividas(contas);
  if (aba.id === 'cartoes' && abrirNaFaturaAberta) {
    abrirNaFaturaAberta = false;
    const comCiclo = contas.find((c) => temCiclo(c));
    const aberta = comCiclo ? resumoDoCartao(app, comCiclo.id)?.aberta : null;
    vista.mes = aberta ? aberta.vencimento.slice(0, 7) : proximoMes(hoje().slice(0, 7));
    mesDaFaturaAberta = vista.mes;
  }
  pintarSubabas(contas);
  pintarPeriodo();

  const foco = vista.conta === 'todas' ? contas : contas.filter((c) => c.id === vista.conta);
  if (!contas.length) {
    // A tela vazia ensina o próximo passo, sem culpa (08-telas §9).
    $('resumo').innerHTML = `<p class="vazio">${escapar(VAZIO_DA_AREA[AREA])}</p>`;
    $('parte-lista').hidden = true;
    $('periodo').hidden = true;
    return;
  }
  $('parte-lista').hidden = false;
  $('periodo').hidden = false;
  $('filtros').hidden = true;

  if (aba.id === 'cartoes') {
    pintarResumoDeCartoes(foco);
    pintarListaDeCartoes(foco);
  } else {
    if (aba.id === 'caixa') pintarResumoDeCaixa(foco);
    else if (aba.id === 'investimentos') pintarInvestimentos(foco);
    else pintarResumoDeSaldos(aba, foco);
    pintarLista(aba, foco);
  }
  // Com uma conta à vista, o "editar" dela fica no canto de cima; a lista
  // "Suas contas" de baixo saiu (pedido dele, 03/10/2026).
  if (foco.length === 1) {
    $('resumo').insertAdjacentHTML('afterbegin', `<div class="topo-conta">
      <button type="button" class="elo" data-editar-conta="${escapar(foco[0].id)}">editar ${escapar(foco[0].nome)}</button>
    </div>`);
  }
  const arquivadas = Object.values(app.contas).filter((c) => c.arquivada && aba.tipos.includes(c.tipo) && !contas.includes(c));
  if (arquivadas.length) {
    $('resumo').insertAdjacentHTML('beforeend', `<p class="arquivadas-area fino">arquivadas: ${arquivadas
      .map((c) => `<button type="button" class="elo" data-editar-conta="${escapar(c.id)}">${escapar(c.nome)}</button>`)
      .join(' · ')}</p>`);
  }
  guardarVista();
}

const VAZIO_DA_AREA = {
  caixa: 'Nenhuma conta ainda. Comece pela que você mais usa — o botão "Nova conta" fica aqui em cima.',
  cartoes: 'Nenhum cartão ainda. Com o dia de fechamento e de vencimento, cada compra cai na fatura certa.',
  folha: 'Nenhuma fonte de renda ainda. Uma para cada: o salário, o contrato PJ, os atendimentos.',
  investimentos: 'Nenhum investimento ainda.',
  dividas: 'Nenhum empréstimo ainda. Com o contrato, o app gera as parcelas e acompanha o saldo devedor.',
};

// ── Início: o resumo de cada área e o que precisa de você ─────────────────

function pintarInicio() {
  for (const parte of ['subabas', 'periodo', 'parte-lista', 'filtros']) $(parte).hidden = true;
  abasNoTopo(false);
  delete $('painel').dataset.area;
  delete $('barra-acoes').dataset.area;
  // O + e o transferir moram no canto do cabeçalho, não dentro da caixa.
  document.querySelector('.topo').append($('barra-acoes'));
  const hojePorExtenso = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  $('data-marca').textContent = `${hojePorExtenso[0].toUpperCase()}${hojePorExtenso.slice(1)} · como estamos agora`;

  const blocos = [];
  for (const area of ABAS) {
    const contas = contasDaAba(area);
    if (!contas.length) continue;
    blocos.push(cartaoDoInicio(area, contas));
  }
  const envelopes = cartaoDeEnvelopesDoInicio();
  if (envelopes) blocos.push(envelopes);
  $('resumo').innerHTML = blocos.length
    ? `${avisosHTML()}<div class="blocos blocos-inicio">${blocos.join('')}</div>`
    : `<p class="vazio">Nada por aqui ainda. Comece criando uma conta em <a href="${enderecoDa('contas')}">Contas</a> e as categorias em <a href="${enderecoDa('configuracoes')}">Configurações</a>.</p>`;
  guardarVista();
}

const ICONE_DO_AVISO = { ruim: '!', atencao: '◷', info: 'i' };

/** A faixa de avisos: até quatro, os que mais pedem atenção primeiro. */
function avisosHTML() {
  const lista = avisosDoInicio(app, hoje(), { ultimaCopia: ultimaCopia() });
  if (!lista.length) return '';
  const cartoes = lista.slice(0, 4).map((a, k) => {
    const alvo = a.para.conta ? `data-ir-conta="${escapar(a.para.conta)}"${a.para.mes ? ` data-ir-mes="${escapar(a.para.mes)}"` : ''}`
      : `data-ir-tela="${escapar(a.para.tela)}"`;
    return `<button type="button" class="aviso-inicio ${a.nivel}" ${alvo} data-k="${k}">
      <span class="icone-aviso" aria-hidden="true">${ICONE_DO_AVISO[a.nivel]}</span>
      <span class="texto-aviso"><span class="titulo-aviso">${escapar(a.titulo)}</span><span class="detalhe-aviso">${escapar(a.detalhe)}</span></span>
    </button>`;
  }).join('');
  return `<section class="avisos-inicio" aria-label="Avisos"><p class="rotulo-avisos">Atenção${lista.length > 4 ? ` <span class="fino">· mais ${lista.length - 4}</span>` : ''}</p><div class="grade-avisos">${cartoes}</div></section>`;
}

/** Um card por área, com o número que importa nela, levando à tela dela. */
function cartaoDoInicio(area, contas) {
  const titulo = { caixa: 'Contas', cartoes: 'Cartões', folha: 'Renda', investimentos: 'Investimentos', dividas: 'Dívidas' }[area.id];
  const rotulo = (t) => `<span class="rotulo-numero">${escapar(t)}</span>`;
  let corpo = '';

  if (area.id === 'caixa') {
    const ps = contas.map((c) => saldoPrevisto(app, c.id));
    const real = ps.reduce((t, p) => t + p.real, 0);
    const previsto = ps.reduce((t, p) => t + p.previsto, 0);
    const estimado = ps.some((p) => p.estimado);
    corpo = `${rotulo('saldo real')}
      <span class="valor-card-inicio ${real < 0 ? 'negativo' : ''}">${dinheiroHTML(real)}</span>
      <span class="linha-card-inicio">previsto até ${diaCurto(ps[0].ate)} <strong class="${previsto < 0 ? 'negativo' : 'positivo'}">${dinheiroHTML(previsto, { estimado })}</strong></span>
      <span class="fino">${contas.length} conta${contas.length > 1 ? 's' : ''}</span>`;
  }

  if (area.id === 'cartoes') {
    let aberta = 0;
    let fechada = 0;
    let venceAberta = null;
    let usado = 0;
    let limite = 0;
    let provisionado = 0;
    let alvo = 0;
    for (const c of contas) {
      const r = resumoDoCartao(app, c.id);
      if (!r) continue;
      aberta += r.aberta?.aPagar ?? 0;
      fechada += r.fechada?.aPagar ?? 0;
      if (r.aberta && (!venceAberta || r.aberta.vencimento < venceAberta)) venceAberta = r.aberta.vencimento;
      usado += r.divida ?? 0;
      limite += c.limite ?? 0;
      const p = provisaoDoCartao(app, c.id);
      if (p) { provisionado += p.provisionado; alvo += p.alvo; }
    }
    const barra = (pct) => `<span class="barra-limite" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, pct)).toFixed(1)}%"></i></span>`;
    corpo = `${fechada ? `${rotulo('fatura fechada a pagar')}<span class="valor-card-inicio negativo">${dinheiroHTML(fechada)}</span>` : ''}
      ${rotulo(`fatura aberta${venceAberta ? ` · vence ${diaCurto(venceAberta)}` : ''}`)}
      <span class="valor-card-inicio ${fechada ? 'menor' : ''}">${dinheiroHTML(aberta)}</span>
      ${limite > 0 ? `<span class="linha-barra-inicio"><span>limite</span><span>${Math.round((usado / limite) * 100)}% usado</span></span>${barra((usado / limite) * 100)}` : ''}
      ${alvo > 0 ? `<span class="linha-barra-inicio"><span>cofrinho</span><span>${provisionado >= alvo ? 'coberto' : `${Math.round((provisionado / alvo) * 100)}% provisionado`}</span></span>${barra((provisionado / alvo) * 100)}` : ''}`;
  }

  if (area.id === 'folha') {
    const mes = hoje().slice(0, 7);
    const doMes = visiveis(app).filter(
      (l) => contas.some((c) => c.id === l.contaId) && l.dataCompetencia.slice(0, 7) === mes
    );
    const { liquida } = rendaDaFolha(app, doMes, new Set(contas.map((c) => c.id)));
    const faltam = contas.filter((c) => linhasDoHolerite(app, c.id, mes).some((l) => !l.automatico)).length;
    corpo = `${rotulo(`líquida de ${nomeDoMes(mes).split(' ')[0]}`)}
      <span class="valor-card-inicio">${dinheiroHTML(liquida)}</span>
      ${faltam ? `<span class="linha-card-inicio atencao">contracheque${faltam > 1 ? 's' : ''} a lançar</span>` : '<span class="fino">contracheque lançado</span>'}`;
  }

  if (area.id === 'investimentos') {
    const resumos = contas.map((c) => resumoDaConta(app, c));
    const total = resumos.reduce((t, r) => t + r.valorAtual, 0);
    const rendeu = resumos.reduce((t, r) => t + r.rendeu, 0);
    corpo = `${rotulo('valor atual')}
      <span class="valor-card-inicio">${dinheiroHTML(total, { estimado: resumos.some((r) => r.estimado) })}</span>
      <span class="linha-card-inicio"><strong class="${rendeu >= 0 ? 'positivo' : 'negativo'}">${dinheiroHTML(rendeu, { sinal: rendeu >= 0 ? '+' : '' })}</strong> rendeu</span>`;
  }

  if (area.id === 'dividas') {
    const total = contas.reduce((t, c) => t + (saldoDevedor(app, c.id) ?? 0), 0);
    const parcelas = contas.reduce((t, c) => {
      const s = situacao(app, c.id);
      return t + (s?.restantes ? s.valorParcela : 0);
    }, 0);
    corpo = `${rotulo('saldo devedor')}
      <span class="valor-card-inicio">${dinheiroHTML(total, { estimado: contas.some((c) => situacao(app, c.id)?.estimado) })}</span>
      ${parcelas ? `<span class="linha-card-inicio">parcelas por mês <strong>${dinheiroHTML(parcelas)}</strong></span>` : ''}`;
  }

  return `<a class="bloco bloco-link card-inicio" href="${enderecoDa(PAGINA_DA_AREA[area.id])}" data-area="${area.id}">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(titulo)}</p>
    <div class="corpo-card-inicio">${corpo}</div>
  </a>`;
}

/** Os envelopes que mais pedem atenção: atrasados primeiro, até três, cada um com a sua barra. */
function cartaoDeEnvelopesDoInicio() {
  const lista = envelopesAtivos(app);
  if (!lista.length) return '';
  const donos = donosNoDia(app);
  const itens = lista.map((v) => {
    const total = donos.porEnvelope.get(v.id)?.total ?? 0;
    const n = numerosDoEnvelope(v, total);
    return { v, total, n, atrasado: n.deveriaTer != null && total < n.deveriaTer, pct: n.alvo ? Math.max(0, Math.min(1, total / n.alvo)) : null };
  });
  const mostrados = itens
    .sort((a, b) => Number(b.atrasado) - Number(a.atrasado) || (a.pct ?? 2) - (b.pct ?? 2))
    .slice(0, 3);
  const linhas = mostrados.map((x) => `<span class="envelope-inicio">
      <span class="linha-barra-inicio"><span>${escapar(x.v.nome)}</span><span class="${x.atrasado ? 'atencao' : ''}">${x.atrasado ? 'atrasado' : x.pct != null ? `${Math.round(x.pct * 100)}%` : dinheiroHTML(x.total)}</span></span>
      ${x.pct != null ? `<span class="barra-limite" aria-hidden="true"><i style="width:${(x.pct * 100).toFixed(1)}%;background:${corDaConta(x.v.nome)}"></i></span>` : ''}
    </span>`).join('');
  return `<a class="bloco bloco-link card-inicio" href="${enderecoDa('envelopes')}" data-area="envelopes">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>Envelopes</p>
    <div class="corpo-card-inicio">${linhas}${itens.length > 3 ? `<span class="fino">e mais ${itens.length - 3}</span>` : ''}</div>
  </a>`;
}

// ── Lançamentos: a lista única (R1), com busca e filtros ──────────────────

function pintarLancamentos() {
  $('subabas').hidden = true;
  abasNoTopo(false);
  $('filtros').hidden = false;
  $('parte-lista').hidden = false;
  $('periodo').hidden = false;
  $('resumo').innerHTML = '';
  delete $('painel').dataset.area;
  delete $('barra-acoes').dataset.area;
  pintarPeriodo();
  pintarFiltros();

  const { de, ate } = intervalo();
  const noPeriodo = (dia) => dia >= de && dia <= ate;
  const area = ABAS.find((a) => a.id === vista.area);
  const contas = Object.values(app.contas).filter(
    (c) => (!area || area.tipos.includes(c.tipo)) && (!vista.conta || vista.conta === 'todas' || c.id === vista.conta)
  );
  const ids = new Set(contas.map((c) => c.id));
  const busca = vista.busca.trim().toLocaleLowerCase('pt-BR');

  const candidatas = [
    ...visiveis(app),
    ...ocorrenciasPrevistas(app, de, ate),
  ].filter((l) => (ids.has(l.contaId) || ids.has(l.contaDestinoId)) && noPeriodo(dataVista(l)));

  const linhas = candidatas
    .filter((l) => !vista.categoria || l.categoriaId === vista.categoria)
    .filter((l) => !busca || textoDaLinha(l).includes(busca))
    .sort((a, b) => {
      const da = dataVista(a);
      const db = dataVista(b);
      return da !== db ? (da < db ? 1 : -1) : a.id < b.id ? 1 : -1;
    });

  // Com uma conta só, cada linha leva o saldo depois dela.
  const umaConta = contas.length === 1 && contas[0].tipo !== 'cartao' ? contas[0] : null;
  const saldoApos = umaConta ? saldosCorridos(umaConta) : null;
  $('lista').innerHTML = linhas.length
    ? linhas.map((l) => linhaHTML(l, ids, saldoApos)).join('')
    : `<li class="vazio">Nada ${busca || vista.categoria ? 'com estes filtros' : vista.modo === 'mes' ? `em ${nomeDoMes(vista.mes)}` : 'neste período'}.</li>`;
  pintarTotais(linhas, ids);
  guardarVista();
}

/** O texto em que a busca procura: categoria, detalhe, contas, observação, valor. */
function textoDaLinha(l) {
  return [
    nomeDaCategoria(app, l.categoriaId),
    app.detalhes?.[l.detalheId]?.nome,
    app.contas[l.contaId]?.nome,
    app.contas[l.contaDestinoId]?.nome,
    l.observacao,
    l.textoBanco,
    formatar(l.valor),
    ...(l.etiquetas ?? []).map((t) => app.etiquetas?.[t]?.nome),
  ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
}

function pintarFiltros() {
  const comContas = ABAS.filter((a) => contasDaAba(a).length);
  $('filtro-area').innerHTML =
    '<option value="todas">todas as áreas</option>' +
    comContas.map((a) => `<option value="${a.id}"${a.id === vista.area ? ' selected' : ''}>${escapar(a.titulo)}</option>`).join('');
  const area = ABAS.find((a) => a.id === vista.area);
  const contas = Object.values(app.contas)
    .filter((c) => !area || area.tipos.includes(c.tipo))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  if (vista.conta !== 'todas' && !contas.some((c) => c.id === vista.conta)) vista.conta = 'todas';
  $('filtro-conta').innerHTML =
    '<option value="todas">todas as contas</option>' +
    contas.map((c) => `<option value="${escapar(c.id)}"${c.id === vista.conta ? ' selected' : ''}>${escapar(c.nome)}</option>`).join('');
  const categorias = Object.values(app.categorias).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  $('filtro-categoria').innerHTML =
    '<option value="">todas as categorias</option>' +
    categorias.map((c) => `<option value="${escapar(c.id)}"${c.id === vista.categoria ? ' selected' : ''}>${escapar(c.nome)}</option>`).join('');
  if ($('filtro-busca').value !== vista.busca) $('filtro-busca').value = vista.busca;
}

/**
 * As contas de uma aba. Cartão arquivado continua aparecendo enquanto tiver
 * fatura a pagar: a última fatura do cartão velho ainda é dívida.
 */
function contasDaAba(aba) {
  return Object.values(app.contas)
    .filter((c) => aba.tipos.includes(c.tipo))
    .filter((c) => !c.arquivada || (c.tipo === 'cartao' && (resumoDoCartao(app, c.id)?.divida ?? 0) > 0))
    .sort(porOrdemDaConta);
}

const NOME_DA_AREA = {
  caixa: 'Contas', cartoes: 'Cartões', folha: 'Renda', investimentos: 'Investimentos', dividas: 'Dívidas',
};

const NOVO_DA_AREA = {
  caixa: 'Nova conta', cartoes: 'Novo cartão', folha: 'Nova fonte de renda',
  investimentos: 'Novo investimento', dividas: 'Novo empréstimo',
};

/** O "+" tracejado no fim das abas: cria uma conta (ou cartão, fonte, investimento, empréstimo). */
const botaoNovaConta = () =>
  `<button type="button" class="nova-conta" data-nova-conta title="${escapar(NOVO_DA_AREA[AREA] ?? 'Nova conta')}" aria-label="${escapar(NOVO_DA_AREA[AREA] ?? 'Nova conta')}">${ICONES.mais}</button>`;

/**
 * As abas das contas (design: ênfase nelas, ícone redondo de cada uma, a ativa
 * maior) e, no fim, o "+" de nova conta. "Geral" só com duas ou mais; com uma
 * só, ela é a aba — ainda assim ao lado do "+".
 */
function pintarSubabas(contas) {
  const unica = contas.length === 1;
  // A primeira aba leva o nome da área (Contas, Cartões…) e mostra todas juntas;
  // com uma conta só, ela própria é a aba.
  const abas = unica ? contas : [{ id: 'todas', nome: NOME_DA_AREA[AREA] ?? 'Todas' }, ...contas];
  $('subabas').hidden = false;
  abasNoTopo(true);
  $('subabas').innerHTML = abas
    .map((c) => {
      const ativa = unica || c.id === vista.conta;
      const icone = c.id === 'todas'
        ? `<span class="ic ic-geral">${ICONES.geral}</span>`
        : bolinhaDaConta(c);
      return `<button type="button" class="aba-conta" data-conta="${escapar(c.id)}" aria-pressed="${ativa}">${icone}<span class="nome">${escapar(c.nome)}</span></button>`;
    })
    .join('') + botaoNovaConta();
}

function pintarPeriodo() {
  const porMes = modoDaTela() === 'mes';
  $('p-modo').hidden = PAGINA === 'cartoes';
  $('p-antes').hidden = !porMes;
  $('p-depois').hidden = !porMes;
  $('p-rotulo').hidden = !porMes;
  $('p-rotulo').textContent = nomeDoMes(vista.mes);
  $('p-intervalo').hidden = porMes;
  $('p-modo').textContent = porMes ? 'período' : 'mês a mês';
  $('p-modo').setAttribute('aria-expanded', String(!porMes));
  $('p-de').value = vista.de;
  $('p-ate').value = vista.ate;
}

// ── resumos ───────────────────────────────────────────────────────────────

/**
 * Em caixa: a faixa segue o mês da tela (08 §4.2, D31). Mês passado é um
 * extrato; o atual, o saldo real e o previsto abertos em linhas — o número
 * sozinho não é crível (08 §6) — com o "previsto com a renda" ao lado; mês
 * seguinte, só o que entra e sai nele. No intervalo de datas, como o atual.
 *
 * Uma conta: o bloco dela. Geral (várias): só a soma — a conta específica se
 * vê na aba dela (pedido dele, 03/10/2026).
 */
function pintarResumoDeCaixa(contas) {
  const atual = hoje().slice(0, 7);
  const mes = modoDaTela() === 'intervalo' ? atual : vista.mes;
  const ids = new Set(contas.map((c) => c.id));
  const nome = contas.length === 1 ? contas[0].nome : 'geral';
  const conta = contas.length === 1 ? contas[0] : null;
  if (mes !== atual) {
    const bloco = mes < atual
      ? blocoDoExtrato(nome, extratoDoMes(app, ids, mes), mes, conta)
      : blocoDoMesSeguinte(nome, resultadoDoMes(app, ids, mes), mes);
    $('resumo').innerHTML = `<div class="blocos">${bloco}</div>`;
    return;
  }
  const aEntrar = aEntrarNoMes(app, ids);
  // Só no mês corrente (é o único que chega aqui): cartões pagos por estas contas, com cofrinho.
  const comProvisao = Object.values(app.contas)
    .filter((c) => c.tipo === 'cartao' && temCofrinho(c) && ids.has(c.pagaCom))
    .map((c) => ({ c, prov: provisaoDoCartao(app, c.id) }))
    .filter((x) => x.prov);
  const faixasDeCartao = comProvisao.map((x) => faixaDoCartao(x.c, x.prov, comProvisao.length > 1));
  // O que entrou e saiu neste mês, que antes ficava solto no cabeçalho da lista.
  const extrato = extratoDoMes(app, ids, atual);
  // No Geral, a transferência entre duas destas contas não sai do conjunto.
  const doConjunto = contas.length > 1 ? ids : null;
  const previstos = contas.map((c) => ({ conta: c, p: saldoPrevisto(app, c.id, hoje(), doConjunto) }));
  const blocos = previstos.length === 1 ? [blocoDeCaixa(previstos[0].conta.nome, previstos[0].p, false, previstos[0].conta, aEntrar, faixasDeCartao, extrato)] : [];

  if (previstos.length > 1) {
    const soma = {
      real: previstos.reduce((t, x) => t + x.p.real, 0),
      faturas: [{ cartao: { nome: 'faturas' }, valor: previstos.reduce((t, x) => t + x.p.faturas.reduce((u, f) => u + f.valor, 0), 0) }]
        .filter((f) => f.valor > 0),
      aSair: previstos.reduce((t, x) => t + x.p.aSair, 0),
      partes: {
        recorrentes: previstos.reduce((t, x) => t + x.p.partes.recorrentes, 0),
        agendados: previstos.reduce((t, x) => t + x.p.partes.agendados, 0),
        cartoes: previstos.reduce((m, x) => {
          for (const [id, v] of x.p.partes.cartoes) m.set(id, (m.get(id) ?? 0) + v);
          return m;
        }, new Map()),
      },
      ate: previstos[0].p.ate,
      estimado: previstos.some((x) => x.p.estimado),
      previsto: previstos.reduce((t, x) => t + x.p.previsto, 0),
      proximas: previstos.flatMap((x) => x.p.proximas),
      totalProximas: previstos.reduce((t, x) => t + x.p.totalProximas, 0),
      provisionado: previstos.reduce((t, x) => t + x.p.provisionado, 0),
    };
    blocos.unshift(blocoDeCaixa('geral', soma, true, null, aEntrar, faixasDeCartao, extrato));
  }
  $('resumo').innerHTML = `<div class="blocos">${blocos.join('')}</div>`;
}

/**
 * Um número em linha, para as frases pequenas do card ("fatura −R$ 4.000"). Com
 * `para`, o valor é link para a tela onde ele mora.
 */
function numeroEmLinha(rotulo, valor, para = null, classe = '') {
  const miolo = para && app?.contas?.[para.conta]
    ? `<button type="button" class="elo-numero" data-ir-conta="${escapar(para.conta)}"${para.mes ? ` data-ir-mes="${escapar(para.mes)}"` : ''} title="Abrir ${escapar(app.contas[para.conta].nome)}">${escapar(valor)}</button>`
    : `<strong>${escapar(valor)}</strong>`;
  return `<span class="em-linha ${classe}"><span class="rot">${escapar(rotulo)}</span> ${miolo}</span>`;
}

/**
 * O card da conta de caixa no mês corrente (pedido dele, 06/10/2026): o saldo
 * real grande e o previsto menor, juntos; em letra pequena de onde vem o previsto
 * (o que sai, o que ainda entra); o movimento do mês; e, por último, o cartão que
 * esta conta paga — a fatura aberta e a barra da provisão.
 */
function blocoDeCaixa(nome, p, total = false, conta = null, aEntrar = null, faixasDeCartao = [], extrato = null) {
  const menos = (v, est = false) => `−${est ? '~' : ''}${formatar(v)}`;
  const entra = aEntrar?.total > 0 ? aEntrar : null;
  const partes = p.partes;

  // De onde vem o "a sair": a soma sozinha não é crível (08-telas §6).
  const aSair = [];
  for (const f of p.faturas) aSair.push(numeroEmLinha(`fatura ${f.cartao.nome}`, menos(f.valor), { conta: f.cartao.id, mes: vista.mes }));
  if (partes?.recorrentes > 0) aSair.push(numeroEmLinha('recorrentes', menos(partes.recorrentes, p.estimado)));
  for (const [cartaoId, valor] of partes?.cartoes ?? []) {
    aSair.push(numeroEmLinha(`recorrentes no ${app.contas[cartaoId]?.nome ?? 'cartão'}`, menos(valor, p.estimado), { conta: cartaoId, mes: vista.mes }));
  }
  if (partes?.agendados > 0) aSair.push(numeroEmLinha('agendados e vencidos', menos(partes.agendados)));

  // Cartão sem cofrinho: a próxima fatura e o saldo com ela separada.
  const proximas = (p.proximas ?? []).filter((x) => x.valor + x.recorrentes > 0 && !temCofrinho(app.contas[x.cartao.id]));
  const proximasTotal = proximas.reduce((t, x) => t + x.valor + x.recorrentes, 0);
  const faixasSemCofrinho = proximas.map((x) => `<div class="faixa-cartao">
      <div><div class="rotulo-numero">${escapar(x.cartao.nome)} · próxima fatura</div>
        <button type="button" class="valor-cartao elo-numero" data-ir-conta="${escapar(x.cartao.id)}" data-ir-mes="${escapar(x.vencimento?.slice(0, 7) ?? vista.mes)}">${menos(x.valor + x.recorrentes, x.estimado)}</button></div>
    </div>`);
  if (proximas.length) {
    const sp = p.previsto - proximasTotal;
    faixasSemCofrinho.push(`<div class="saldo-provisionado ${sp < 0 ? 'negativo' : ''}"><span class="rotulo-numero">saldo provisionado</span><strong>${sp < 0 ? '−' : ''}${formatar(Math.abs(sp))}</strong></div>`);
  }

  const temPrevisao = p.faturas.length || p.aSair > 0 || proximas.length || entra;
  const prev = p.previsto;
  const previstoHTML = temPrevisao
    ? `<div class="saldo-previsto ${prev < 0 ? 'negativo' : ''}">
        <span class="rotulo-numero">previsto até ${diaCurto(p.ate)}</span>
        <span class="valor-previsto">${prev < 0 ? '−' : ''}${p.estimado ? '~' : ''}${formatar(Math.abs(prev))}</span>
      </div>`
    : '';

  // O que ainda entra, e o previsto com isso: o alívio ao lado do aperto (D31).
  let aEntrarHTML = '';
  if (entra) {
    const itens = entra.liquidos.map((x) => numeroEmLinha(`salário ${x.folha.nome} · ${diaCurto(x.data)}`, `+${x.estimado ? '~' : ''}${formatar(x.valor)}`, { conta: x.folha.id, mes: x.data.slice(0, 7) }));
    if (entra.receitas > 0) itens.push(numeroEmLinha('receitas', `+${entra.estimado ? '~' : ''}${formatar(entra.receitas)}`));
    if (entra.chegam > 0) itens.push(numeroEmLinha('chega de outras contas', `+${formatar(entra.chegam)}`));
    const comRenda = p.previsto + entra.total;
    itens.push(numeroEmLinha('previsto com a renda', `${comRenda < 0 ? '−' : ''}${p.estimado || entra.estimado ? '~' : ''}${formatar(Math.abs(comRenda))}`, null, 'com-renda'));
    aEntrarHTML = `<p class="composicao"><span class="chave">ainda entra</span> ${itens.join('')}</p>`;
  }

  // Quem comprou no cartão de outra pessoa: o que ainda é dela repassar e o que
  // realmente sobra na conta (design/16).
  let repasse = '';
  if (conta?.titular) {
    const d = disponivelDe(app, conta.titular, (id) => saldoReal(app, id));
    if (d.aRepassar > 0) {
      repasse = `<p class="composicao"><span class="chave">repasse</span> ${numeroEmLinha('a repassar', menos(d.aRepassar))}${numeroEmLinha('disponível de verdade', `${d.disponivel < 0 ? '−' : ''}${formatar(Math.abs(d.disponivel))}`, null, d.disponivel < 0 ? '' : 'positivo')}</p>`;
    }
  }

  const movimento = extrato && !extrato.antesDoApp && (extrato.entrou || extrato.saiu)
    ? `<div class="movimento-mes">
        <span>entrou no mês <strong>+${formatar(extrato.entrou)}</strong></span>
        <span>saiu no mês <strong>−${formatar(extrato.saiu)}</strong></span>
      </div>`
    : '';

  // Conferir com o banco (ou a carteira) mora na própria conta (03 §8).
  const conferir = conta
    ? `<span class="fino conferencia">${conta.conferidaEm ? `conferida em ${diaCurto(conta.conferidaEm)}` : 'nunca conferida'} ·
        <button type="button" class="elo" data-conferir="${escapar(conta.id)}">conferir</button></span>`
    : '';
  const cartao = [...faixasDeCartao, ...faixasSemCofrinho].join('');
  return `<div class="bloco largo cartao-caixa ${total ? 'total' : ''}">
    <div class="cab-conta">
      <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(nome)}</p>
      ${conferir}
    </div>
    <div class="saldos-conta">
      <div class="saldo-real"><span class="rotulo-numero">saldo real</span><span class="valor-real">${p.real < 0 ? '−' : ''}${formatar(Math.abs(p.real))}</span></div>
      ${previstoHTML}
    </div>
    ${aSair.length ? `<p class="composicao"><span class="chave">a sair até ${diaCurto(p.ate)}</span> ${aSair.join('')}</p>` : ''}
    ${aEntrarHTML}
    ${repasse}
    ${movimento}
    ${cartao ? `<div class="faixa-dos-cartoes">${cartao}</div>` : ''}
  </div>`;
}

/**
 * O cartão que esta conta paga, na linha de baixo do card: a fatura aberta
 * (o valor já lançado, link para Cartões) e a barra da provisão no cofrinho, com a
 * bolinha no valor real da fatura aberta (design/11 §9).
 */
function faixaDoCartao(cartao, p, comNome) {
  const til = p.estimado ? '~' : '';
  const reais = (c) => formatar(c).replace('R$ ', '');
  const pct = p.alvo > 0 ? Math.min(100, Math.max(0, (p.provisionado / p.alvo) * 100)) : 100;
  const aberta = resumoDoCartao(app, cartao.id)?.aberta;
  const mes = aberta?.vencimento?.slice(0, 7) ?? '';
  const real = aberta?.aPagar ?? 0;
  const posReal = p.alvo > 0 && real > 0 ? Math.min(100, (real / p.alvo) * 100) : null;
  const bolinha = posReal == null ? '' : `<span class="bolinha-fatura ${p.provisionado >= real ? 'coberta' : ''}" style="left:${posReal.toFixed(1)}%" tabindex="0" role="img"
        title="Fatura aberta: ${escapar(formatar(real))}${p.provisionado >= real ? ' — já provisionada' : ` — faltam ${escapar(formatar(real - p.provisionado))}`}"
        aria-label="Fatura aberta: ${escapar(formatar(real))}"></span>`;
  const valorDaFatura = aberta
    ? `<button type="button" class="valor-cartao elo-numero" data-ir-conta="${escapar(cartao.id)}"${mes ? ` data-ir-mes="${mes}"` : ''} title="Vence ${escapar(diaCurto(aberta.vencimento))}. O que já foi lançado nela.">${formatar(aberta.aPagar)}</button>`
    : '<span class="valor-cartao">—</span>';
  return `<div class="faixa-cartao">
      <div>
        <div class="rotulo-numero">${escapar(comNome ? `${cartao.nome} · fatura aberta` : 'fatura aberta')}</div>
        ${valorDaFatura}
      </div>
      <div class="provisao-barra">
        <div class="rotulo-numero provisao-rotulo"><span>provisão</span><span class="valor-provisao">${reais(p.provisionado)} de ${til}${reais(p.alvo)}</span></div>
        <div class="trilho"><i style="width:${pct.toFixed(1)}%"></i>${bolinha}</div>
      </div>
    </div>`;
}

/** O número que fecha a faixa, em destaque — vermelho quando negativo. */
function destaqueDaFaixa(rotulo, valor, estimado = false, classe = '') {
  const texto = `${valor < 0 ? '−' : ''}${estimado ? '~' : ''}${formatar(Math.abs(valor))}`;
  return `<div class="numero-faixa previsto-faixa ${classe} ${valor < 0 ? 'negativo' : ''}">
      <span class="rotulo-numero">${escapar(rotulo)}</span>
      <span class="valor-numero">${escapar(texto)}</span>
    </div>`;
}

/** Mês passado: um extrato — começo, entrou, saiu, e o saldo no fim (D31). */
function blocoDoExtrato(nome, x, mes, conta) {
  const de = `${mes}-01`;
  const numeros = x.antesDoApp
    ? [`<p class="fino">A conta entrou no app em ${escapar(dataCheia(x.antesDoApp))}: não há extrato de ${escapar(nomeDoMes(mes))}.</p>`]
    : [
        numeroDaFaixa(`saldo em ${diaCurto(de)}`, formatar(x.inicio)),
        numeroDaFaixa('entrou', `+${formatar(x.entrou)}`),
        numeroDaFaixa('saiu', `−${formatar(x.saiu)}`),
        destaqueDaFaixa(`saldo em ${diaCurto(fimDoMes(de))}`, x.fim),
      ];
  return `<div class="bloco largo ${conta ? '' : 'total'}">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(`${nome} · ${nomeDoMes(mes).split(' ')[0]}`)}</p>
    <div class="numeros-renda numeros-caixa">${numeros.join('')}</div>
  </div>`;
}

/** Mês seguinte: sem o saldo de hoje, só o que entra e sai nele (D31). */
function blocoDoMesSeguinte(nome, r, mes) {
  const menos = (v, est = false) => `−${est ? '~' : ''}${formatar(v)}`;
  const { entra, sai } = r;
  const mesNome = nomeDoMes(mes).split(' ')[0];
  const nada = !entra.total && !sai.total;
  if (nada) {
    return `<div class="bloco largo">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(`${nome} · ${mesNome}`)}</p>
    <div class="numeros-renda numeros-caixa"><p class="fino">Nada previsto para ${escapar(nomeDoMes(mes))} ainda.</p></div>
  </div>`;
  }
  // Menos números, uma conta que fecha de cabeça (pedido dele, 05/10/2026):
  // receitas, a fatura que vence no mês, as outras despesas, o total e o resultado.
  const numeros = [];
  const origem = [
    ...entra.liquidos.map((x) => `salário ${x.folha.nome}: +${formatar(x.valor)}`),
    entra.receitas > 0 ? `receitas: +${formatar(entra.receitas)}` : '',
    entra.chegam > 0 ? `chega de outras contas: +${formatar(entra.chegam)}` : '',
  ].filter(Boolean).join(' · ');
  numeros.push(numeroDaFaixa('receitas', `+${entra.estimado ? '~' : ''}${formatar(entra.total)}`, null, origem));

  // A fatura que vence no mês, com as recorrentes do cartão já somadas.
  const faturas = sai.faturas;
  if (faturas.length) {
    const total = faturas.reduce((t, f) => t + f.valor + f.recorrentes, 0);
    const vence = faturas.length === 1 && faturas[0].vencimento ? ` · vence ${diaCurto(faturas[0].vencimento)}` : '';
    const partes = faturas.map((f) => `${f.cartao.nome}${f.vencimento ? ` (vence ${diaCurto(f.vencimento)})` : ''}: ${formatar(f.valor + f.recorrentes)}`).join(' · ');
    const para = { conta: faturas[0].cartao.id, mes: faturas[0].vencimento?.slice(0, 7) ?? mes };
    numeros.push(numeroDaFaixa(`fatura prevista${vence}`, menos(total, faturas.some((f) => f.estimado)), para, partes));
  }
  const despesas = sai.recorrentes + sai.parcelas + sai.agendados;
  if (despesas > 0) {
    const partes = [
      sai.recorrentes > 0 ? `recorrentes: ${formatar(sai.recorrentes)}` : '',
      sai.parcelas > 0 ? `parcelas de dívida: ${formatar(sai.parcelas)}` : '',
      sai.agendados > 0 ? `agendados: ${formatar(sai.agendados)}` : '',
    ].filter(Boolean).join(' · ');
    numeros.push(numeroDaFaixa('despesas previstas', menos(despesas, sai.estimadoDespesas), null, partes));
  }
  numeros.push(numeroDaFaixa('total de despesas', menos(sai.total, sai.estimado)));
  numeros.push(destaqueDaFaixa('resultado previsto', r.resultado, r.estimado));
  return `<div class="bloco largo">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(`${nome} · ${mesNome}`)}</p>
    <div class="numeros-renda numeros-caixa">${numeros.join('')}</div>
  </div>`;
}

const linhaDeResumo = (rotulo, valorHTML, classe = '') =>
  `<div class="linha-resumo ${classe}"><dt>${escapar(rotulo)}</dt><dd>${valorHTML}</dd></div>`;

/** Cartões: nunca "saldo" — fatura aberta, fatura fechada e limite livre. */
function pintarResumoDeCartoes(cartoes) {
  $('resumo').innerHTML = `<div class="blocos">${blocoDosCartoes(cartoes)}</div>`;
}

/**
 * A fatura que vence no mês da tela: situação, total, pago e o que ainda vai
 * entrar nela (as recorrentes do cartão que ninguém lançou).
 */
function faturaDoMes(c) {
  const f = faturasNoPeriodo(app, c.id, `${vista.mes}-01`, fimDoMes(`${vista.mes}-01`))[0];
  if (!f) return null;
  const aVir = f.projetadas.reduce((t, o) => t + sinalDeSaida(o), 0);
  return { ...f, previsto0: f.total + aVir };
}

/**
 * O card de UM cartão, enxuto (pedido dele, 06/10/2026): a fatura em destaque
 * com o botão de pagar; o limite numa linha com barra; o cofrinho numa linha com
 * barra e, embaixo em letra pequena, o que falta e o que ainda vão repassar.
 * Detalhes (limite usado + previstas) só no mouse.
 */
function blocoLeveDoCartao(c) {
  const f = faturaDoMes(c);
  const mesNome = nomeDoMes(vista.mes).split(' ')[0];
  const pagadora = app.contas[c.pagaCom];
  const cab = `<div class="cab-cartao">
      <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(c.nome)}</p>
      <span class="fino">${pagadora ? `paga com ${escapar(pagadora.nome)}` : `<button type="button" class="elo" data-editar-conta="${escapar(c.id)}">defina o “paga com”</button>`}</span>
    </div>`;

  // A fatura do mês da tela, o estimado grande e o já lançado ao lado.
  let fatura;
  if (!f) {
    fatura = `<div class="fatura-destaque"><div><div class="rotulo-numero">fatura de ${escapar(mesNome)}</div><div class="valor-grande">sem compras</div></div></div>`;
  } else {
    const situacao = f.situacao === 'aberta' ? 'aberta' : f.situacao === 'futura' ? 'por vir' : f.aPagar > 0 ? (f.vencimento < hoje() ? 'vencida' : 'fechada') : 'paga';
    const til = f.estimado ? '~' : '';
    const detalhes = [`fecha ${diaCurto(f.fechamento)} · vence ${diaCurto(f.vencimento)}`];
    if (f.previsto0 !== f.total) detalhes.push(`já lançado ${formatar(f.total)}`);
    if (f.situacao === 'fechada' && f.pago) detalhes.push(`pago ${formatar(f.pago)}${f.aPagar > 0 ? ` · falta ${formatar(f.aPagar)}` : ''}`);
    const paga = f.aPagar > 0 && f.situacao !== 'futura'
      ? `<button type="button" class="principal" data-pagar="${escapar(c.id)}" data-valor="${f.aPagar}">Pagar fatura</button>` : '';
    fatura = `<div class="fatura-destaque ${situacao === 'vencida' ? 'vencida' : ''}">
        <div>
          <div class="rotulo-numero">fatura de ${escapar(mesNome)} · ${situacao}</div>
          <div class="valor-grande">${til}${formatar(f.previsto0)}</div>
          <div class="fino">${detalhes.join(' · ')}</div>
        </div>
        ${paga}
      </div>`;
  }

  // O limite, numa linha e uma barra.
  const usado = resumoDoCartao(app, c.id)?.divida ?? 0;
  const limite = c.limite ?? 0;
  const pctLimite = limite > 0 ? Math.min(100, Math.max(0, (usado / limite) * 100)) : 0;
  const limiteHTML = limite > 0
    ? `<div class="linha-barra">
        <div class="rotulo-barra"><span>limite</span><span>${formatar(usado)} de ${formatar(limite)} · livre ${formatar(limite - usado)}</span></div>
        <div class="barra-limite ${pctLimite >= 90 ? 'alto' : ''}" role="img" aria-label="${Math.round(pctLimite)}% do limite usado"><i style="width:${pctLimite.toFixed(1)}%"></i></div>
      </div>`
    : `<div class="linha-barra"><div class="rotulo-barra"><span>limite usado</span><span>${formatar(usado)}</span></div></div>`;

  // O cofrinho (design/11 §9) e o que ainda vão repassar ao dono do cartão (design/16).
  const receber = c.titular ? aReceber(app, c.titular) : [];
  const deveRepassar = receber.map((x) => `${escapar(app.pessoas?.[x.pessoa]?.nome ?? 'alguém')} ainda deve repassar ${formatar(x.aRepassar)}`).join(' · ');
  const p = provisaoDoCartao(app, c.id);
  let cofrinho = '';
  if (p) {
    const til = p.estimado ? '~' : '';
    const pct = p.alvo > 0 ? Math.min(100, Math.max(0, (p.provisionado / p.alvo) * 100)) : 100;
    const composicao = `limite usado ${formatar(p.limiteUsado)}${p.previstas ? ` + previstas ${til}${formatar(p.previstas)}` : ''}`;
    const miudo = [`${p.falta > 0 ? 'falta' : 'sobra'} ${til}${formatar(Math.abs(p.falta))}`, deveRepassar].filter(Boolean).join(' · ');
    cofrinho = `<div class="linha-barra provisao-cartao">
        <div class="rotulo-barra"><span title="${escapar(p.cofrinho.nome)}">cofrinho</span><span title="${escapar(composicao)}">${formatar(p.provisionado)} de ${til}${formatar(p.alvo)}</span></div>
        <div class="barra-limite barra-provisao" role="img" aria-label="${Math.round(pct)}% provisionado"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="fino">${miudo}</div>
      </div>`;
  } else if (deveRepassar) {
    cofrinho = `<div class="linha-barra"><div class="fino">${deveRepassar}</div></div>`;
  }

  return `<div class="bloco largo cartao-resumo cartao-leve">
    ${cab}
    ${fatura}
    ${limiteHTML}
    ${cofrinho}
  </div>`;
}

/**
 * O cartão na largura toda, em duas linhas (pedido dele, 03/10/2026): em cima
 * o limite, que não muda com o mês — usado de total, com uma barra discreta;
 * embaixo a fatura que se está olhando. Com vários cartões, a aba Geral soma.
 */
function blocoDosCartoes(cartoes) {
  const comCiclo = cartoes.filter((c) => temCiclo(c));
  const semCiclo = cartoes.filter((c) => !temCiclo(c));
  const um = cartoes.length === 1 ? cartoes[0] : null;
  const nome = um ? um.nome : 'geral';

  if (um && !comCiclo.length) {
    return `<div class="bloco largo">
      <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(um.nome)}</p>
      <p class="aviso-bloco">Sem dia de fechamento e de vencimento, o app não sabe a qual
        fatura cada compra pertence. <button type="button" class="elo" data-editar-conta="${escapar(um.id)}">Defina o ciclo</button>.</p>
      <div class="numeros-renda">${numeroDaFaixa('em aberto', formatar(-saldoReal(app, um.id)))}</div>
    </div>`;
  }

  if (um) return blocoLeveDoCartao(um);

  // Linha 1: o limite.
  let usado = 0;
  let limite = 0;
  for (const c of comCiclo) {
    usado += resumoDoCartao(app, c.id)?.divida ?? 0;
    limite += c.limite ?? 0;
  }
  const temLimite = comCiclo.some((c) => c.limite);
  const pct = temLimite && limite > 0 ? Math.min(100, Math.max(0, (usado / limite) * 100)) : 0;
  const linhaLimite = temLimite
    ? `<div class="limite-cartao">
        <div class="numeros-renda">
          ${numeroDaFaixa('limite usado', formatar(usado))}
          ${numeroDaFaixa('limite total', formatar(limite))}
          ${numeroDaFaixa('limite livre', formatar(limite - usado))}
        </div>
        <div class="barra-limite ${pct >= 90 ? 'alto' : ''}" role="img" aria-label="${Math.round(pct)}% do limite usado"><i style="width:${pct.toFixed(1)}%"></i></div>
      </div>`
    : `<div class="numeros-renda">${numeroDaFaixa('limite usado', formatar(usado))}</div>`;

  // Linha 2: a fatura do mês da tela.
  const fs = comCiclo.map((c) => ({ c, f: faturaDoMes(c) })).filter((x) => x.f);
  const mesNome = nomeDoMes(vista.mes).split(' ')[0];
  let linhaFatura;
  if (!fs.length) {
    linhaFatura = `<div class="numeros-renda">${numeroDaFaixa(`fatura de ${mesNome}`, 'sem compras')}</div>`;
  } else {
    // O total é o estimado (com as recorrentes que ainda vão cair); o já
    // lançado aparece ao lado — o mesmo número na lista de baixo.
    const lancado = fs.reduce((t, x) => t + x.f.total, 0);
    const total = fs.reduce((t, x) => t + x.f.previsto0, 0);
    const pago = fs.reduce((t, x) => t + x.f.pago, 0);
    const aPagar = fs.reduce((t, x) => t + x.f.aPagar, 0);
    const f = fs[0].f;
    const situacao = um
      ? f.situacao === 'aberta' ? 'aberta' : f.situacao === 'futura' ? 'por vir' : aPagar > 0 ? (f.vencimento < hoje() ? 'vencida' : 'fechada') : 'paga'
      : `${fs.length} fatura${fs.length > 1 ? 's' : ''}`;
    const partes = [numeroDaFaixa(`fatura de ${mesNome}`, situacao)];
    if (um) partes.push(numeroDaFaixa('fecha · vence', `${diaCurto(f.fechamento)} · ${diaCurto(f.vencimento)}`));
    const estimado = fs.some((x) => x.f.estimado);
    partes.push(numeroDaFaixa('total', `${estimado ? '~' : ''}${formatar(total)}`));
    if (total !== lancado) partes.push(numeroDaFaixa('já lançado', formatar(lancado)));
    if (f.situacao === 'fechada' || !um) {
      partes.push(numeroDaFaixa('pago', formatar(pago)));
      if (aPagar > 0 && pago > 0) partes.push(numeroDaFaixa('falta', formatar(aPagar)));
    }
    linhaFatura = `<div class="numeros-renda fatura-do-mes ${situacao === 'vencida' ? 'vencida' : ''}">${partes.join('')}</div>`;
  }

  // O pé: quem paga e o botão — só com um cartão, e só se há o que pagar.
  let pe = '';
  if (um) {
    const pagadora = app.contas[um.pagaCom];
    const f = fs[0]?.f;
    const aPagar = f?.aPagar ?? 0;
    pe = `<div class="pe-bloco">
      <span class="fino">${pagadora ? `paga com ${escapar(pagadora.nome)}` : `sem conta que paga — <button type="button" class="elo" data-editar-conta="${escapar(um.id)}">defina o “paga com”</button>`}</span>
      ${aPagar > 0 && f.situacao !== 'futura' ? `<button type="button" class="principal" data-pagar="${escapar(um.id)}" data-valor="${aPagar}">Pagar fatura</button>` : ''}
    </div>`;
  }
  const aviso = semCiclo.length && !um
    ? `<p class="aviso-bloco">${semCiclo.map((c) => escapar(c.nome)).join(', ')} sem ciclo: fora da soma das faturas.</p>`
    : '';

  return `<div class="bloco largo cartao-resumo">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(nome)}</p>
    ${linhaLimite}
    ${linhaFatura}
    ${aviso}
    ${pe}
  </div>`;
}

/**
 * O holerite do mês que está na tela (design/10 §2): lançar, se falta; dizer
 * que está lançado, se não falta nada.
 */
function peDaFolha(c) {
  const mes = vista.mes;
  const faltam = linhasDoHolerite(app, c.id, mes).filter((l) => !l.automatico).length;
  // A parcela do consignado cai sozinha na folha: ela não é o holerite. Só o
  // que foi lançado à mão conta, e "lançado" exige a folha fechada em zero.
  const lancados = lancadosNoMes(app, c.id, mes).filter((l) => !l.automatico).length;
  const nome = nomeDoMes(mes).split(' ')[0];
  const aberta = saldoReal(app, c.id) !== 0;
  const feito = !faltam && lancados && !aberta;
  // Lançado, o rodapé é só a frase (pedido dele, 03/10/2026).
  if (feito) return `<div class="pe-bloco"><span class="fino">contracheque de ${escapar(nome)} lançado</span></div>`;
  const situacaoDaFolha = faltam
    ? `${faltam} linha${faltam > 1 ? 's' : ''} prevista${faltam > 1 ? 's' : ''}`
    : aberta ? 'a folha não fechou' : 'sem linhas previstas';
  return `<div class="pe-bloco">
    <span class="fino">${situacaoDaFolha}</span>
    <button type="button" class="principal" data-holerite="${escapar(c.id)}">Lançar contracheque de ${escapar(nome)}</button>
  </div>`;
}

// ── dívidas: um cartão por contrato (design/10 §4.3 e §4.4) ────────────────
//
// A tela de Dívidas não lança nem transfere: a parcela cai sozinha na conta
// que paga, e os movimentos moram lá. Aqui é inclusão, análise, amortização e
// a foto do banco.

const pct = (taxa) => `${(taxa * 100).toFixed(2).replace('.', ',')}% ao mês`;
const mesAno = (dia) => `${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

// O que está aberto em cada cartão: o cronograma, e o contrato sendo amortizado.
const cronogramasAbertos = new Set();
let amortizando = null;

function pintarDividas(contas) {
  for (const parte of ['subabas', 'periodo', 'parte-lista', 'filtros']) $(parte).hidden = true;
  // Em Dívidas não há uma aba por empréstimo: só o nome da área e o "+" de novo empréstimo.
  $('subabas').hidden = false;
  abasNoTopo(true);
  $('subabas').innerHTML = `<button type="button" class="aba-conta" data-conta="todas" aria-pressed="true"><span class="ic ic-geral">${ICONES.geral}</span><span class="nome">${NOME_DA_AREA.dividas}</span></button>` + botaoNovaConta();
  const arquivadas = Object.values(app.contas).filter((c) => c.tipo === 'divida' && c.arquivada);
  if (!contas.length && !arquivadas.length) {
    $('resumo').innerHTML = `<p class="vazio">${escapar(VAZIO_DA_AREA.dividas)}</p>`;
    return;
  }

  // O total é uma faixa na largura da tela, não mais um cartão na grade: com
  // três empréstimos ele desalinhava a primeira linha, e com um só repetiria
  // o próprio cartão — então só aparece a partir de dois.
  let faixa = '';
  if (contas.length > 1) {
    const total = contas.reduce((t, c) => t + (saldoDevedor(app, c.id) ?? -saldoReal(app, c.id)), 0);
    const parcelas = contas.reduce((t, c) => {
      const s = situacao(app, c.id);
      return t + (s?.restantes ? s.valorParcela : 0);
    }, 0);
    const estimado = contas.some((c) => situacao(app, c.id)?.estimado);
    faixa = `<div class="faixa-dividas">
      ${numeroDaFaixa('saldo devedor somado', `${estimado ? '~' : ''}${formatar(total)}`)}
      ${numeroDaFaixa('parcelas por mês', formatar(parcelas))}
      ${numeroDaFaixa('empréstimos', String(contas.length))}
    </div>`;
  }

  const blocos = contas.map(blocoDeDivida);
  if (arquivadas.length) {
    blocos.push(`<div class="bloco arquivadas-divida">
      <p class="nome-bloco">quitados e arquivados</p>
      <p class="fino">${arquivadas.map((c) => `<button type="button" class="elo" data-corrigir-divida="${escapar(c.id)}">${escapar(c.nome)}</button>`).join(' · ')}</p>
    </div>`);
  }
  $('resumo').innerHTML = `${faixa}<div class="blocos">${blocos.join('')}</div>`;
  guardarVista();
}

/**
 * Um número da faixa. Com `para` ({ conta, mes }), o valor vira um link para a
 * tela onde ele mora, no mesmo período (pedido dele, 05/10/2026).
 */
const numeroDaFaixa = (rotulo, valor, para = null, titulo = '') => {
  const texto = escapar(valor);
  const miolo = para && app?.contas?.[para.conta]
    ? `<button type="button" class="valor-numero elo-numero" data-ir-conta="${escapar(para.conta)}"${para.mes ? ` data-ir-mes="${escapar(para.mes)}"` : ''} title="Abrir ${escapar(app.contas[para.conta].nome)}">${texto}</button>`
    : `<span class="valor-numero">${texto}</span>`;
  return `<div class="numero-faixa ${para?.classe ?? ''}"${titulo ? ` title="${escapar(titulo)}"` : ''}><span class="rotulo-numero">${escapar(rotulo)}</span>${miolo}</div>`;
};

const dataCheia = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

// Os contratos com os detalhes abertos.
const detalhesAbertos = new Set();

/**
 * O cartão do contrato: só os quatro números que ele quer ver primeiro —
 * parcela, quantas, saldo devedor e a última parcela. O resto (juros, taxa,
 * cronograma, amortizar, foto, corrigir) mora em "detalhes".
 */
function blocoDeDivida(c) {
  const s = situacao(app, c.id);
  const pagadora = app.contas[c.pagaCom];
  const id = escapar(c.id);
  const cabeca = `<div class="cabeca-contrato">
      <span class="ponto-area" aria-hidden="true"></span>
      <span class="nome-contrato">${escapar(c.nome)}</span>
      ${pagadora ? `<span class="etiqueta-paga" title="As parcelas caem sozinhas nesta conta">${escapar(pagadora.nome)}</span>` : ''}
    </div>`;

  if (!s) {
    const devedor = saldoDevedor(app, c.id);
    return `<div class="bloco contrato">
      ${cabeca}
      <div class="numeros-contrato">
        ${numeroDaFaixa('saldo devedor', devedor != null ? formatar(devedor) : '—')}
      </div>
      <p class="aviso-bloco">Sem contrato: o app não sabe as parcelas.</p>
      <div class="acoes-contrato">
        <button type="button" class="elo" data-corrigir-divida="${id}">cadastrar contrato</button>
      </div>
    </div>`;
  }

  const aberto = detalhesAbertos.has(c.id);
  const cronogramaAberto = aberto && cronogramasAbertos.has(c.id);
  const emAmortizacao = aberto && amortizando === c.id && !s.quitada;
  const numeros = `<div class="numeros-contrato">
      ${numeroDaFaixa('parcela', s.restantes ? formatar(s.valorParcela) : '—')}
      ${numeroDaFaixa('parcelas', `${s.parcelasPagas} de ${s.parcelasTotal}`)}
      ${numeroDaFaixa('saldo devedor', `${s.estimado ? '~' : ''}${formatar(s.saldoDevedor)}`)}
      ${numeroDaFaixa('última parcela', s.termina ? dataCheia(s.termina) : '—')}
    </div>`;
  const semPagadora = pagadora
    ? ''
    : '<p class="aviso-bloco">Sem conta que paga: as parcelas não caem em lugar nenhum. Escolha em "corrigir".</p>';

  return `<div class="bloco contrato ${cronogramaAberto || emAmortizacao ? 'largo' : ''}">
    ${cabeca}
    ${numeros}
    ${semPagadora}
    ${aberto ? detalhesDoContrato(c, s) : ''}
    <div class="pe-contrato">
      <button type="button" class="elo" data-detalhes-divida="${id}" aria-expanded="${aberto}">${aberto ? 'fechar detalhes' : 'detalhes'}</button>
    </div>
    ${emAmortizacao ? painelDeAmortizacao(c, s) : ''}
    ${cronogramaAberto ? tabelaDoCronograma(c) : ''}
  </div>`;
}

/** O que fica atrás de "detalhes": a análise e as ações do contrato. */
function detalhesDoContrato(c, s) {
  const id = escapar(c.id);
  const base = s.foto
    ? s.amortizouDepois
      ? `foto de ${diaCurto(s.foto.data)} − amortização`
      : s.estimado ? `foto de ${diaCurto(s.foto.data)} + parcelas` : 'informado hoje'
    : 'estimado pelo contrato';
  const origem = s.origemTaxa === 'contratual'
    ? 'contratual'
    : s.origemTaxa === 'observada'
      ? `observada em ${s.mesesObservados} ${s.mesesObservados > 1 ? 'meses' : 'mês'}`
      : 'implícita no contrato';
  const linha = (rotulo, valor) => `<div class="linha-detalhe"><span>${escapar(rotulo)}</span><span>${escapar(valor)}</span></div>`;
  const cronogramaAberto = cronogramasAbertos.has(c.id);
  return `<div class="detalhes-contrato">
    ${linha('saldo devedor', base)}
    ${linha('falta pagar até o fim', formatar(s.somaRestante))}
    ${linha('total pago no empréstimo', formatar(s.totalDoContrato))}
    ${linha('juros no empréstimo inteiro', `${formatar(s.jurosDoContrato)} · ${(s.jurosDoContrato / s.contrato.valorTomado * 100).toFixed(1).replace('.', ',')}% do tomado`)}
    ${linha('juros que ainda vêm', `${s.estimado ? '~' : ''}${formatar(s.jurosFuturos)}`)}
    ${linha('juros já pagos', `${s.estimado ? '~' : ''}${formatar(s.jurosPagos)}`)}
    ${s.amortizado ? linha('amortizado', formatar(s.amortizado)) : ''}
    ${linha(`taxa ${origem}`, pct(s.taxa))}
    ${s.proxima ? linha('próxima parcela', dataCheia(s.proxima)) : ''}
    ${s.antesDoApp ? linha('pagas antes do app', String(s.antesDoApp)) : ''}
    <div class="acoes-contrato">
      <button type="button" class="elo" data-cronograma="${id}" aria-expanded="${cronogramaAberto}">${cronogramaAberto ? 'fechar cronograma' : 'cronograma'}</button>
      ${s.quitada ? '' : `<button type="button" class="elo" data-amortizar="${id}">amortizar</button>`}
      <span class="foto-divida" data-foto-de="${id}">
        <button type="button" class="elo" data-foto="${id}">saldo do banco</button>
      </span>
      <button type="button" class="elo" data-corrigir-divida="${id}">corrigir</button>
    </div>
  </div>`;
}

/**
 * O cronograma, parcela a parcela: juros, amortização e saldo depois. As
 * anteriores à inclusão aparecem — contam para a análise —, marcadas como de
 * antes do app. Fotos e amortizações entram na linha do tempo.
 */
function tabelaDoCronograma(c) {
  const cr = cronograma(app, c.id);
  if (!cr) return '';
  const dia = hoje();
  const proxima = cr.parcelas.find((p) => p.data > dia)?.k;
  const linhas = [];
  let m = 0;
  const marco = (x) => x.foto != null
    ? `<tr class="marco"><td></td><td>${escapar(diaCurto(x.data))}/${x.data.slice(2, 4)}</td><td colspan="3">saldo do banco</td><td>${formatar(x.foto)}</td></tr>`
    : `<tr class="marco"><td></td><td>${escapar(diaCurto(x.data))}/${x.data.slice(2, 4)}</td><td colspan="3">amortização de ${formatar(x.abate)}</td><td></td></tr>`;
  for (const p of cr.parcelas) {
    while (m < cr.marcos.length && cr.marcos[m].data < p.data) linhas.push(marco(cr.marcos[m++]));
    const situacaoDaParcela = p.antesDoApp ? 'antes' : p.data <= dia ? 'paga' : p.k === proxima ? 'proxima' : 'futura';
    const rotulo = { antes: 'antes do app', paga: 'paga', proxima: 'próxima', futura: '' }[situacaoDaParcela];
    linhas.push(`<tr class="${situacaoDaParcela}">
      <td>${p.k}</td>
      <td>${escapar(diaCurto(p.data))}/${p.data.slice(2, 4)}${rotulo ? ` <span class="selo">${rotulo}</span>` : ''}</td>
      <td>${formatar(p.valor)}</td>
      <td>${formatar(p.juros)}</td>
      <td>${formatar(p.amortizacao)}</td>
      <td>${formatar(p.saldoDepois)}</td>
    </tr>`);
  }
  while (m < cr.marcos.length) linhas.push(marco(cr.marcos[m++]));
  return `<div class="cronograma">
    <div class="rolagem"><table>
      <thead><tr><th>nº</th><th>vence</th><th>parcela</th><th>juros</th><th>amortiza</th><th>saldo depois</th></tr></thead>
      <tbody>${linhas.join('')}</tbody>
    </table></div>
    <p class="nota">Juros e saldo são estimados pelo contrato (Price, taxa ${escapar(pct(cr.taxa))}); a foto do banco corrige.</p>
  </div>`;
}

// ── amortizar: as duas saídas lado a lado (design/10 §4.4) ───────────────

function painelDeAmortizacao(c, s) {
  const caixa = Object.values(app.contas)
    .filter((o) => !o.arquivada && (o.tipo === 'corrente' || o.tipo === 'especie'))
    .sort((a, b) => (a.nome < b.nome ? -1 : 1));
  const padrao = caixa.some((o) => o.id === c.pagaCom) ? c.pagaCom : caixa[0]?.id;
  return `<div class="amortizar" data-amortizacao="${escapar(c.id)}">
    <p class="titulo-amortizar">Amortizar · saldo hoje ${dinheiroHTML(s.saldoDevedor, { estimado: s.estimado })}</p>
    <div class="campos-amortizar">
      <label>valor <input type="text" inputmode="decimal" data-am-valor autocomplete="off" placeholder="0,00"></label>
      <label>sai de <select data-am-origem>${caixa.map((o) => `<option value="${escapar(o.id)}" ${o.id === padrao ? 'selected' : ''}>${escapar(o.nome)}</option>`).join('')}</select></label>
      <label>em <input type="date" data-am-data value="${hoje()}"></label>
    </div>
    <div class="opcoes-amortizar" data-am-opcoes><p class="nota">Digite o valor: o app mostra as duas opções que o banco oferece.</p></div>
    <p class="pe-amortizar"><button type="button" class="elo" data-am-cancelar>cancelar</button></p>
  </div>`;
}

function lerAmortizacao(painel) {
  return {
    dividaId: painel.dataset.amortizacao,
    valor: Math.abs(deTexto(painel.querySelector('[data-am-valor]').value)),
    origemId: painel.querySelector('[data-am-origem]').value,
    data: painel.querySelector('[data-am-data]').value || hoje(),
  };
}

function pintarOpcoesDeAmortizacao(painel) {
  const pedido = lerAmortizacao(painel);
  const lugar = painel.querySelector('[data-am-opcoes]');
  const sim = pedido.valor ? simularAmortizacao(app, pedido.dividaId, pedido.valor, pedido.data) : null;
  if (!sim) {
    lugar.innerHTML = '<p class="nota">Digite o valor: o app mostra as duas opções que o banco oferece.</p>';
    return;
  }
  if (!pedido.origemId) {
    lugar.innerHTML = '<p class="nota">Crie uma conta em Contas para dizer de onde sai o dinheiro.</p>';
    return;
  }
  if (sim.quita) {
    lugar.innerHTML = `<div class="opcao-amortizar">
      <strong>Quita o empréstimo</strong>
      <p>paga ${dinheiroHTML(sim.valor)}, o saldo de hoje</p>
      <p>economiza ~${dinheiroHTML(sim.economia)} de juros</p>
      <button type="button" class="principal" data-am-confirmar="prazo">quitar</button>
    </div>`;
    return;
  }
  const atual = situacao(app, pedido.dividaId, pedido.data);
  lugar.innerHTML = `
    <div class="opcao-amortizar">
      <strong>Reduzir prazo</strong>
      <p>a parcela continua ${dinheiroHTML(atual.valorParcela)}</p>
      <p>termina em ${mesAno(sim.prazo.termina)}${sim.prazo.mesesAMenos ? ` · ${sim.prazo.mesesAMenos} ${sim.prazo.mesesAMenos > 1 ? 'meses' : 'mês'} antes` : ''}</p>
      <p class="economia">economiza ~${dinheiroHTML(sim.prazo.economia)} de juros</p>
      <button type="button" class="principal" data-am-confirmar="prazo">foi assim</button>
    </div>
    <div class="opcao-amortizar">
      <strong>Reduzir parcela</strong>
      <p>a parcela cai para ${dinheiroHTML(sim.parcela.parcela)}</p>
      <p>termina igual, em ${mesAno(atual.termina)}</p>
      <p class="economia">economiza ~${dinheiroHTML(sim.parcela.economia)} de juros</p>
      <button type="button" class="principal" data-am-confirmar="parcela">foi assim</button>
    </div>`;
}

document.addEventListener('input', (e) => {
  const painel = e.target.closest?.('[data-amortizacao]');
  if (painel) pintarOpcoesDeAmortizacao(painel);
});
document.addEventListener('change', (e) => {
  const painel = e.target.closest?.('[data-amortizacao]');
  if (painel) pintarOpcoesDeAmortizacao(painel);
});

/** Investimentos, dívidas e folha: o saldo, e na folha o aviso do zero (D25). */
function pintarResumoDeSaldos(aba, contas) {
  if (contas.length > 1) {
    $('resumo').innerHTML = `<div class="blocos">${aba.id === 'folha' ? blocoDasFolhas(contas) : blocoDeTotal(aba, contas)}</div>`;
    return;
  }
  const blocos = contas.map((c) => {
    const saldo = saldoReal(app, c.id);
    // Na folha: "EBTTIFSP · Outubro" e bruto, líquido e saldo atual lado a
    // lado, na largura toda — como a faixa das dívidas (pedido dele).
    if (aba.id === 'folha') {
      const renda = rendaNoMes([c]);
      return `<div class="bloco largo">
        <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(`${c.nome} · ${nomeDoMes(vista.mes).split(' ')[0]}${renda.titulo}`)}</p>
        <div class="numeros-renda">${renda.numeros}${numeroDaFaixa('saldo atual', formatar(saldo))}</div>
        ${avisoDaFolha([c])}
        ${peDaFolha(c)}
      </div>`;
    }
    return `<div class="bloco">
      <p class="nome-bloco">${escapar(titulo)}</p>
      <dl>${linhaDeResumo('saldo', dinheiroHTML(saldo), saldo < 0 ? 'negativo' : '')}</dl>
    </div>`;
  });
  $('resumo').innerHTML = `<div class="blocos">${blocos.join('')}</div>`;
}

// ── investimentos (design/10 §3 e §3.6) ───────────────────────────────────

const pctTexto = (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const rendeuTexto = (v) => `${v >= 0 ? '+' : '−'}${formatar(Math.abs(v))}`;

/**
 * Uma conta: a faixa (valor atual, investido, rendeu e, na corretora, o caixa
 * parado) e os ativos por classe. Geral: a soma e a divisão por classe.
 */
function pintarInvestimentos(contas) {
  const resumos = contas.map((c) => resumoDaConta(app, c));
  // De quem é cada ativo, quando há envelopes (design/11 §5).
  const temEnvelopes = Object.keys(app.envelopes ?? {}).length > 0;
  const donos = temEnvelopes ? donosNoDia(app) : null;
  const linkEnvelopes = `<a class="elo" href="${enderecoDa('envelopes')}">${temEnvelopes ? 'envelopes' : 'separar em envelopes'}</a>`;
  if (resumos.length > 1) {
    $('resumo').innerHTML = `<div class="blocos">${blocoGeralDosInvestimentos(resumos, linkEnvelopes)}</div>`;
    desenharMesesDosInvestimentos(contas);
    return;
  }
  const r = resumos[0];
  const c = r.conta;
  const numeros = numerosDoMesInvestido([c.id], r.estimado);
  if (r.proprio && !r.semAtivos) numeros.push(numeroDaFaixa('caixa parado', formatar(r.caixa)));
  const dinheiro = r.proprio ? 'o dinheiro fica na própria conta' : `o dinheiro sai e volta de ${escapar(app.contas[c.caixaEm]?.nome ?? '—')}`;
  const valorDeHoje = r.semAtivos && r.proprio
    ? `<span class="foto-divida" data-foto-de="${escapar(c.id)}"><button type="button" class="elo" data-foto="${escapar(c.id)}">informar valor de hoje</button></span>`
    : '';
  $('resumo').innerHTML = `<div class="blocos"><div class="bloco largo investimento-resumo">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(c.nome)}</p>
    <div class="numeros-renda">${numeros.join('')}</div>
    ${desdeOInicio(r.investido, r.rendeu)}
    <div class="grafico-rel grafico-invest" id="g-invest"></div>
    ${r.semAtivos && donos ? `<p class="divisao-envelopes fino">${escapar(divisao(donos, c.id))}</p>` : ''}
    ${listaDeAtivos(r, donos)}
    <div class="pe-bloco">
      <span class="fino">${dinheiro}</span>
      <span class="acoes-investimento">${linkEnvelopes}${valorDeHoje}<button type="button" class="${r.semAtivos ? 'elo' : 'principal'}" data-novo-ativo="${escapar(c.id)}">novo ativo</button></span>
    </div>
  </div></div>`;
  desenharMesesDosInvestimentos(contas);
}

/**
 * O mês da tela nos investimentos (pedido dele, 05/10/2026): o saldo, o que
 * se aportou, o que se resgatou e o que rendeu naquele mês. O total investido
 * desde o início desce para uma linha miúda.
 */
function numerosDoMesInvestido(ids, estimado) {
  const m = mesDosInvestimentos(app, new Set(ids), vista.mes);
  const atual = vista.mes === hoje().slice(0, 7);
  const nome = nomeDoMes(vista.mes).split(' ')[0];
  const numeros = [
    numeroDaFaixa(atual ? 'saldo hoje' : `saldo em ${diaCurto(fimDoMes(`${vista.mes}-01`))}`, `${estimado && atual ? '~' : ''}${formatar(m.fim)}`),
    numeroDaFaixa(`aportado em ${nome}`, formatar(m.aportado)),
  ];
  if (m.resgatado) numeros.push(numeroDaFaixa(`resgatado em ${nome}`, formatar(m.resgatado)));
  if (m.proventosFora) numeros.push(numeroDaFaixa(`proventos pagos fora em ${nome}`, formatar(m.proventosFora)));
  numeros.push(numeroDaFaixa(`rendeu em ${nome}`, `${rendeuTexto(m.rendeu)}${m.inicio > 0 ? ` · ${pctTexto(m.rendeu / m.inicio)}` : ''}`));
  return numeros;
}

const desdeOInicio = (investido, rendeu) =>
  `<p class="nota-rel">Desde o início: investido ${formatar(investido)} · rendeu ${rendeuTexto(rendeu)}${investido ? ` (${pctTexto(rendeu / investido)})` : ''}.</p>`;

/**
 * Os 12 meses até o da tela, em áreas que acumulam (pedido dele, 05/10/2026):
 * embaixo o que foi aportado até ali, por cima o rendimento acumulado, e a
 * linha é o saldo — o mesmo desenho da evolução dos envelopes.
 */
function desenharMesesDosInvestimentos(contas) {
  const raiz = $('g-invest');
  if (!raiz) return;
  const ids = new Set(contas.map((c) => c.id));
  const meses = [];
  for (let i = 11; i >= 0; i -= 1) meses.push(somarMeses(`${vista.mes}-01`, -i).slice(0, 7));
  const dados = meses.map((m) => {
    const x = mesDosInvestimentos(app, ids, m);
    const ate = fimDoMes(`${m}-01`) > hoje() ? hoje() : fimDoMes(`${m}-01`);
    // O rendimento desde sempre até o fim do mês; o resto do saldo é o que foi posto.
    const rendeu = rendimentoNoPeriodo(app, '2000-01-01', ate, ids);
    return { ...x, rendeuAcumulado: rendeu, aportadoAcumulado: x.fim - rendeu };
  }).filter((x) => x.inicio || x.fim || x.aportado || x.resgatado);
  if (dados.length < 2) { raiz.innerHTML = ''; return; }
  const ultimo = dados.length - 1;
  const perdeu = dados.some((x) => x.rendeuAcumulado < 0);
  areas(raiz, {
    pontos: dados.map((x, i) => ({
      rotulo: i === ultimo && x.mes === hoje().slice(0, 7) ? 'hoje' : `${nomeDoMes(x.mes).split(' ')[0].slice(0, 3)}/${x.mes.slice(2, 4)}`,
      acima: [Math.max(0, x.aportadoAcumulado), Math.max(0, x.rendeuAcumulado)],
      abaixo: perdeu ? [Math.max(0, -x.rendeuAcumulado)] : [],
      linha: x.fim,
      dica: `<strong>${formatar(x.fim)}</strong><span>${escapar(nomeDoMes(x.mes))}</span>
        <span class="fino">aportado até aqui ${formatar(x.aportadoAcumulado)} · rendeu até aqui ${rendeuTexto(x.rendeuAcumulado)}</span>
        <span class="fino">no mês: aportou ${formatar(x.aportado)}${x.resgatado ? `, resgatou ${formatar(x.resgatado)}` : ''}, rendeu ${rendeuTexto(x.rendeu)}</span>`,
    })),
    acima: [{ nome: 'aportado', cor: corDaSerie(1) }, { nome: 'rendimento', cor: corDaSerie(3) }],
    abaixo: perdeu ? [{ nome: 'perdeu', cor: corDaSerie(2) }] : [],
    linha: { nome: 'saldo', cor: 'var(--tinta)' },
    formatar: (v) => {
      const abs = Math.abs(v / 100);
      return `${v < 0 ? '−' : ''}${abs >= 1000 ? `${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: abs >= 10000 ? 0 : 1 })} mil` : Math.round(abs).toLocaleString('pt-BR')}`;
    },
    altura: 190,
  });
}

/**
 * "Reserva 75% · IPVA 7% · sem dono 18%": de quem é o dinheiro de um lugar.
 * Vazio quando nenhum envelope tem nada ali.
 */
function divisao(donos, lugarId) {
  const x = donos?.porLugar.get(lugarId);
  if (!x || !x.donos.size || x.valor <= 0) return '';
  const partes = [...x.donos.entries()].sort((a, b) => b[1] - a[1])
    .map(([id, v]) => `${app.envelopes[id]?.nome ?? '—'} ${Math.round((v / x.valor) * 100)}%`);
  if (x.semDono > 0) partes.push(`sem dono ${Math.round((x.semDono / x.valor) * 100)}%`);
  return partes.join(' · ');
}

/** Os ativos de uma conta, agrupados pela classe, cada um com valor e quanto rendeu. */
function listaDeAtivos(r, donos = null) {
  if (!r.posicoes.length) return '';
  const grupos = CLASSES.map((cl) => ({ cl, ps: r.posicoes.filter((p) => p.ativo.classe === cl.id) }))
    .filter((g) => g.ps.length);
  return `<div class="ativos">${grupos.map((g) => {
    const vivos = g.ps.filter((p) => !p.ativo.arquivado);
    const total = vivos.reduce((t, p) => t + p.valorAtual, 0);
    const aplicado = vivos.reduce((t, p) => t + p.aplicado, 0);
    const rendeu = vivos.reduce((t, p) => t + p.rendeu, 0);
    return `<p class="classe-ativos"><span>${escapar(g.cl.nome)}</span><span>${formatar(total)}${aplicado ? ` · ${pctTexto(rendeu / aplicado)}` : ''}</span></p>
      ${g.ps.map((p) => {
        const a = p.ativo;
        const sub = (p.porCotas
          ? [
            p.quantidade ? `${p.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 8 })} × ${p.cotacao ? formatar(p.cotacao.preco) : '—'}` : 'nenhuma na mão',
            p.cotacao ? `cotação de ${diaCurto(p.cotacao.data)}` : 'sem cotação',
            p.quantidade ? `médio ${formatar(Math.round(p.precoMedio))}` : '',
            a.arquivado ? 'arquivado' : '',
          ]
          : [
            a.vencimento ? `vence ${diaCurto(a.vencimento)}/${a.vencimento.slice(0, 4)}` : '',
            p.avaliacao ? `valor de ${diaCurto(p.avaliacao.data)}` : 'sem valor informado',
            a.arquivado ? 'arquivado' : '',
          ]).filter(Boolean).join(' · ');
        const deQuem = divisao(donos, a.id);
        return `<button type="button" class="linha-ativo ${a.arquivado ? 'arquivado' : ''}" data-ativo-abrir="${escapar(a.id)}">
          <span class="nome-ativo">${escapar(a.nome)}<span class="fino">${escapar(sub)}</span>${deQuem ? `<span class="fino divisao-envelopes">${escapar(deQuem)}</span>` : ''}</span>
          <span class="valor-ativo">${p.estimado && p.valorAtual ? '~' : ''}${formatar(p.valorAtual)}</span>
          <span class="rendeu-ativo ${p.rendeu > 0 ? 'positivo' : p.rendeu < 0 ? 'negativo' : ''}">${p.aplicado ? pctTexto(p.pct) : '—'}</span>
        </button>`;
      }).join('')}`;
  }).join('')}</div>`;
}

/** Geral: a soma das contas e o dinheiro por classe. */
function blocoGeralDosInvestimentos(resumos, linkEnvelopes = '') {
  const valor = resumos.reduce((t, r) => t + r.valorAtual, 0);
  const investido = resumos.reduce((t, r) => t + r.investido, 0);
  const rendeu = resumos.reduce((t, r) => t + r.rendeu, 0);
  const porClasse = new Map();
  for (const r of resumos) {
    for (const p of r.posicoes) porClasse.set(p.ativo.classe, (porClasse.get(p.ativo.classe) ?? 0) + p.valorAtual);
    if (r.caixa) porClasse.set('caixa', (porClasse.get('caixa') ?? 0) + r.caixa);
  }
  const linhas = [...porClasse.entries()]
    .filter(([, v]) => v)
    .sort((a, b) => b[1] - a[1])
    .map(([cl, v]) => `<p class="classe-ativos"><span>${escapar(cl === 'caixa' ? 'Caixa e contas sem ativos' : nomeDaClasse(cl))}</span><span>${formatar(v)}${valor ? ` · ${pctTexto(v / valor)}` : ''}</span></p>`)
    .join('');
  return `<div class="bloco total largo investimento-resumo">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>geral · ${escapar(nomeDoMes(vista.mes).split(' ')[0])}</p>
    <div class="numeros-renda">${numerosDoMesInvestido(resumos.map((r) => r.conta.id), resumos.some((r) => r.estimado)).join('')}</div>
    ${desdeOInicio(investido, rendeu)}
    <div class="grafico-rel grafico-invest" id="g-invest"></div>
    ${linhas ? `<div class="ativos">${linhas}</div>` : ''}
    ${linkEnvelopes ? `<div class="pe-bloco"><span class="fino">De quem é cada pedaço do que está guardado.</span>${linkEnvelopes}</div>` : ''}
  </div>`;
}

function blocoDeTotal(aba, contas) {
  const soma = contas.reduce((t, c) => t + saldoReal(app, c.id), 0);
  return `<div class="bloco total">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>geral</p>
    <dl>${linhaDeResumo('total', dinheiroHTML(soma), soma < 0 ? 'negativo' : '')}</dl>
  </div>`;
}

/**
 * A renda das folhas no mês da tela: bruta, e líquida (descontos e consignados
 * fora). Do mês atual em diante, o que falta lançar do contracheque entra
 * como previsto (D31): o mês mostra o que vai ser, não só o que já foi.
 * Mês passado é só o real.
 */
function rendaNoMes(folhas) {
  const ids = new Set(folhas.map((c) => c.id));
  const doMes = visiveis(app).filter((l) => ids.has(l.contaId) && l.dataCompetencia.slice(0, 7) === vista.mes);
  const previstas = vista.mes >= hoje().slice(0, 7)
    ? folhas.flatMap((c) => linhasDoHolerite(app, c.id, vista.mes))
    : [];
  const { bruta, descontos, emprestimos, liquida } = rendaDaFolha(app, [...doMes, ...previstas], ids);
  const til = previstas.some((o) => o.estimado) ? '~' : '';
  const manuais = previstas.filter((o) => !o.automatico).length;
  return {
    titulo: !manuais ? '' : doMes.some((l) => !l.automatico) ? ' · parte prevista' : ' · previsto',
    numeros: numeroDaFaixa('bruto', `${til}${formatar(bruta)}`) +
      numeroDaFaixa('descontos', `${til}${formatar(descontos)}`) +
      numeroDaFaixa('empréstimos', formatar(emprestimos)) +
      numeroDaFaixa('líquido', `${til}${formatar(liquida)}`),
  };
}

/**
 * Um aviso só: a folha que terminou o mês anterior com saldo (pedido dele,
 * 05/10/2026). No meio do mês a folha anda fora do zero — a parcela do
 * consignado cai antes do contracheque —, então o que importa é o mês que
 * já fechou: o anterior ao da tela, ou ao de hoje, o que vier primeiro.
 */
function avisoDaFolha(folhas) {
  const atual = hoje().slice(0, 7);
  const mes = somarMeses(`${vista.mes < atual ? vista.mes : atual}-01`, -1).slice(0, 7);
  const fim = fimDoMes(`${mes}-01`);
  const sobras = folhas
    .map((c) => ({ c, saldo: saldoNoDia(app, new Set([c.id]), fim) }))
    .filter((x) => x.saldo !== 0 && (!x.c.dataInicial || x.c.dataInicial <= fim));
  if (!sobras.length) return '';
  const nomeMes = nomeDoMes(mes).split(' ')[0];
  const quanto = (v) => (v < 0 ? `faltou ${formatar(-v)}` : `sobrou ${formatar(v)}`);
  if (sobras.length === 1) {
    const { c, saldo } = sobras[0];
    return `<div class="aviso-bloco aviso-folha">
      <span>${folhas.length > 1 ? `${escapar(c.nome)}: ` : ''}${quanto(saldo)} na folha no fim de ${escapar(nomeMes)} — o contracheque daquele mês não fechou em zero.</span>
      <button type="button" class="elo" data-holerite="${escapar(c.id)}" data-mes="${escapar(mes)}">arrumar ${escapar(nomeMes)}</button>
    </div>`;
  }
  return `<p class="aviso-bloco">${sobras.length} folhas não fecharam ${escapar(nomeMes)} em zero (${sobras.map((x) => escapar(x.c.nome)).join(', ')}): abra a aba de cada uma para arrumar.</p>`;
}

/** Geral da renda: a soma das fontes no mês, e o aviso das que não fecharam. */
function blocoDasFolhas(folhas) {
  const renda = rendaNoMes(folhas);
  return `<div class="bloco total largo">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>geral · ${escapar(nomeDoMes(vista.mes).split(' ')[0])}${escapar(renda.titulo)}</p>
    <div class="numeros-renda">${renda.numeros}${numeroDaFaixa('saldo atual', formatar(folhas.reduce((t, c) => t + saldoReal(app, c.id), 0)))}</div>
    ${avisoDaFolha(folhas)}
  </div>`;
}

// ── a lista: caixa, investimentos, dívidas, folha ─────────────────────────

/**
 * O que caiu no período nas contas em foco, mais o que ainda vai cair:
 * as ocorrências de recorrência que ninguém lançou e, em caixa, a fatura a
 * pagar na conta que a paga (08-telas §4.1).
 */
function pintarLista(aba, contas) {
  const ids = new Set(contas.map((c) => c.id));
  const { de, ate } = intervalo();
  const noPeriodo = (dia) => dia >= de && dia <= ate;
  // Em Investimentos entram as operações dos ativos destas contas, mesmo
  // quando o dinheiro passou pela corrente do banco (design/10 §3.6).
  const dosAtivos = new Set(
    aba.id === 'investimentos' ? contas.flatMap((c) => ativosDaConta(app, c.id).map((a) => a.id)) : []
  );

  const linhas = visiveis(app).filter(
    (l) => (ids.has(l.contaId) || ids.has(l.contaDestinoId) || dosAtivos.has(l.ativoId)) && noPeriodo(l.dataCaixa)
  );

  for (const o of ocorrenciasPrevistas(app, de, ate)) {
    if ((ids.has(o.contaId) || ids.has(o.contaDestinoId)) && noPeriodo(o.dataCaixa)) linhas.push(o);
  }

  if (aba.id === 'caixa') {
    // O salário que a folha ainda vai mandar: a linha de onde sai o número
    // da faixa (D31). Tocada, abre o contracheque daquele mês.
    for (const folha of Object.values(app.contas)) {
      if (folha.tipo !== 'folha' || !ids.has(folha.liquidoPara)) continue;
      for (let mes = de.slice(0, 7); mes <= ate.slice(0, 7); mes = proximoMes(mes)) {
        if (mes < hoje().slice(0, 7)) continue;
        const lp = liquidoPrevisto(app, folha.id, mes);
        if (!lp || !noPeriodo(lp.data)) continue;
        linhas.push({
          id: `liquido:${folha.id}:${mes}`,
          liquido: { folhaId: folha.id, mes },
          projetado: true,
          tipo: 'transferencia',
          valor: lp.valor,
          estimado: lp.estimado,
          contaId: folha.id,
          contaDestinoId: lp.contaId,
          dataCompetencia: lp.data,
          dataCaixa: lp.data,
          confirmado: false,
        });
      }
    }
    for (const cartao of Object.values(app.contas)) {
      if (cartao.tipo !== 'cartao' || !ids.has(cartao.pagaCom)) continue;
      // A fatura a pagar com as compras recorrentes que ainda vão cair nela:
      // a linha bate com a faixa, e a fatura só de recorrentes não some.
      const doMesAtual = modoDaTela() === 'mes' && vista.mes === hoje().slice(0, 7);
      const daConta = doMesAtual
        ? faturasNoPeriodo(app, cartao.id, '2000-01-01', somarMeses(ate, 2), hoje(), { pagoAte: ate })
          // A que vence no mês seguinte é a "próxima fatura": mora só no card.
          .filter((f) => noPeriodo(f.vencimento) || (f.situacao !== 'futura' && f.aPagar > 0 && f.vencimento < de))
        : faturasNoPeriodo(app, cartao.id, de, ate);
      for (const f of daConta) {
        if (f.previsto <= 0) continue;
        linhas.push({
          id: `fatura:${cartao.id}:${f.fechamento}`,
          fatura: f,
          cartaoId: cartao.id,
          tipo: 'pagamento_fatura',
          valor: f.previsto,
          estimado: f.estimado,
          contaId: cartao.pagaCom,
          contaDestinoId: cartao.id,
          dataCaixa: f.vencimento,
          confirmado: false,
        });
      }
    }
  }

  linhas.sort(porDataDecrescente);

  // Com uma conta em foco, cada linha realizada leva o saldo depois dela — é
  // o extrato que o banco mostra, e o jeito de achar onde a conta divergiu.
  const saldoApos = contas.length === 1 && aba.id !== 'dividas' ? saldosCorridos(contas[0]) : null;

  $('lista').innerHTML = linhas.length
    ? linhas.map((l) => linhaHTML(l, ids, saldoApos)).join('')
    : `<li class="vazio">Nada ${vista.modo === 'mes' ? `em ${nomeDoMes(vista.mes)}` : 'neste período'}.</li>`;
  pintarTotais(linhas, ids);
}

function saldosCorridos(conta) {
  const mapa = new Map();
  let saldo = conta.saldoInicial ?? 0;
  const daConta = visiveis(app)
    .filter((l) => l.confirmado && (l.contaId === conta.id || l.contaDestinoId === conta.id))
    .sort((a, b) => -porDataDecrescente(a, b));
  for (const l of daConta) {
    if (l.contaId === conta.id) saldo -= sinalDeSaida(l);
    if (l.contaDestinoId === conta.id) saldo += l.valor;
    mapa.set(l.id, saldo);
  }
  return mapa;
}

/**
 * O quanto entrou e saiu das contas em foco. Transferência entre duas delas
 * não é nem uma coisa nem outra — dinheiro trocando de bolso dentro do foco.
 * O que ainda não aconteceu fica numa soma à parte, sempre rotulada.
 */
function pintarTotais(linhas, ids) {
  // Em Contas, mês a mês, o card já traz entrou, saiu e o previsto.
  if (AREA === 'caixa' && modoDaTela() === 'mes') {
    $('totais').innerHTML = '';
    return;
  }
  let entrou = 0;
  let saiu = 0;
  let previsto = 0;
  let estimado = false;
  for (const l of linhas) {
    const d = direcao(l, ids);
    if (!d) continue;
    const valor = d === 'entra' ? l.valor : -l.valor;
    if (l.confirmado) {
      if (valor > 0) entrou += valor; else saiu -= valor;
    } else {
      previsto += valor;
      if (l.estimado) estimado = true;
    }
  }
  const partes = [];
  if (entrou) partes.push(`entrou ${dinheiroHTML(entrou)}`);
  if (saiu) partes.push(`saiu ${dinheiroHTML(saiu)}`);
  if (previsto) partes.push(`previsto ${dinheiroHTML(previsto, { estimado, sinal: previsto > 0 ? '+' : '' })}`);
  $('totais').innerHTML = partes.join(' · ');
}

/** 'entra', 'sai' ou null (movimento interno do foco). */
function direcao(l, ids) {
  const deDentro = ids.has(l.contaId);
  const praDentro = ids.has(l.contaDestinoId);
  if (deDentro && praDentro) return null;
  if (praDentro) return 'entra';
  if (!deDentro) return null;
  return sinalDeSaida(l) > 0 ? 'sai' : 'entra';
}

// ── a lista: cartões ──────────────────────────────────────────────────────

/**
 * No cartão o mês é o da fatura — "fatura de novembro" é a que vence em
 * novembro, como o banco chama (08-telas §4.1). As compras vêm agrupadas pela
 * fatura, na data da compra. No período escolhido, valem as compras feitas
 * dentro dele.
 */
function pintarListaDeCartoes(cartoes) {
  const { de, ate } = intervalo();
  const noPeriodo = (dia) => dia >= de && dia <= ate;
  // A fatura que vence neste mês junta compras de até dois meses antes.
  const previstas = ocorrenciasPrevistas(app, somarMeses(de, -2), ate);
  const html = [];
  let total = 0;
  let lancado = 0;
  let pago = 0;

  for (const c of cartoes) {
    const pagamentos = visiveis(app).filter((l) => l.contaDestinoId === c.id && noPeriodo(l.dataCaixa));
    pago += pagamentos.reduce((t, l) => t + l.valor, 0);

    if (!temCiclo(c) || modoDaTela() === 'intervalo') {
      const compras = [
        ...visiveis(app).filter((l) => l.contaId === c.id && noPeriodo(dataVista(l))),
        ...previstas.filter((o) => o.contaId === c.id && noPeriodo(o.dataCompetencia)),
      ];
      total += compras.reduce((t, l) => t + sinalDeSaida(l), 0);
      lancado += compras.filter((l) => !l.projetado).reduce((t, l) => t + sinalDeSaida(l), 0);
      if (!compras.length && !pagamentos.length) continue;
      html.push(`<li class="grupo">${escapar(c.nome)}</li>`);
      html.push(...ordenarPelaCompra([...compras, ...pagamentos]).map((l) => linhaHTML(l, new Set([c.id]))));
      continue;
    }

    // A fatura que vence no mês da tela — inclusive a feita só de compras
    // recorrentes, que ainda não tem compra lançada (a assinatura de daqui a
    // um ano não pode sumir).
    for (const f of faturasNoPeriodo(app, c.id, `${vista.mes}-01`, fimDoMes(`${vista.mes}-01`))) {
      const projetadas = f.projetadas;
      const estimadoDaFatura = f.total + projetadas.reduce((t, o) => t + sinalDeSaida(o), 0);
      total += estimadoDaFatura;
      lancado += f.total;
      const situacao =
        f.situacao === 'aberta' ? 'aberta' : f.situacao === 'futura' ? 'por vir' : f.aPagar > 0 ? 'fechada' : 'paga';
      html.push(`<li class="grupo">
        <span>${escapar(c.nome)} · fatura de ${escapar(nomeDoMes(vista.mes).split(' ')[0])}
          <span class="fino">fecha ${diaCurto(f.fechamento)} · vence ${diaCurto(f.vencimento)} · ${situacao}</span></span>
        <span class="valor-grupo">${dinheiroHTML(estimadoDaFatura, { estimado: f.estimado })}${projetadas.length ? ` <span class="fino">lançado ${dinheiroHTML(f.total)}</span>` : ''}${f.pago && f.aPagar ? ` <span class="fino">falta ${dinheiroHTML(f.aPagar)}</span>` : ''}</span>
      </li>`);
      const itens = ordenarPelaCompra([...f.itens, ...projetadas, ...pagamentos]);
      html.push(
        ...(itens.length
          ? itens.map((l) => linhaHTML(l, new Set([c.id])))
          : ['<li class="vazio">Nenhuma compra nesta fatura.</li>'])
      );
    }
  }

  $('lista').innerHTML = html.length
    ? html.join('')
    : `<li class="vazio">Nenhuma fatura ${vista.modo === 'mes' ? `vence em ${nomeDoMes(vista.mes)}` : 'neste período'}.</li>`;

  const partes = [];
  if (total) partes.push(`compras ${dinheiroHTML(total)}${total !== lancado ? ` (já lançado ${dinheiroHTML(lancado)})` : ''}`);
  if (pago) partes.push(`pago ${dinheiroHTML(pago)}`);
  $('totais').innerHTML = partes.join(' · ');
}

const ordenarPelaCompra = (lista) =>
  lista.sort((a, b) => {
    const da = dataVista(a);
    const db = dataVista(b);
    if (da !== db) return da < db ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

// ── uma linha ─────────────────────────────────────────────────────────────

/**
 * Tipo tem código próprio: marca, cor e sinal (09-identidade §3). A marca vem
 * antes da cor — é ela que carrega o sentido em preto e branco.
 *
 * Uma ação da vida real é UMA linha (08-telas §4): a transferência aparece
 * como origem → destino, nunca como despesa numa conta e receita na outra.
 */
function linhaHTML(l, ids, saldoApos = null) {
  const est = l.projetado || l.fatura ? (l.dataCaixa < hoje() ? 'vencido' : 'previsto') : estadoDoLancamento(l);
  const conta = app.contas[l.contaId ?? l.contaDestinoId];
  const investimento = ehDeInvestimento(l);
  const transferencia = ehTransferencia(l) || investimento;
  const ajuste = l.tipo === 'ajuste_caixa';
  const devolucao = l.tipo === 'estorno';
  const entrada = !transferencia && !ajuste && sinalDeSaida(l) < 0;

  // Devolução é despesa que se desfez, nunca receita (03 §3.3): marca própria,
  // na cor da entrada de dinheiro. Ajuste de caixa não é gasto nem ganho.
  const tom = transferencia ? 'transferencia' : ajuste ? 'ajuste' : devolucao ? 'receita' : entrada ? 'receita' : 'despesa';
  const marca = investimento ? (l.tipo === 'aplicacao' ? '→' : '←') : transferencia ? '→' : ajuste ? '≈' : devolucao ? '↩' : entrada ? '↑' : '↓';
  const nomeDoTom =
    investimento ? (app.ativos?.[l.ativoId]?.unidade === 'cotas' ? { aplicacao: 'Compra', resgate: 'Venda', provento: 'Provento' } : { aplicacao: 'Aplicação', resgate: 'Resgate', provento: 'Provento' })[l.tipo]
    : l.tipo === 'pagamento_fatura' ? 'Pagamento de fatura'
      : transferencia ? 'Transferência'
        : ajuste ? 'Ajuste de caixa'
          : devolucao ? 'Devolução'
            : entrada ? 'Receita' : 'Despesa';

  // Na transferência e no ajuste o sinal diz se o dinheiro saiu ou entrou no foco.
  const d = direcao(l, ids);
  const sinal = investimento
    ? (l.tipo === 'aplicacao' ? '−' : '+')
    : transferencia || ajuste ? (d === 'entra' ? '+' : d === 'sai' ? '−' : '') : entrada ? '+' : '−';

  const destino = app.contas[l.contaDestinoId];
  const detalhe = l.detalheId ? app.detalhes?.[l.detalheId]?.nome : null;
  let oque;
  let onde;
  if (investimento) {
    // "CDB Banco · aplicação", com a conta por onde o dinheiro passou.
    const ativo = app.ativos?.[l.ativoId];
    const cotas = ativo?.unidade === 'cotas';
    const nomeDaOp = (cotas ? { aplicacao: 'compra', resgate: 'venda', provento: 'provento' } : { aplicacao: 'aplicação', resgate: 'resgate', provento: 'provento' })[l.tipo];
    oque = `${ativo?.nome ?? 'Investimento'} · ${nomeDaOp}`;
    // Sem conta: de antes de a conta do dinheiro entrar no app.
    onde = conta?.nome ?? 'antes do app';
    if (l.quantidade) onde += ` · ${Number(l.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 8 })} × ${formatar(l.preco ?? 0)}`;
  } else if (l.fatura) {
    // Ainda aberta, é provisão para o mês do vencimento: diz que é prevista.
    oque = `${l.fatura.situacao === 'fechada' ? 'Fatura' : 'Fatura prevista'} ${destino?.nome ?? ''}`;
    onde = `${conta?.nome ?? '—'} · fecha ${diaCurto(l.fatura.fechamento)}`;
  } else if (l.liquido) {
    oque = `Salário ${conta?.nome ?? ''} · líquido`;
    onde = `${conta?.nome ?? '—'} → ${destino?.nome ?? '—'} · toque para lançar o contracheque`;
  } else if (transferencia) {
    oque = nomeDaTransferencia(l, d, conta, destino);
    onde = `${conta?.nome ?? '—'} → ${destino?.nome ?? '—'}`;
    // Na parcela de um contrato, a parte que é juros — informação, não gasto.
    const k = indiceDaParcela(l, destino);
    const juros = k ? jurosDaParcela(app, destino.id, k) : null;
    if (juros) onde += ` · juros ~${formatar(juros)}`;
  } else if (ajuste) {
    oque = 'Ajuste de caixa';
    onde = conta?.nome ?? '—';
  } else if (devolucao) {
    const compra = app.lancamentos[l.estornoDe];
    oque = ['Devolução', nomeDaCategoria(app, l.categoriaId), detalhe].filter(Boolean).join(' · ');
    onde = `${conta?.nome ?? '—'}${compra ? ` · da compra de ${diaCurto(dataVista(compra))}` : ''}`;
  } else if (detalhe) {
    // Com descrição, ela é o que se lê primeiro — é o que distingue esta
    // linha das outras da mesma categoria (pedido dele, 03/10/2026).
    oque = detalhe;
    onde = [nomeDaCategoria(app, l.categoriaId), conta?.nome ?? '—'].filter(Boolean).join(' · ');
  } else {
    oque = nomeDaCategoria(app, l.categoriaId) || l.tipo;
    onde = conta?.nome ?? '—';
    // Importado sem descrição: o texto do banco diz o que foi (design/13 §3).
    if (l.textoBanco) onde = `${l.textoBanco} · ${onde}`;
  }
  if (!l.fatura && !transferencia && !ajuste && !devolucao) {
    // A compra mostra o que já voltou dela (03 §3.3).
    const voltou = l.tipo === 'despesa' && !l.projetado ? estornado(app, l.id) : 0;
    if (voltou) onde += ` · devolvido ${formatar(voltou)} de ${formatar(l.valor)}`;
    // Pago com o dinheiro de um envelope (design/11 §8).
    if (l.custeadoPor && app.envelopes?.[l.custeadoPor]) onde += ` · envelope ${app.envelopes[l.custeadoPor].nome}`;
  }
  const rotuloEstado = (l.corrigida ? ' · corrigida' : '') + (l.caiuSozinha ? ' · caiu sozinha' : '') +
    (est === 'realizado' ? (l.automatico ? ' · automática' : '') : ` · ${l.projetado ? 'previsto' : est}`);

  const parcela = l.parcela ? `<span class="parcela">${l.parcela.numero}/${l.parcela.total}</span>` : '';
  const etiquetas = (l.etiquetas ?? [])
    .map((t) => app.etiquetas?.[t]?.nome)
    .filter(Boolean)
    .map((e) => `<span class="etiqueta">${escapar(e)}</span>`)
    .join('');
  const dia = dataVista(l);
  linhasNaTela.push({
    data: dia,
    tipo: nomeDoTom,
    descricao: oque,
    detalhes: onde,
    etiquetas: (l.etiquetas ?? []).map((t) => app.etiquetas?.[t]?.nome).filter(Boolean),
    parcela: l.parcela ? `${l.parcela.numero}/${l.parcela.total}` : '',
    situacao: est === 'realizado' ? 'realizado' : l.projetado ? 'previsto' : est,
    valor: sinal === '−' ? -l.valor : l.valor,
  });
  const saldo = saldoApos?.has(l.id)
    ? `<span class="saldo-apos ${saldoApos.get(l.id) < 0 ? 'negativo' : ''}">${dinheiroHTML(saldoApos.get(l.id))}</span>`
    : '<span class="saldo-apos"></span>';

  // A parcela automática de uma dívida não é gravada: tocada, abre a
  // correção daquela parcela (design/10 §4.4).
  if (l.projetado || l.automatico) previstosNaTela.set(l.id, l);
  const alvo = l.liquido
    ? `data-holerite="${escapar(l.liquido.folhaId)}" data-mes="${escapar(l.liquido.mes)}"`
    : l.fatura
    ? `data-pagar="${escapar(l.cartaoId)}" data-valor="${l.valor}"`
    : l.projetado || l.automatico
      ? `data-previsto="${escapar(l.id)}"`
      : `data-lanc="${escapar(l.id)}"`;
  const acao = l.fatura ? 'Pagar' : l.automatico ? 'Corrigir' : l.projetado ? 'Lançar' : 'Corrigir';

  // A conta fixa (ou estimada) que já chegou: um toque lança como veio, sem
  // abrir o formulário — ele fica para quando algo mudou (pedido dele).
  // Dar baixa (pedido dele, 06/10/2026): o previsto de uma recorrência — vencido ou
  // futuro — vira lançamento e cai na conta; o agendado que já está gravado é
  // confirmado. A vaga do botão existe em TODA linha, para os valores não saírem do prumo.
  const baixaDoPrevisto = l.projetado && l.recorrenciaId && !l.automatico;
  const baixaDoAgendado = !l.projetado && !l.automatico && !l.fatura && !l.liquido && !l.confirmado && !l.cicloFatura && l.tipo !== 'ajuste_caixa';
  const cairHoje = (l.dataCaixa ?? l.dataCompetencia) > hoje();
  const tituloDaBaixa = cairHoje ? 'Dar baixa hoje: cai na conta agora' : 'Dar baixa: cai na conta';
  const rapido = baixaDoPrevisto
    ? `<button type="button" class="lancar-rapido" data-lancar-previsto="${escapar(l.id)}" title="${tituloDaBaixa}" aria-label="Dar baixa em ${escapar(oque)}">✓</button>`
    : baixaDoAgendado
      ? `<button type="button" class="lancar-rapido" data-dar-baixa="${escapar(l.id)}" title="${tituloDaBaixa}" aria-label="Dar baixa em ${escapar(oque)}">✓</button>`
      : '<span class="lancar-rapido sem-ir" aria-hidden="true"></span>';

  // A conta do outro lado, a um toque, no mesmo período (pedido dele, 05/10/2026).
  const lado = ladoDaLinha(l, ids, investimento, transferencia);
  const elo = lado
    ? `<button type="button" class="ir-conta" data-ir-conta="${escapar(lado.conta)}" data-ir-mes="${escapar(lado.mes ?? '')}" title="Abrir ${escapar(app.contas[lado.conta].nome)}" aria-label="Abrir ${escapar(app.contas[lado.conta].nome)}">↗</button>`
    : '<span class="ir-conta sem-ir" aria-hidden="true"></span>';

  return `<li class="com-rapido"><button type="button" class="linha ${tom} ${l.tipo === 'pagamento_fatura' ? 'da-fatura' : ''} ${est === 'realizado' ? '' : est} ${saldoApos ? 'com-saldo' : ''}"
      ${alvo} aria-label="${acao} ${escapar(nomeDoTom.toLowerCase())} de ${escapar(diaCurto(dia))}">
    <span class="marca" title="${nomeDoTom}" aria-hidden="true">${marca}</span>
    <span class="quando">${escapar(diaCurto(dia))}</span>
    <span class="oque">
      <span class="cat">${escapar(oque)}${parcela}${etiquetas}</span>
      <span class="onde">${escapar(onde)}${rotuloEstado}</span>
    </span>
    <span class="quanto ${tom}">${dinheiroHTML(l.valor, { sinal, estimado: Boolean(l.estimado) })}</span>
    ${saldoApos ? saldo : ''}
  </button>${elo}${rapido}</li>`;
}

/**
 * Para onde vai o ↗ da linha: a conta do outro lado da transferência (do
 * pagamento de fatura, da parcela, do aporte, do líquido da folha) ou a fatura
 * do cartão. Compra, receita e despesa comuns não têm "outro lado".
 */
function ladoDaLinha(l, ids, investimento, transferencia) {
  const existe = (id) => id && app.contas[id] && paginaDaConta(app.contas[id]);
  if (l.fatura) return existe(l.cartaoId) ? { conta: l.cartaoId, mes: l.fatura.vencimento.slice(0, 7) } : null;
  let alvo = null;
  if (investimento) {
    const doAtivo = app.ativos?.[l.ativoId]?.contaId;
    alvo = ids?.has(doAtivo) ? l.contaId : doAtivo;
  } else if (transferencia) {
    const [a, b] = [l.contaId, l.contaDestinoId];
    alvo = ids?.has(a) && !ids.has(b) ? b : ids?.has(b) && !ids.has(a) ? a : b;
  }
  if (!existe(alvo)) return null;
  const cartao = app.contas[alvo].tipo === 'cartao';
  return { conta: alvo, mes: cartao ? l.dataCaixa.slice(0, 7) : null };
}

/**
 * A transferência se apresenta pelo nome da outra conta, nunca por categoria —
 * ela não é gasto nem ganho (03 §3.1). Só o nome: a direção já está na marca
 * → e no sinal do valor. Quem recebe o salário vê "Salário Professor"; quem
 * paga a parcela vê "Consignado · parcela 17/72". Entre duas contas do mesmo
 * foco, "Transferência", com os dois nomes embaixo.
 */
function nomeDaTransferencia(l, direcaoNoFoco, conta, destino) {
  if (direcaoNoFoco === 'entra') return `${conta?.nome ?? '—'}${numeroDaParcela(l, destino)}`;
  if (direcaoNoFoco === 'sai') return `${destino?.nome ?? '—'}${numeroDaParcela(l, destino)}`;
  return 'Transferência';
}

/** Qual parcela do contrato é esta transferência (1 em diante), ou 0. */
function indiceDaParcela(l, destino) {
  if (l.parcelaDe?.dividaId === destino?.id) return l.parcelaDe.k;
  if (l.observacao === 'amortização') return 0;
  const c = destino?.contrato;
  if (!c?.parcelas || !c.primeira) return 0;
  const mes = l.dataCompetencia.slice(0, 7);
  return Array.from({ length: c.parcelas }, (_, i) => somarMeses(c.primeira, i).slice(0, 7)).indexOf(mes) + 1;
}

/** " · parcela 17/72", quando a transferência é parcela de um contrato. */
function numeroDaParcela(l, destino) {
  const k = indiceDaParcela(l, destino);
  if (!k) return l.contaDestinoId === destino?.id && destino?.tipo === 'divida' && l.observacao === 'amortização' ? ' · amortização' : '';
  return ` · parcela ${k}/${l.parcelaDe?.total ?? destino.contrato.parcelas}`;
}

// ── os diálogos ───────────────────────────────────────────────────────────

const dialogo = $('dialogo');

const formulario = await criarFormulario({
  raiz: $('formulario'),
  // No PC se lança sentado: a etiqueta cabe já na captura. No celular, não.
  comEtiquetas: true,
  // Tipo, categoria, descrição, valor — a ordem em que se pensa (03/10/2026).
  ordemDoApp: true,
  acoes: [
    { id: 'nova', rotulo: 'Salvar e nova', principal: true, fecha: false },
    { id: 'fechar', rotulo: 'Salvar e fechar', fecha: true },
  ],
  aoSalvar: async () => {
    // A data do que acabou de ser salvo vale para o próximo, enquanto o mês
    // da tela for o mesmo (D35).
    ultimaData = { dia: formulario.dataAtual(), mes: vista.mes };
    await pintar();
  },
  aoFechar: () => dialogo.close(),
});

/**
 * A data em que o lançamento novo abre (D35, pedido dele, 05/10/2026): a do
 * último salvo, se o mês da tela não mudou desde então; senão, o mês da tela
 * — hoje, no mês atual; dia 1, em qualquer outro.
 */
function dataDaVista() {
  if (ultimaData && ultimaData.mes === vista.mes) return ultimaData.dia;
  return vista.mes === hoje().slice(0, 7) ? hoje() : `${vista.mes}-01`;
}

// Corrigir e apagar são do andar de cima, nunca do térreo (D11) — então vivem
// aqui, no extrato, e não na captura. O formulário é o mesmo (design/03 §9).
const dialogoEdicao = $('dialogo-edicao');

const edicao = await criarFormulario({
  raiz: $('formulario-edicao'),
  ordemDoApp: true,
  acoes: [{ id: 'salvar', rotulo: 'Salvar', principal: true, fecha: true }],
  aoSalvar: pintar,
  aoFechar: () => dialogoEdicao.close(),
  // Devolver parte da compra que se está corrigindo (03 §3.3).
  aoDevolver: async (l) => {
    dialogoEdicao.close();
    await devolucao.abrir(l);
  },
});

const devolucao = criarDevolucao({
  janela: $('dialogo-devolucao'),
  raiz: $('formulario-devolucao'),
  aoSalvar: pintar,
});

const conferencia = criarConferencia({
  janela: $('dialogo-conferencia'),
  titulo: $('titulo-conferencia'),
  raiz: $('formulario-conferencia'),
  aoSalvar: pintar,
});

for (const fechar of document.querySelectorAll('dialog [data-fechar]')) {
  fechar.addEventListener('click', () => fechar.closest('dialog').close());
}

// Transferir é outro formulário, porque é outra pergunta: de onde sai, pra onde
// vai e quanto — sem categoria (design/03 §3.1). Pagar fatura é ele também,
// com destino num cartão (§6.2).
const dialogoTransferencia = $('dialogo-transferencia');

const transferencia = await criarTransferencia({
  raiz: $('formulario-transferencia'),
  // A data da transferência salva vale para a próxima, no mesmo mês da tela (D35).
  aoSalvar: async () => {
    ultimaData = { dia: transferencia.dataAtual(), mes: vista.mes };
    await pintar();
  },
  aoFechar: () => dialogoTransferencia.close(),
  aoMudarTitulo: (titulo) => { $('titulo-transferencia').textContent = titulo; },
});

const janelaDoAtivo = criarJanelaDoAtivo({ aoSalvar: pintar });
// Tocar num ativo vai para a página dele (#/ativo/<id>); registrar e editar são botões dela.
iniciarPaginaDoAtivo({
  aoRegistrar: (id) => janelaDoAtivo.abrir(id),
  aoEditar: (id) => janelaDoAtivo.editar(id),
});

const holerite = criarHolerite({
  janela: $('dialogo-holerite'),
  raiz: $('formulario-holerite'),
  aoSalvar: pintar,
});

const fila = criarFila({
  raiz: $('pendencias'),
  abrirPagamento: (cartaoId, centavos) => pagarFatura(cartaoId, centavos),
  abrirConferencia: (contaId) => conferencia.abrir(contaId),
  abrirHolerite: (folhaId, mes) => holerite.abrir(folhaId, mes),
});

async function pagarFatura(cartaoId, centavos) {
  await transferencia.pagarFatura({
    cartaoId,
    origemId: app.contas[cartaoId]?.pagaCom ?? null,
    centavos,
  });
  dialogoTransferencia.showModal();
  transferencia.focar();
}

document.addEventListener('click', async (e) => {
  const irTela = e.target.closest('[data-ir-tela]');
  if (irTela) {
    location.hash = `#/${irTela.dataset.irTela}`;
    return;
  }
  const ir = e.target.closest('[data-ir-conta]');
  if (ir) {
    irParaConta(ir.dataset.irConta, ir.dataset.irMes || null);
    return;
  }

  const pagar = e.target.closest('[data-pagar]');
  if (pagar) {
    await pagarFatura(pagar.dataset.pagar, Number(pagar.dataset.valor) || 0);
    return;
  }

  // O saldo do banco de uma dívida: um campo ali mesmo, sem janela.
  const foto = e.target.closest('[data-foto]');
  if (foto) {
    const lugar = foto.closest('[data-foto-de]');
    lugar.innerHTML = `<input type="text" inputmode="decimal" class="campo-fila" data-foto-valor placeholder="o que o banco mostra" aria-label="Valor de hoje">
      <button type="button" class="principal" data-foto-ok>ok</button>`;
    lugar.querySelector('input').focus();
    return;
  }
  const fotoOk = e.target.closest('[data-foto-ok]');
  if (fotoOk) {
    await salvarFoto(fotoOk.closest('[data-foto-de]'));
    return;
  }

  const detalhes = e.target.closest('[data-detalhes-divida]');
  if (detalhes) {
    const id = detalhes.dataset.detalhesDivida;
    if (detalhesAbertos.has(id)) {
      detalhesAbertos.delete(id);
      cronogramasAbertos.delete(id);
      if (amortizando === id) amortizando = null;
    } else {
      detalhesAbertos.add(id);
    }
    pintar();
    return;
  }
  const rapido = e.target.closest('[data-lancar-previsto]');
  if (rapido) {
    const o = previstosNaTela.get(rapido.dataset.lancarPrevisto);
    if (!o) return;
    rapido.disabled = true;
    // Futuro: cai hoje, na competência dele; vencido: na data dele.
    await lancarOcorrencia(o, { dataCaixa: o.dataCompetencia > hoje() ? hoje() : o.dataCompetencia });
    return;
  }
  const baixa = e.target.closest('[data-dar-baixa]');
  if (baixa) {
    const l = app.lancamentos[baixa.dataset.darBaixa];
    if (!l || l.removido || l.confirmado) return;
    baixa.disabled = true;
    // Agendado ou vencido que já está gravado: confirma. Futuro, cai hoje.
    await estado.aplicarEvento('lancamento.alterado', {
      id: l.id,
      confirmado: true,
      ...(l.dataCaixa > hoje() ? { dataCaixa: hoje() } : {}),
    });
    return;
  }
  const cron = e.target.closest('[data-cronograma]');
  if (cron) {
    const id = cron.dataset.cronograma;
    if (cronogramasAbertos.has(id)) cronogramasAbertos.delete(id); else cronogramasAbertos.add(id);
    pintar();
    return;
  }
  const amort = e.target.closest('[data-amortizar]');
  if (amort) {
    amortizando = amort.dataset.amortizar;
    await pintar();
    document.querySelector(`[data-amortizacao="${CSS.escape(amortizando)}"] [data-am-valor]`)?.focus();
    return;
  }
  if (e.target.closest('[data-am-cancelar]')) {
    amortizando = null;
    pintar();
    return;
  }
  const confirmar = e.target.closest('[data-am-confirmar]');
  if (confirmar) {
    const pedido = lerAmortizacao(confirmar.closest('[data-amortizacao]'));
    confirmar.disabled = true;
    amortizando = null;
    await amortizar(app, { ...pedido, modo: confirmar.dataset.amConfirmar });
    return;
  }
  const abrirAtivo = e.target.closest('[data-ativo-abrir]');
  if (abrirAtivo) {
    location.hash = `#/ativo/${abrirAtivo.dataset.ativoAbrir}`;
    return;
  }
  const novoAtivo = e.target.closest('[data-novo-ativo]');
  if (novoAtivo) {
    await janelaDoAtivo.novo(novoAtivo.dataset.novoAtivo);
    return;
  }
  const editarConta = e.target.closest('[data-editar-conta]');
  if (editarConta) {
    document.dispatchEvent(new CustomEvent('conta:editar', { detail: editarConta.dataset.editarConta }));
    return;
  }
  const corrigirDivida = e.target.closest('[data-corrigir-divida]');
  if (corrigirDivida) {
    document.dispatchEvent(new CustomEvent('divida:corrigir', { detail: corrigirDivida.dataset.corrigirDivida }));
    return;
  }

  const doHolerite = e.target.closest('[data-holerite]');
  if (doHolerite) {
    await holerite.abrir(doHolerite.dataset.holerite, doHolerite.dataset.mes ?? vista.mes);
    return;
  }

  const conferir = e.target.closest('[data-conferir]');
  if (conferir) {
    await conferencia.abrir(conferir.dataset.conferir);
    return;
  }

  const previsto = e.target.closest('[data-previsto]');
  if (previsto) {
    // A ocorrência abre a captura já preenchida; lançar amarra à série e o
    // previsto some (03-alimentacao §4).
    const o = previstosNaTela.get(previsto.dataset.previsto);
    if (!o) return;
    if (o.tipo === 'transferencia' || o.automatico) {
      transferencia.limpar();
      await transferencia.preencher(o);
      dialogoTransferencia.showModal();
      transferencia.focar();
      return;
    }
    formulario.limpar();
    await formulario.preencher(o);
    dialogo.showModal();
    formulario.focar();
    return;
  }

  const linha = e.target.closest('[data-lanc]');
  if (!linha) return;
  const l = app.lancamentos[linha.dataset.lanc];
  if (!l || l.removido) return;

  // Cada tipo volta pro formulário que sabe falar dele.
  if (ehDeInvestimento(l)) {
    await janelaDoAtivo.abrir(l.ativoId, l.tipo);
    return;
  }
  if (l.tipo === 'estorno') {
    await devolucao.abrir(l);
    return;
  }
  if (l.tipo === 'ajuste_caixa') {
    await conferencia.mostrarAjuste(l);
    return;
  }
  if (ehTransferencia(l)) {
    await transferencia.carregar(l);
    dialogoTransferencia.showModal();
    return;
  }
  await edicao.carregar(l);
  dialogoEdicao.showModal();
});

async function abrirTransferencia() {
  transferencia.limpar();
  transferencia.usarData(dataDaVista());
  await transferencia.recarregar();
  // A conta que está na tela vem escolhida: de onde sai — ou, numa conta de
  // investimento, para onde vai, que é o aporte. Trocar continua livre.
  const conta = app?.contas[contaEmFoco()];
  if (conta) transferencia.usarContas(conta.tipo === 'investimento' ? { destino: conta.id } : { origem: conta.id });
  dialogoTransferencia.showModal();
  transferencia.focar();
}

/** A conta que está na tela: a da aba escolhida, ou a única da área. Nenhuma no Geral. */
function contaEmFoco() {
  if (!app || !AREA) return null;
  if (vista.conta !== 'todas' && app.contas[vista.conta]) return vista.conta;
  const aba = ABAS.find((a) => a.id === AREA);
  const contas = aba ? contasDaAba(aba).filter((c) => !c.arquivada) : [];
  return contas.length === 1 ? contas[0].id : null;
}

$('b-transferir').addEventListener('click', abrirTransferencia);
// Importar extrato ou fatura (design/13 §3), já na conta da tela quando há uma.
const importacao = criarImportacao({ aoSalvar: pintar });
$('b-importar').addEventListener('click', () => importacao.abrir(contaDaVista()));
// Exportar o que está na tela: a planilha dos lançamentos, no mês e nos filtros em que se está.
$('b-exportar').addEventListener('click', () => {
  if (!linhasNaTela.length) return;
  const arquivo = new Blob([csvDosLancamentos(linhasNaTela)], { type: 'text/csv;charset=utf-8' });
  const quando = modoDaTela() === 'mes' ? vista.mes : `${intervalo().de}_a_${intervalo().ate}`;
  const ancora = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(arquivo),
    download: `lancamentos-${PAGINA}-${quando}.csv`,
  });
  document.body.append(ancora);
  ancora.click();
  ancora.remove();
  setTimeout(() => URL.revokeObjectURL(ancora.href), 10000);
});
$('b-fechar-edicao').addEventListener('click', () => dialogoEdicao.close());
$('b-fechar-transferencia').addEventListener('click', () => dialogoTransferencia.close());

async function abrir() {
  // Fora das telas de dinheiro (Envelopes, Relatórios…) o "+" da barra abre um
  // lançamento comum: a área e o mês da última tela de dinheiro não valem.
  if (!ativa) {
    formulario.limpar();
    await formulario.recarregar();
    formulario.usarData(hoje());
    dialogo.showModal();
    formulario.focar();
    return;
  }
  // Em Dívidas não se lança: o "+" e o N criam um empréstimo.
  if (AREA === 'dividas') {
    document.querySelector('[data-nova-conta]')?.click();
    return;
  }
  // Em Investimentos não há gasto nem receita: o "+" e o N aportam.
  if (AREA === 'investimentos') {
    abrirTransferencia();
    return;
  }
  formulario.limpar();
  await formulario.usarConta(contaDaVista());
  formulario.usarData(dataDaVista());
  dialogo.showModal();
  formulario.focar();
}

/**
 * A conta em que o "novo lançamento" abre: a da sub-aba (ou do filtro), se
 * houver uma em foco; senão, a mais usada da área — ou de todas, no Início e
 * em Lançamentos. Trocar continua livre na captura.
 */
function contaDaVista() {
  if (!app) return null;
  if (vista.conta !== 'todas' && app.contas[vista.conta]) return vista.conta;
  const area = AREA ?? (PAGINA === 'lancamentos' && vista.area !== 'todas' ? vista.area : null);
  const aba = ABAS.find((a) => a.id === area);
  const contas = (aba ? contasDaAba(aba) : Object.values(app.contas)).filter((c) => !c.arquivada);
  if (!contas.length) return null;
  const usos = new Map();
  for (const l of visiveis(app)) usos.set(l.contaId, (usos.get(l.contaId) ?? 0) + 1);
  return [...contas].sort((a, b) => (usos.get(b.id) ?? 0) - (usos.get(a.id) ?? 0))[0].id;
}

$('b-novo').addEventListener('click', abrir);
$('b-fechar').addEventListener('click', () => dialogo.close());

// ── sub-abas, filtros e período ───────────────────────────────────────────

// Os filtros de Lançamentos: a busca pinta enquanto se digita; o resto, ao
// escolher.
$('filtro-busca').addEventListener('input', () => {
  vista.busca = $('filtro-busca').value;
  pintar();
});
$('filtro-area').addEventListener('change', () => {
  vista.area = $('filtro-area').value;
  vista.conta = 'todas';
  pintar();
});
$('filtro-conta').addEventListener('change', () => {
  vista.conta = $('filtro-conta').value;
  pintar();
});
$('filtro-categoria').addEventListener('change', () => {
  vista.categoria = $('filtro-categoria').value;
  pintar();
});

$('subabas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-conta]');
  if (!b) return;
  vista.conta = b.dataset.conta;
  pintar();
});

function andarMes(quantos) {
  vista.mes = somarMeses(`${vista.mes}-01`, quantos).slice(0, 7);
  pintar();
}

$('p-antes').addEventListener('click', () => andarMes(-1));
$('p-depois').addEventListener('click', () => andarMes(1));

$('p-modo').addEventListener('click', () => {
  if (vista.modo === 'mes') {
    vista.modo = 'intervalo';
    // O intervalo nasce igual ao mês que estava na tela: trocar de modo não
    // pode trocar o que se vê.
    vista.de = `${vista.mes}-01`;
    vista.ate = fimDoMes(vista.de);
  } else {
    vista.modo = 'mes';
  }
  pintar();
});

for (const campo of ['p-de', 'p-ate']) {
  $(campo).addEventListener('change', () => {
    if (!$(campo).value) return;
    vista[campo === 'p-de' ? 'de' : 'ate'] = $(campo).value;
    pintar();
  });
}

async function salvarFoto(lugar) {
  const valor = Math.abs(deTexto(lugar.querySelector('[data-foto-valor]').value));
  if (!valor) return;
  await fotografar(lugar.dataset.fotoDe, valor);
}

document.addEventListener('keydown', async (e) => {
  const campo = e.target.closest?.('[data-foto-valor]');
  if (!campo || e.key !== 'Enter') return;
  e.preventDefault();
  await salvarFoto(campo.closest('[data-foto-de]'));
});

// Atalho global: lançar sem tirar a mão do teclado é o ponto do PC.
document.addEventListener('keydown', (e) => {
  if (!ativa || document.querySelector('dialog[open]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // O alvo pode ser o próprio document (que não tem `matches`), então a
  // verificação precisa ser à prova disso antes de perguntar o que ele é.
  const alvo = e.target;
  if (alvo instanceof Element && alvo.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); abrir(); }
  if ((e.key === 't' || e.key === 'T') && AREA !== 'dividas') { e.preventDefault(); abrirTransferencia(); }
});

// O "+" da barra de baixo do celular abre a captura da tela em que se está.
aoLancar(abrir);

// Veio do "completo" do térreo: abre o cadastro completo com o que já se
// tinha digitado lá (D30).
await continuarDoTerreo();
async function continuarDoTerreo() {
  let rascunho = null;
  try {
    rascunho = JSON.parse(sessionStorage.getItem('appfinancas:rascunho') ?? 'null');
    sessionStorage.removeItem('appfinancas:rascunho');
  } catch { return; }
  if (!rascunho) return;
  formulario.limpar();
  await formulario.continuar(rascunho);
  dialogo.showModal();
  formulario.focar();
}

// A rota manda: entrar numa tela de dinheiro pinta; sair dela, para.
document.addEventListener('app:tela', (e) => {
  ativa = e.detail.grupo === 'dinheiro';
  if (ativa) entrar(e.detail.tela);
  else {
    $('subabas').hidden = true;
    abasNoTopo(false);
    // O + e o transferir voltam para a caixa: no cabeçalho só vivem na página inicial.
    document.querySelector('.linha-topo-painel')?.append($('barra-acoes'));
  }
});
estado.aoAplicar(() => pintar());
