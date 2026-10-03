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
import { aoLancar } from './app/pagina.js';
import { enderecoDa } from './app/rotas.js';
import { BARRA, PRINCIPAL, DIALOGOS } from './app/marcacao-dinheiro.js';
import { rendaDisponivel } from './core/holerite.js';
import {
  visiveis, porDataDecrescente, estadoDoLancamento, saldoReal, nomeDaCategoria,
  sinalDeSaida, ehTransferencia, dataVista, estornado,
} from './core/lancamentos.js';
import { temCiclo } from './core/cartao.js';
import { AREAS as ABAS } from './app/areas.js';
import {
  faturas, resumoDoCartao, saldoPrevisto, ocorrenciasPrevistas,
} from './core/previsto.js';
import {
  hoje, inicioDoMes, fimDoMes, somarMeses, nomeDoMes, diaCurto,
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

/** Entra numa tela de dinheiro: troca o foco e pinta. */
function entrar(pagina) {
  if (PAGINA && PAGINA !== pagina) guardarVista();
  PAGINA = pagina;
  AREA = AREA_DA_PAGINA[pagina] ?? null;
  Object.assign(vista, FOCO_PADRAO, focos[pagina] ?? lerGuardado(chaveDaTela(pagina)));
  vista.aba = AREA ?? 'caixa';
  return pintar();
}

function intervalo() {
  if (vista.modo === 'intervalo' && vista.de && vista.ate) {
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

async function pintar() {
  if (!ativa) return;
  app = await estado.calcular();
  previstosNaTela.clear();
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
    else pintarResumoDeSaldos(aba, foco);
    pintarLista(aba, foco);
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
  delete $('painel').dataset.area;
  delete $('barra-acoes').dataset.area;

  const blocos = [];
  for (const area of ABAS) {
    const contas = contasDaAba(area);
    if (!contas.length) continue;
    blocos.push(cartaoDoInicio(area, contas));
  }
  $('resumo').innerHTML = blocos.length
    ? `<div class="blocos">${blocos.join('')}</div>`
    : `<p class="vazio">Nada por aqui ainda. Comece criando uma conta em <a href="${enderecoDa('contas')}">Contas</a> e as categorias em <a href="${enderecoDa('configuracoes')}">Configurações</a>.</p>`;
  guardarVista();
}

/** Um cartão por área, com o número que importa nela, levando à tela dela. */
function cartaoDoInicio(area, contas) {
  const linhas = [];
  if (area.id === 'caixa') {
    const ps = contas.map((c) => saldoPrevisto(app, c.id));
    const real = ps.reduce((t, p) => t + p.real, 0);
    const previsto = ps.reduce((t, p) => t + p.previsto, 0);
    const estimado = ps.some((p) => p.estimado);
    linhas.push(linhaDeResumo('saldo real', dinheiroHTML(real), real < 0 ? 'negativo' : ''));
    linhas.push(linhaDeResumo(`previsto até ${diaCurto(ps[0].ate)}`, dinheiroHTML(previsto, { estimado }), previsto < 0 ? 'negativo' : ''));
  }
  if (area.id === 'cartoes') {
    let aberta = 0;
    let fechada = 0;
    for (const c of contas) {
      const r = resumoDoCartao(app, c.id);
      if (!r) continue;
      aberta += r.aberta?.aPagar ?? 0;
      fechada += r.fechada?.aPagar ?? 0;
    }
    if (fechada) linhas.push(linhaDeResumo('faturas fechadas a pagar', dinheiroHTML(fechada), 'negativo'));
    linhas.push(linhaDeResumo('faturas abertas', dinheiroHTML(aberta)));
  }
  if (area.id === 'folha') {
    const mes = hoje().slice(0, 7);
    const doMes = visiveis(app).filter(
      (l) => contas.some((c) => c.id === l.contaId) && l.dataCompetencia.slice(0, 7) === mes
    );
    linhas.push(linhaDeResumo(`renda disponível de ${nomeDoMes(mes).split(' ')[0]}`, dinheiroHTML(rendaDisponivel(app, doMes))));
    const faltam = contas.filter((c) => linhasDoHolerite(app, c.id, mes).some((l) => !l.automatico)).length;
    if (faltam) linhas.push(linhaDeResumo('holerites a lançar', String(faltam), 'abate'));
  }
  if (area.id === 'investimentos') {
    const total = contas.reduce((t, c) => t + saldoReal(app, c.id), 0);
    linhas.push(linhaDeResumo('total', dinheiroHTML(total)));
  }
  if (area.id === 'dividas') {
    const total = contas.reduce((t, c) => t + (saldoDevedor(app, c.id) ?? 0), 0);
    linhas.push(linhaDeResumo('saldo devedor', dinheiroHTML(total, { estimado: contas.some((c) => situacao(app, c.id)?.estimado) })));
  }
  const titulo = { caixa: 'Contas', cartoes: 'Cartões', folha: 'Renda', investimentos: 'Investimentos', dividas: 'Dívidas' }[area.id];
  return `<a class="bloco bloco-link" href="${enderecoDa(PAGINA_DA_AREA[area.id])}" data-area="${area.id}">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(titulo)}</p>
    <dl>${linhas.join('')}</dl>
  </a>`;
}

// ── Lançamentos: a lista única (R1), com busca e filtros ──────────────────

function pintarLancamentos() {
  $('subabas').hidden = true;
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
    .sort((a, b) => (a.nome.toLocaleLowerCase('pt-BR') < b.nome.toLocaleLowerCase('pt-BR') ? -1 : 1));
}

function pintarSubabas(contas) {
  // Com uma conta só, "todas" e ela são a mesma coisa: a sub-aba sairia de
  // enfeite.
  $('subabas').hidden = contas.length < 2;
  $('subabas').innerHTML = [{ id: 'todas', nome: 'Todas' }, ...contas]
    .map(
      (c) => `<button type="button" data-conta="${escapar(c.id)}" aria-pressed="${c.id === vista.conta}">${escapar(c.nome)}</button>`
    )
    .join('');
}

function pintarPeriodo() {
  const porMes = vista.modo === 'mes';
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
 * Em caixa: o saldo real e, aberto em linhas, o saldo previsto — o número
 * sozinho não é crível (08-telas §6). O previsto é sempre o de hoje até o fim
 * do mês corrente, qualquer que seja o período da lista.
 */
function pintarResumoDeCaixa(contas) {
  const previstos = contas.map((c) => ({ conta: c, p: saldoPrevisto(app, c.id) }));
  const blocos = previstos.map(({ conta, p }) => blocoDeCaixa(conta.nome, p, false, conta));

  if (previstos.length > 1) {
    const soma = {
      real: previstos.reduce((t, x) => t + x.p.real, 0),
      faturas: [{ cartao: { nome: 'faturas' }, valor: previstos.reduce((t, x) => t + x.p.faturas.reduce((u, f) => u + f.valor, 0), 0) }]
        .filter((f) => f.valor > 0),
      aSair: previstos.reduce((t, x) => t + x.p.aSair, 0),
      ate: previstos[0].p.ate,
      estimado: previstos.some((x) => x.p.estimado),
      previsto: previstos.reduce((t, x) => t + x.p.previsto, 0),
    };
    blocos.unshift(blocoDeCaixa('em caixa', soma, true));
  }
  $('resumo').innerHTML = `<div class="blocos">${blocos.join('')}</div>`;
}

function blocoDeCaixa(nome, p, total = false, conta = null) {
  const linhas = [
    linhaDeResumo('saldo real', dinheiroHTML(p.real), p.real < 0 ? 'negativo' : ''),
    ...p.faturas.map((f) =>
      linhaDeResumo(total ? f.cartao.nome : `fatura ${f.cartao.nome}`, dinheiroHTML(-f.valor), 'abate')
    ),
  ];
  if (p.aSair > 0) {
    linhas.push(
      linhaDeResumo(`recorrentes e agendados até ${diaCurto(p.ate)}`, dinheiroHTML(-p.aSair, { estimado: p.estimado }), 'abate')
    );
  }
  const temPrevisao = p.faturas.length || p.aSair > 0;
  if (temPrevisao) {
    linhas.push(
      linhaDeResumo('saldo previsto', dinheiroHTML(p.previsto, { estimado: p.estimado }),
        `fecho ${p.previsto < 0 ? 'negativo' : ''}`)
    );
  }
  // Conferir com o banco (ou a carteira) mora na própria conta (03 §8).
  const pe = conta
    ? `<div class="pe-bloco"><span class="fino">${conta.conferidaEm ? `conferida em ${diaCurto(conta.conferidaEm)}` : 'nunca conferida'}</span>
        <button type="button" class="elo" data-conferir="${escapar(conta.id)}">conferir</button></div>`
    : '';
  return `<div class="bloco ${total ? 'total' : ''}">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(nome)}</p>
    <dl>${linhas.join('')}</dl>
    ${pe}
  </div>`;
}

const linhaDeResumo = (rotulo, valorHTML, classe = '') =>
  `<div class="linha-resumo ${classe}"><dt>${escapar(rotulo)}</dt><dd>${valorHTML}</dd></div>`;

/** Cartões: nunca "saldo" — fatura aberta, fatura fechada e limite livre. */
function pintarResumoDeCartoes(cartoes) {
  $('resumo').innerHTML = `<div class="blocos">${cartoes.map(blocoDeCartao).join('')}</div>`;
}

function blocoDeCartao(c) {
  const pagadora = app.contas[c.pagaCom];
  const rodape = pagadora
    ? `paga com ${escapar(pagadora.nome)}`
    : 'sem conta que paga — <a href="#gestao">defina o “paga com”</a> pra fatura pesar no saldo previsto';

  if (!temCiclo(c)) {
    return `<div class="bloco">
      <p class="nome-bloco">${escapar(c.nome)}</p>
      <p class="aviso-bloco">Sem dia de fechamento e de vencimento, o app não sabe a qual
        fatura cada compra pertence. <a href="#gestao">Defina o ciclo em "Seus cartões"</a>.</p>
      <dl>${linhaDeResumo('em aberto', dinheiroHTML(saldoReal(app, c.id)), saldoReal(app, c.id) < 0 ? 'negativo' : '')}</dl>
    </div>`;
  }

  const r = resumoDoCartao(app, c.id);
  const linhas = [];
  if (r.fechada) {
    linhas.push(
      linhaDeResumo(
        r.fechada.atrasada ? `fatura fechada · venceu ${diaCurto(r.fechada.vencimento)}` : `fatura fechada · vence ${diaCurto(r.fechada.vencimento)}`,
        dinheiroHTML(r.fechada.aPagar),
        'negativo'
      )
    );
  }
  linhas.push(
    linhaDeResumo(
      `fatura aberta · fecha ${diaCurto(r.aberta.fechamento)} · vence ${diaCurto(r.aberta.vencimento)}`,
      dinheiroHTML(r.aberta.aPagar)
    )
  );
  if (r.limiteLivre !== null) {
    linhas.push(linhaDeResumo('limite livre', dinheiroHTML(r.limiteLivre), r.limiteLivre < 0 ? 'negativo' : ''));
  }

  const aPagar = r.fechada?.aPagar || r.aberta.aPagar;
  return `<div class="bloco">
    <p class="nome-bloco">${escapar(c.nome)}</p>
    <dl>${linhas.join('')}</dl>
    <div class="pe-bloco">
      <span class="fino">${rodape}</span>
      <button type="button" class="principal" data-pagar="${escapar(c.id)}" data-valor="${aPagar}"
        ${aPagar > 0 ? '' : 'disabled'}>Pagar fatura</button>
    </div>
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
  const situacaoDaFolha = feito
    ? `holerite de ${escapar(nome)} lançado`
    : faltam
      ? `${faltam} linha${faltam > 1 ? 's' : ''} prevista${faltam > 1 ? 's' : ''}`
      : aberta ? 'a folha não fechou' : 'sem linhas previstas';
  return `<div class="pe-bloco">
    <span class="fino">${situacaoDaFolha}</span>
    <button type="button" class="${feito ? 'elo' : 'principal'}" data-holerite="${escapar(c.id)}">${feito ? 'linha a mais' : `Lançar holerite de ${escapar(nome)}`}</button>
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

const numeroDaFaixa = (rotulo, valor) =>
  `<div class="numero-faixa"><span class="rotulo-numero">${escapar(rotulo)}</span><span class="valor-numero">${escapar(valor)}</span></div>`;

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
  const blocos = contas.map((c) => {
    const saldo = saldoReal(app, c.id);
    const aviso =
      aba.id === 'folha' && saldo !== 0
        ? '<p class="aviso-bloco">Depois do holerite completo, a folha volta a zero. Diferente de zero é desconto esquecido.</p>'
        : '';
    return `<div class="bloco">
      <p class="nome-bloco">${escapar(c.nome)}</p>
      <dl>${linhaDeResumo(aba.id === 'dividas' ? 'saldo devedor' : 'saldo', dinheiroHTML(saldo), saldo < 0 ? 'negativo' : '')}</dl>
      ${aviso}
      ${aba.id === 'folha' ? peDaFolha(c) : ''}
    </div>`;
  });
  if (contas.length > 1 && aba.id !== 'folha') {
    const soma = contas.reduce((t, c) => t + saldoReal(app, c.id), 0);
    blocos.unshift(`<div class="bloco total">
      <p class="nome-bloco">${escapar(aba.titulo.toLowerCase())}</p>
      <dl>${linhaDeResumo('total', dinheiroHTML(soma), soma < 0 ? 'negativo' : '')}</dl>
    </div>`);
  }
  $('resumo').innerHTML = `<div class="blocos">${blocos.join('')}</div>`;
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

  const linhas = visiveis(app).filter(
    (l) => (ids.has(l.contaId) || ids.has(l.contaDestinoId)) && noPeriodo(l.dataCaixa)
  );

  for (const o of ocorrenciasPrevistas(app, de, ate)) {
    if ((ids.has(o.contaId) || ids.has(o.contaDestinoId)) && noPeriodo(o.dataCaixa)) linhas.push(o);
  }

  if (aba.id === 'caixa') {
    for (const cartao of Object.values(app.contas)) {
      if (cartao.tipo !== 'cartao' || !ids.has(cartao.pagaCom)) continue;
      for (const f of faturas(app, cartao.id) ?? []) {
        if (f.aPagar <= 0 || !noPeriodo(f.vencimento)) continue;
        linhas.push({
          id: `fatura:${cartao.id}:${f.fechamento}`,
          fatura: f,
          cartaoId: cartao.id,
          tipo: 'pagamento_fatura',
          valor: f.aPagar,
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
  let pago = 0;

  for (const c of cartoes) {
    const pagamentos = visiveis(app).filter((l) => l.contaDestinoId === c.id && noPeriodo(l.dataCaixa));
    pago += pagamentos.reduce((t, l) => t + l.valor, 0);

    if (!temCiclo(c) || vista.modo === 'intervalo') {
      const compras = [
        ...visiveis(app).filter((l) => l.contaId === c.id && noPeriodo(dataVista(l))),
        ...previstas.filter((o) => o.contaId === c.id && noPeriodo(o.dataCompetencia)),
      ];
      total += compras.reduce((t, l) => t + sinalDeSaida(l), 0);
      if (!compras.length && !pagamentos.length) continue;
      html.push(`<li class="grupo">${escapar(c.nome)}</li>`);
      html.push(...ordenarPelaCompra([...compras, ...pagamentos]).map((l) => linhaHTML(l, new Set([c.id]))));
      continue;
    }

    for (const f of faturas(app, c.id)) {
      if (f.vencimento.slice(0, 7) !== vista.mes) continue;
      const projetadas = previstas.filter((o) => o.contaId === c.id && o.cicloFatura === f.fechamento);
      total += f.total + projetadas.reduce((t, o) => t + sinalDeSaida(o), 0);
      const situacao =
        f.situacao === 'aberta' ? 'aberta' : f.situacao === 'futura' ? 'por vir' : f.aPagar > 0 ? 'fechada' : 'paga';
      html.push(`<li class="grupo">
        <span>${escapar(c.nome)} · fatura de ${escapar(nomeDoMes(vista.mes).split(' ')[0])}
          <span class="fino">fecha ${diaCurto(f.fechamento)} · vence ${diaCurto(f.vencimento)} · ${situacao}</span></span>
        <span class="valor-grupo">${dinheiroHTML(f.total)}${f.pago && f.aPagar ? ` <span class="fino">falta ${dinheiroHTML(f.aPagar)}</span>` : ''}</span>
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
  if (total) partes.push(`compras ${dinheiroHTML(total)}`);
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
  const transferencia = ehTransferencia(l);
  const ajuste = l.tipo === 'ajuste_caixa';
  const devolucao = l.tipo === 'estorno';
  const entrada = !transferencia && !ajuste && sinalDeSaida(l) < 0;

  // Devolução é despesa que se desfez, nunca receita (03 §3.3): marca própria,
  // na cor da entrada de dinheiro. Ajuste de caixa não é gasto nem ganho.
  const tom = transferencia ? 'transferencia' : ajuste ? 'ajuste' : devolucao ? 'receita' : entrada ? 'receita' : 'despesa';
  const marca = transferencia ? '→' : ajuste ? '≈' : devolucao ? '↩' : entrada ? '↑' : '↓';
  const nomeDoTom =
    l.tipo === 'pagamento_fatura' ? 'Pagamento de fatura'
      : transferencia ? 'Transferência'
        : ajuste ? 'Ajuste de caixa'
          : devolucao ? 'Devolução'
            : entrada ? 'Receita' : 'Despesa';

  // Na transferência e no ajuste o sinal diz se o dinheiro saiu ou entrou no foco.
  const d = direcao(l, ids);
  const sinal = transferencia || ajuste ? (d === 'entra' ? '+' : d === 'sai' ? '−' : '') : entrada ? '+' : '−';

  const destino = app.contas[l.contaDestinoId];
  const detalhe = l.detalheId ? app.detalhes?.[l.detalheId]?.nome : null;
  let oque;
  let onde;
  if (l.fatura) {
    oque = `Fatura ${destino?.nome ?? ''}`;
    onde = `${conta?.nome ?? '—'} · fecha ${diaCurto(l.fatura.fechamento)}`;
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
  } else {
    oque = [nomeDaCategoria(app, l.categoriaId) || l.tipo, detalhe].filter(Boolean).join(' · ');
    onde = conta?.nome ?? '—';
    // A compra mostra o que já voltou dela (03 §3.3).
    const voltou = l.tipo === 'despesa' && !l.projetado ? estornado(app, l.id) : 0;
    if (voltou) onde += ` · devolvido ${formatar(voltou)} de ${formatar(l.valor)}`;
  }
  const rotuloEstado = (l.corrigida ? ' · corrigida' : '') +
    (est === 'realizado' ? (l.automatico ? ' · automática' : '') : ` · ${l.projetado ? 'previsto' : est}`);

  const parcela = l.parcela ? `<span class="parcela">${l.parcela.numero}/${l.parcela.total}</span>` : '';
  const etiquetas = (l.etiquetas ?? [])
    .map((t) => app.etiquetas?.[t]?.nome)
    .filter(Boolean)
    .map((e) => `<span class="etiqueta">${escapar(e)}</span>`)
    .join('');
  const dia = dataVista(l);
  const saldo = saldoApos?.has(l.id)
    ? `<span class="saldo-apos ${saldoApos.get(l.id) < 0 ? 'negativo' : ''}">${dinheiroHTML(saldoApos.get(l.id))}</span>`
    : '<span class="saldo-apos"></span>';

  // A parcela automática de uma dívida não é gravada: tocada, abre a
  // correção daquela parcela (design/10 §4.4).
  if (l.projetado || l.automatico) previstosNaTela.set(l.id, l);
  const alvo = l.fatura
    ? `data-pagar="${escapar(l.cartaoId)}" data-valor="${l.valor}"`
    : l.projetado || l.automatico
      ? `data-previsto="${escapar(l.id)}"`
      : `data-lanc="${escapar(l.id)}"`;
  const acao = l.fatura ? 'Pagar' : l.automatico ? 'Corrigir' : l.projetado ? 'Lançar' : 'Corrigir';

  return `<li><button type="button" class="linha ${tom} ${est === 'realizado' ? '' : est} ${saldoApos ? 'com-saldo' : ''}"
      ${alvo} aria-label="${acao} ${escapar(nomeDoTom.toLowerCase())} de ${escapar(diaCurto(dia))}">
    <span class="marca" title="${nomeDoTom}" aria-hidden="true">${marca}</span>
    <span class="quando">${escapar(diaCurto(dia))}</span>
    <span class="oque">
      <span class="cat">${escapar(oque)}${parcela}${etiquetas}</span>
      <span class="onde">${escapar(onde)}${rotuloEstado}</span>
    </span>
    <span class="quanto ${tom}">${dinheiroHTML(l.valor, { sinal, estimado: Boolean(l.estimado) })}</span>
    ${saldoApos ? saldo : ''}
  </button></li>`;
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
  acoes: [
    { id: 'nova', rotulo: 'Salvar e nova', principal: true, fecha: false },
    { id: 'fechar', rotulo: 'Salvar e fechar', fecha: true },
  ],
  aoSalvar: pintar,
  aoFechar: () => dialogo.close(),
});

// Corrigir e apagar são do andar de cima, nunca do térreo (D11) — então vivem
// aqui, no extrato, e não na captura. O formulário é o mesmo (design/03 §9).
const dialogoEdicao = $('dialogo-edicao');

const edicao = await criarFormulario({
  raiz: $('formulario-edicao'),
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
  aoSalvar: pintar,
  aoFechar: () => dialogoTransferencia.close(),
  aoMudarTitulo: (titulo) => { $('titulo-transferencia').textContent = titulo; },
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
  const pagar = e.target.closest('[data-pagar]');
  if (pagar) {
    await pagarFatura(pagar.dataset.pagar, Number(pagar.dataset.valor) || 0);
    return;
  }

  // O saldo do banco de uma dívida: um campo ali mesmo, sem janela.
  const foto = e.target.closest('[data-foto]');
  if (foto) {
    const lugar = foto.closest('[data-foto-de]');
    lugar.innerHTML = `<input type="text" inputmode="decimal" class="campo-fila" data-foto-valor placeholder="o que o banco mostra" aria-label="Saldo devedor de hoje">
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
  const corrigirDivida = e.target.closest('[data-corrigir-divida]');
  if (corrigirDivida) {
    document.dispatchEvent(new CustomEvent('divida:corrigir', { detail: corrigirDivida.dataset.corrigirDivida }));
    return;
  }

  const doHolerite = e.target.closest('[data-holerite]');
  if (doHolerite) {
    await holerite.abrir(doHolerite.dataset.holerite, vista.mes);
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

function abrirTransferencia() {
  transferencia.limpar();
  transferencia.recarregar();
  dialogoTransferencia.showModal();
  transferencia.focar();
}

$('b-transferir').addEventListener('click', abrirTransferencia);
$('b-fechar-edicao').addEventListener('click', () => dialogoEdicao.close());
$('b-fechar-transferencia').addEventListener('click', () => dialogoTransferencia.close());

async function abrir() {
  // Em Dívidas não se lança: o "+" e o N criam um empréstimo.
  if (AREA === 'dividas') {
    $('b-nova-conta')?.click();
    return;
  }
  formulario.limpar();
  await formulario.usarConta(contaDaVista());
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
  if (document.querySelector('dialog[open]')) return;
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

// A rota manda: entrar numa tela de dinheiro pinta; sair dela, para.
document.addEventListener('app:tela', (e) => {
  ativa = e.detail.grupo === 'dinheiro';
  if (ativa) entrar(e.detail.tela);
});
estado.aoAplicar(() => pintar());
