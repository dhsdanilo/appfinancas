// A área Envelopes (design/11 §5 e §5.1, D34): de quem é o dinheiro guardado.
//
// Mesmo padrão dos Relatórios: número → gráfico → lista. Geral: o guardado,
// a evolução de todos (aportado × rendimento), os envelopes com a barra até o
// alvo e o sem dono numa linha que abre. A aba de um envelope: o que tem, a
// barra, a evolução dele, as ações, onde está, o que já pagou e o extrato.

import * as estado from './core/estado.js';
import { formatar } from './core/dinheiro.js';
import { hoje, diaCurto, nomeDoMes } from './core/datas.js';
import {
  envelopesAtivos, ehProjeto, donosNoDia, numerosDoEnvelope, nomeDoLugar, estadoDoEnvelope, evolucaoDosEnvelopes,
} from './core/envelopes.js';
import { nomeDaCategoria } from './core/lancamentos.js';
import { periodo as periodoDe, PERIODOS } from './core/explorar.js';
import { criarJanelasDeEnvelope } from './app/envelope.js';
import { criarJanelasDeUso } from './app/envelope-uso.js';
import { areas, pizza, cor } from './app/graficos.js';
import { ICONES } from './app/marcacao-dinheiro.js';
import { iniciaisDaConta, corDaConta } from './core/ordem.js';

// As abas dos envelopes sobem para o cabeçalho, como as das contas (06/10/2026).
document.querySelector('.topo .identidade')?.append(document.getElementById('subabas-envelopes'));
const abasNoTopo = (sim) => document.body.classList.toggle('abas-no-topo', sim);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mesAno = (dia) => `${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
const pct = (v) => `${Math.round(v * 100)}%`;
const comSinal = (v) => `${v >= 0 ? '+' : '−'}${formatar(Math.abs(v))}`;
const dataCheia = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
const mesCurto = (mes) => `${nomeDoMes(mes).split(' ')[0].slice(0, 3)}/${mes.slice(2, 4)}`;

let ativa = false;
let foco = 'geral';
let app = null;
// O período do gráfico de evolução (flexível, como nos Relatórios), o sem
// dono aberto, o "aportar" aberto e o extrato inteiro.
const vista = { periodo: '12', tempo: 'mes', semDonoAberto: false, aportarAberto: false, extratoInteiro: false };
let evolucao = [];

const janelas = criarJanelasDeEnvelope({ aoSalvar: () => pintar() });
const uso = criarJanelasDeUso({ aoSalvar: () => pintar() });

/** O lugar com o nome que se reconhece: "CDB · Banco", "Corrente". */
function nomeCompleto(lugarId) {
  const a = app.ativos?.[lugarId];
  return a ? `${a.nome} · ${app.contas[a.contaId]?.nome ?? ''}` : nomeDoLugar(app, lugarId);
}

async function pintar() {
  if (!ativa) return;
  app = await estado.calcular();
  document.body.dataset.area = 'envelopes';
  const lista = envelopesAtivos(app);
  const todos = envelopesAtivos(app, { comArquivados: true, comEncerrados: true });
  const arquivados = todos.filter((v) => v.arquivado);
  const encerrados = todos.filter((v) => v.encerradoEm && !v.arquivado);
  if (foco !== 'geral' && !app.envelopes?.[foco]) foco = 'geral';

  // O encerrado ou arquivado aberto ganha aba enquanto está à vista.
  const abas = foco !== 'geral' && !lista.some((v) => v.id === foco) ? [...lista, app.envelopes[foco]] : lista;
  $('subabas-envelopes').hidden = false;
  abasNoTopo(true);
  $('subabas-envelopes').innerHTML = [{ id: 'geral', nome: 'Envelopes' }, ...abas]
    .map((v) => {
      const icone = v.id === 'geral'
        ? `<span class="ic ic-geral">${ICONES.geral}</span>`
        : `<span class="ic" style="background:${corDaConta(v.nome)}">${esc(iniciaisDaConta(v.nome))}</span>`;
      return `<button type="button" class="aba-conta" data-env-aba="${esc(v.id)}" aria-pressed="${v.id === foco}">${icone}<span class="nome">${esc(v.nome)}</span></button>`;
    })
    .join('') + `<button type="button" class="nova-conta" data-novo-envelope title="Novo envelope" aria-label="Novo envelope">${ICONES.mais}</button>`;

  const donos = donosNoDia(app);
  if (!lista.length && foco === 'geral') {
    $('corpo-envelopes').innerHTML = `<p class="vazio">Envelope é dinheiro guardado que já tem dono: a reserva de emergência, a aposentadoria,
      o IPVA do ano, a viagem. Nada sai do lugar — o dinheiro continua no CDB ou na corrente, e cada pedaço ganha dono.
      Comece pelo botão "Novo envelope".</p>`;
    return;
  }
  const ids = foco === 'geral' ? lista.map((v) => v.id) : [foco];
  evolucao = evolucaoDosEnvelopes(app, ids, periodoDe(app, vista.periodo).meses, vista.tempo);
  $('corpo-envelopes').innerHTML = foco === 'geral' ? geral(lista, donos) : doEnvelope(app.envelopes[foco], donos);
  desenharEvolucao();
  if (foco !== 'geral') desenharOnde(donos);
  if (foco === 'geral' && (encerrados.length || arquivados.length)) {
    $('corpo-envelopes').insertAdjacentHTML('beforeend', `<p class="arquivadas-area fino">${[
      encerrados.length ? `encerrados: ${encerrados.map((v) => `<button type="button" class="elo" data-env-aba="${esc(v.id)}">${esc(v.nome)}</button>`).join(' · ')}` : '',
      arquivados.length ? `arquivados: ${arquivados.map((v) => `<button type="button" class="elo" data-env-editar="${esc(v.id)}">${esc(v.nome)}</button>`).join(' · ')}` : '',
    ].filter(Boolean).join(' — ')}</p>`);
  }
}

// ── peças comuns ──────────────────────────────────────────────────────────

/** A barra até o alvo; sem alvo, nada. */
function barraDoAlvo(tem, alvo, fina = false) {
  if (!alvo) return '';
  const p = Math.max(0, Math.min(1, tem / alvo));
  return `<span class="barra-alvo ${fina ? 'fina' : ''}" role="img" aria-label="${pct(p)} do alvo"><i style="width:${(p * 100).toFixed(1)}%"></i></span>`;
}

/** A frase de um envelope, só quando diz algo: atrasado, completo, em uso. */
function frase(v, r, n) {
  const situacao = estadoDoEnvelope(v, r);
  if (situacao === 'em uso') return { texto: `em uso · já pagou ${formatar(r.custo)}`, classe: '' };
  if (n.completo) return { texto: 'completo ✓', classe: 'bom' };
  if (n.deveriaTer != null && r.total < n.deveriaTer) return { texto: `atrasado: no ritmo, deveria ter ${formatar(n.deveriaTer)}`, classe: 'ruim' };
  if (ehProjeto(v) && n.alvo) return { texto: `de ${formatar(n.alvo)} até ${mesAno(v.alvoData)}`, classe: '' };
  if (n.alvo) return { texto: `de ${formatar(n.alvo)}`, classe: '' };
  return { texto: '', classe: '' };
}

/** O período do gráfico: os mesmos botões dos Relatórios. */
function controlesDaEvolucao() {
  const chips = (dado, opcoes, atual) => `<span class="chips-periodo inline" role="group">${opcoes.map(([v, nome]) =>
    `<button type="button" data-${dado}="${v}" aria-pressed="${v === atual}">${esc(nome)}</button>`).join('')}</span>`;
  return `<div class="controles-rel">
      ${chips('env-periodo', PERIODOS.filter(([v]) => v !== 'mes'), vista.periodo)}
      ${chips('env-tempo', [['mes', 'por mês'], ['ano', 'por ano']], vista.tempo)}
    </div>
    <div class="grafico-rel" id="g-evolucao"></div>`;
}

/** Aportado embaixo, rendimento por cima, o total na linha; rendimento negativo abaixo do zero. */
function desenharEvolucao() {
  const raiz = $('g-evolucao');
  if (!raiz) return;
  if (evolucao.length < 2) {
    raiz.innerHTML = `<p class="nota-rel">${evolucao.length ? 'A evolução aparece com dois pontos — escolha um período maior ou "por mês".' : 'A evolução aparece depois do primeiro aporte.'}</p>`;
    return;
  }
  const ultimo = evolucao.length - 1;
  // "perdeu" só existe na legenda quando algum ponto perdeu.
  const perdeu = evolucao.some((p) => p.rendeu < 0);
  areas(raiz, {
    pontos: evolucao.map((p, i) => ({
      rotulo: i === ultimo && p.dia === hoje() ? 'hoje' : (p.balde.length === 4 ? p.balde : mesCurto(p.balde)),
      acima: [Math.max(0, p.aportado), Math.max(0, p.rendeu)],
      abaixo: perdeu ? [Math.max(0, -p.rendeu)] : [],
      linha: p.total,
      dica: `<strong>${formatar(p.total)}</strong><span>${i === ultimo && p.dia === hoje() ? 'hoje' : `fim de ${p.balde.length === 4 ? p.balde : nomeDoMes(p.balde)}`}</span>
        <span class="fino">aportado ${formatar(p.aportado)}</span><span class="fino">rendimento ${comSinal(p.rendeu)}</span>`,
    })),
    acima: [{ nome: 'aportado', cor: cor(1) }, { nome: 'rendimento', cor: cor(3) }],
    abaixo: perdeu ? [{ nome: 'perdeu', cor: cor(2) }] : [],
    linha: { nome: 'total', cor: 'var(--tinta)' },
    formatar: (v) => {
      const abs = Math.abs(v / 100);
      return `${v < 0 ? '−' : ''}${abs >= 1000 ? `${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: abs >= 10000 ? 0 : 1 })} mil` : Math.round(abs).toLocaleString('pt-BR')}`;
    },
  });
}

// ── Geral ─────────────────────────────────────────────────────────────────

function geral(lista, donos) {
  const guardado = lista.reduce((t, v) => t + (donos.porEnvelope.get(v.id)?.total ?? 0), 0);
  const aportado = lista.reduce((t, v) => t + (donos.porEnvelope.get(v.id)?.posto ?? 0), 0);
  const lugares = [...donos.porLugar.values()].filter((x) => !x.lugar.arquivado || x.semDono);
  const furos = lugares.filter((x) => x.semDono < 0);

  const linhas = lista.map((v) => {
    const r = donos.porEnvelope.get(v.id) ?? { total: 0 };
    const n = numerosDoEnvelope(v, r.total);
    const f = frase(v, r, n);
    return `<button type="button" class="linha-envelope" data-env-aba="${esc(v.id)}">
      <span class="nome-envelope">${esc(v.nome)}</span>
      <span class="valor-envelope">${formatar(r.total)}</span>
      ${barraDoAlvo(r.total, n.alvo, true)}
      ${f.texto ? `<span class="frase-envelope ${f.classe}">${esc(f.texto)}</span>` : ''}
    </button>`;
  }).join('');

  return `<div class="numero-rel">
      <p class="rotulo-numero">guardado nos envelopes</p>
      <p class="valor-rel-grande">${formatar(guardado)}</p>
      <p class="nota-rel">${formatar(aportado)} aportados · <span class="dif-rel ${guardado - aportado >= 0 ? 'bom' : 'ruim'}">${comSinal(guardado - aportado)}</span> de rendimento</p>
    </div>
    ${furos.length ? `<p class="aviso-bloco">${furos.map((x) => `${esc(nomeCompleto(x.lugar.id))} tem ${formatar(x.valor)}, e os envelopes dizem ter ${formatar(x.valor - x.semDono)} ali`).join('; ')}: gastou-se dinheiro de envelope sem dizer de qual. Tire do envelope o que foi gasto.</p>` : ''}
    ${controlesDaEvolucao()}
    <div class="lista-envelopes">${linhas}</div>
    ${semDonoHTML(lugares, donos.semDono)}`;
}

/** O sem dono: uma linha que abre a lista dos lugares, com o "distribuir" de cada um (§3.1). */
function semDonoHTML(lugares, total) {
  const comAlgo = lugares.filter((x) => x.semDono !== 0)
    .sort((a, b) => Number(b.lugar.tipo === 'fracao') - Number(a.lugar.tipo === 'fracao') || b.semDono - a.semDono);
  if (!comAlgo.length) return '';
  const aberto = vista.semDonoAberto;
  return `<button type="button" class="linha-sem-dono-resumo" data-env-sem-dono aria-expanded="${aberto}">
      <span>sem dono · ${formatar(total)} em ${comAlgo.length} ${comAlgo.length === 1 ? 'lugar' : 'lugares'}</span>
      <span class="elo">distribuir ${aberto ? '▴' : '▾'}</span>
    </button>
    ${aberto ? `<div class="ativos">${comAlgo.map((x) => `<div class="linha-ativo linha-sem-dono">
      <span class="nome-ativo">${esc(x.lugar.nome)}<span class="fino">${esc(x.lugar.ativo ? x.lugar.contaNome : x.lugar.tipo === 'caixa' ? 'caixa' : 'rende')}</span></span>
      <span class="valor-ativo ${x.semDono < 0 ? 'negativo' : ''}">${x.semDono < 0 ? '−' : ''}${formatar(Math.abs(x.semDono))}</span>
      <span class="rendeu-ativo">${x.semDono > 0 ? `<button type="button" class="elo" data-distribuir="${esc(x.lugar.id)}">distribuir</button>` : ''}</span>
    </div>`).join('')}</div>` : ''}`;
}

// ── um envelope ───────────────────────────────────────────────────────────

const NOME_DO_MOVIMENTO = {
  aporte: 'aporte',
  resgate: 'devolvido ao sem dono',
  entrou: 'entrou',
  movido: 'mudou de lugar',
  saiu: 'saiu',
};

/**
 * O fechamento do projeto (R28): quanto custou, de onde saiu o dinheiro e
 * onde foi. Aparece desde o primeiro gasto (design/11 §8).
 */
function fechamento(v, r) {
  if (!r.custo) return '';
  const estouro = r.estouro > 0
    ? `<div class="linha-fechamento estouro"><span>saiu do caixa comum</span><span>${formatar(r.estouro)}</span><span class="fino">estouro de ${pct(r.estouro / Math.max(1, r.financiado || r.custo))}</span></div>`
    : '';
  const porCategoria = [...r.porCategoria.entries()].sort((a, b) => b[1] - a[1])
    .map(([id, val]) => `<div class="linha-fechamento"><span>${esc(nomeDaCategoria(app, id) || 'sem categoria')}</span><span>${formatar(val)}</span><span></span></div>`).join('');
  return `<p class="classe-ativos"><span>${v.encerradoEm ? 'o projeto' : 'o que já pagou'}</span><span>${formatar(r.custo)}</span></p>
    <div class="fechamento">
      <div class="linha-fechamento total"><span>custou</span><span>${formatar(r.custo)}</span><span class="fino">${r.pagamentos} ${r.pagamentos === 1 ? 'pagamento' : 'pagamentos'}</span></div>
      <div class="linha-fechamento"><span>financiado pelo envelope</span><span>${formatar(r.financiado)}</span><span></span></div>
      ${estouro}
      ${porCategoria ? `<p class="miudo titulo-linhas">onde foi</p>${porCategoria}` : ''}
    </div>`;
}

function doEnvelope(v, donos) {
  const r = donos.porEnvelope.get(v.id) ?? { total: 0, porLugar: new Map(), extrato: [], posto: 0, rendeu: 0, custo: 0 };
  const n = numerosDoEnvelope(v, r.total);
  const situacao = estadoDoEnvelope(v, r);

  // Uma linha só: a parte do alvo, o que falta, o ritmo, o rendimento.
  const partes = [];
  if (v.encerradoEm) partes.push(`encerrado em ${dataCheia(v.encerradoEm)}`);
  if (n.alvo != null) partes.push(`${pct(Math.min(1, r.total / n.alvo))} de ${formatar(n.alvo)}${ehProjeto(v) ? ` até ${mesAno(v.alvoData)}` : ''}`);
  if (!v.encerradoEm && n.falta) partes.push(`falta ${formatar(n.falta)}${n.porMes ? ` · ${formatar(n.porMes)} por mês` : ''}`);
  if (!v.encerradoEm && n.deveriaTer != null && !n.completo) {
    partes.push(r.total >= n.deveriaTer ? 'no ritmo ✓' : `<span class="dif-rel ruim">no ritmo, deveria ter ${formatar(n.deveriaTer)}</span>`);
  }
  if (n.completo && situacao === 'completo') partes.push('<span class="dif-rel bom">completo ✓</span>');
  if (r.rendeu) partes.push(`<span class="dif-rel ${r.rendeu >= 0 ? 'bom' : 'ruim'}">${comSinal(r.rendeu)}</span> de rendimento`);

  const onde = [...r.porLugar.entries()].filter(([, val]) => val > 0).sort((a, b) => b[1] - a[1]);
  // Em mais de um lugar, a pizza (pedido dele: voltou em 05/10/2026) — ela
  // já traz a lista com valor e parte ao lado. Num lugar só, uma linha basta.
  const ondeHTML = onde.length > 1
    ? `<p class="classe-ativos"><span>onde está</span><span>${formatar(r.total)}</span></p>
      <div id="g-onde-env" class="onde-env"></div>`
    : onde.length
    ? `<p class="classe-ativos"><span>onde está</span><span>${formatar(r.total)}</span></p>
      ${onde.map(([id, val]) => `<div class="linha-ativo">
        <span class="nome-ativo">${esc(nomeCompleto(id))}${(v.inteiros ?? []).includes(id) ? '<span class="fino">inteiro dele</span>' : ''}</span>
        <span class="valor-ativo">${formatar(val)}</span>
        <span class="rendeu-ativo">${r.total ? pct(val / r.total) : ''}</span>
      </div>`).join('')}`
    : '';

  // Aportar: o botão abre a escolha do lugar de onde vem o dinheiro sem dono.
  const deOnde = [...donos.porLugar.values()].filter((x) => x.semDono > 0 && !x.lugar.arquivado)
    .sort((a, b) => Number(b.lugar.tipo === 'fracao') - Number(a.lugar.tipo === 'fracao') || b.semDono - a.semDono);
  const escolherLugar = vista.aportarAberto && deOnde.length
    ? `<div class="aportar-de">
        <p class="miudo">aportar do sem dono de</p>
        ${deOnde.map((x) => `<button type="button" class="linha-ativo linha-aportar" data-distribuir="${esc(x.lugar.id)}" data-para="${esc(v.id)}">
          <span class="nome-ativo">${esc(x.lugar.nome)}</span><span class="valor-ativo">${formatar(x.semDono)}</span><span class="rendeu-ativo">›</span></button>`).join('')}
      </div>`
    : '';
  const acoes = v.encerradoEm
    ? ''
    : `<div class="acoes-envelope">
        ${deOnde.length ? `<button type="button" class="principal" data-env-aportar aria-expanded="${vista.aportarAberto}">aportar</button>` : ''}
        <button type="button" data-pagar-env="${esc(v.id)}">pagar com ele</button>
        ${r.total > 0 ? `<button type="button" class="elo" data-tirar="${esc(v.id)}">tirar</button>` : ''}
      </div>${escolherLugar}`;

  const linhasExtrato = vista.extratoInteiro ? r.extrato : r.extrato.slice(0, 5);
  const extrato = r.extrato.length
    ? `<ol class="linhas-holerite operacoes-lista extrato-envelope">${linhasExtrato.map((x) => linhaDoExtrato(x)).join('')}</ol>
      ${r.extrato.length > 5 ? `<p class="ver-tudo"><button type="button" class="elo" data-env-extrato>${vista.extratoInteiro ? 'ver só os últimos' : `ver tudo · ${r.extrato.length}`}</button></p>` : ''}`
    : '<p class="nota">Nada ainda. Comece pelo "aportar".</p>';

  const fim = v.encerradoEm
    ? `<button type="button" class="elo" data-reabrir-env="${esc(v.id)}">reabrir</button>`
    : `<button type="button" class="elo" data-encerrar-env="${esc(v.id)}">encerrar</button>`;
  return `<div class="topo-conta"><button type="button" class="elo" data-env-editar="${esc(v.id)}">editar ${esc(v.nome)}</button>${fim}</div>
    <div class="numero-rel">
      <p class="rotulo-numero">${esc(v.nome)} · ${ehProjeto(v) ? 'projeto' : 'acumula'} · ${esc(situacao)}</p>
      <p class="valor-rel-grande">${formatar(r.total)}</p>
      ${barraDoAlvo(r.total, n.alvo)}
      <p class="nota-rel">${partes.join(' · ')}</p>
    </div>
    ${controlesDaEvolucao()}
    ${acoes}
    <div class="ativos">${ondeHTML}${fechamento(v, r)}</div>
    <div class="cabeca-lista"><h2>Extrato</h2></div>
    ${extrato}`;
}

/** Onde está o dinheiro do envelope, em pizza com a lista ao lado. */
function desenharOnde(donos) {
  const raiz = $('g-onde-env');
  if (!raiz) return;
  const r = donos.porEnvelope.get(foco);
  const onde = [...(r?.porLugar ?? new Map()).entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  pizza(raiz, {
    fatias: onde.map(([id, v], i) => ({ nome: nomeCompleto(id), valor: v, cor: cor(i + 1) })),
    formatar,
    centro: formatar(r.total).replace(/,\d\d$/, ''),
    subtitulo: 'onde está',
  });
}

function linhaDoExtrato(x) {
  let texto;
  let sinal = '+';
  if (x.tipo === 'aporte') texto = `aporte · ${nomeDoLugar(app, x.lugar)}`;
  else if (x.tipo === 'resgate') { texto = `devolvido ao sem dono · ${nomeDoLugar(app, x.lugar)}`; sinal = '−'; }
  else if (x.tipo === 'remanejo' && x.para) { texto = `para ${app.envelopes?.[x.para]?.nome ?? '—'} · ${nomeDoLugar(app, x.lugar)}`; sinal = '−'; }
  else if (x.tipo === 'remanejo') texto = `de ${app.envelopes?.[x.de]?.nome ?? '—'} · ${nomeDoLugar(app, x.lugar)}`;
  else if (x.tipo === 'entrou') texto = `entrou · ${nomeDoLugar(app, x.lugar)}`;
  else if (x.tipo === 'movido') { texto = `${x.de ? nomeDoLugar(app, x.de) : '—'} → ${nomeDoLugar(app, x.para)}`; sinal = '='; }
  else if (x.tipo === 'gasto') {
    const l = app.lancamentos[x.lancamentoId];
    const oque = [nomeDaCategoria(app, l?.categoriaId), app.detalhes?.[l?.detalheId]?.nome].filter(Boolean).join(' · ') || 'gasto';
    texto = x.estouro > 0
      ? `${oque} — ${formatar(x.usado)} do envelope, ${formatar(x.estouro)} do caixa comum`
      : `${oque} · ${x.de ? nomeDoLugar(app, x.de) : ''}`;
    sinal = '−';
  }
  else { texto = `${NOME_DO_MOVIMENTO[x.tipo] ?? x.tipo} · ${x.de ? nomeDoLugar(app, x.de) : ''}`; sinal = '−'; }
  const desfazer = x.alocacaoId
    ? `<span class="acoes-op"><button type="button" class="elo" data-desfazer-alocacao="${esc(x.alocacaoId)}">desfazer</button></span>`
    : '<span></span>';
  return `<li class="linha-holerite operacao">
    <span class="quando">${diaCurto(x.data)}</span>
    <span class="nome-linha">${esc(texto)}</span>
    <span class="valor-lancado ${sinal === '+' ? 'positivo' : ''}">${sinal} ${formatar(x.valor)}</span>
    ${desfazer}
  </li>`;
}

// ── eventos ───────────────────────────────────────────────────────────────

// O "+" no fim das abas cria um envelope.
document.addEventListener('click', (e) => {
  if (ativa && e.target.closest('[data-novo-envelope]')) janelas.abrirFicha();
});

// Cada período abre no agrupamento natural: anos longos por ano, o resto por mês.
const tempoNatural = (p) => (p === '5anos' || p === 'tudo' ? 'ano' : 'mes');

document.addEventListener('click', async (e) => {
  if (!ativa) return;
  const aba = e.target.closest('[data-env-aba]');
  if (aba) {
    foco = aba.dataset.envAba;
    vista.aportarAberto = false;
    vista.extratoInteiro = false;
    pintar();
    scrollTo(0, 0);
    return;
  }
  const per = e.target.closest('[data-env-periodo]');
  if (per) { vista.periodo = per.dataset.envPeriodo; vista.tempo = tempoNatural(vista.periodo); pintar(); return; }
  const tempo = e.target.closest('[data-env-tempo]');
  if (tempo) { vista.tempo = tempo.dataset.envTempo; pintar(); return; }
  if (e.target.closest('[data-env-sem-dono]')) { vista.semDonoAberto = !vista.semDonoAberto; pintar(); return; }
  if (e.target.closest('[data-env-aportar]')) { vista.aportarAberto = !vista.aportarAberto; pintar(); return; }
  if (e.target.closest('[data-env-extrato]')) { vista.extratoInteiro = !vista.extratoInteiro; pintar(); return; }
  const editar = e.target.closest('[data-env-editar]');
  if (editar) { await janelas.abrirFicha(editar.dataset.envEditar); return; }
  const distribuir = e.target.closest('[data-distribuir]');
  if (distribuir) { await janelas.abrirDistribuir(distribuir.dataset.distribuir, { envelopeId: distribuir.dataset.para ?? null }); return; }
  const pagar = e.target.closest('[data-pagar-env]');
  if (pagar) { await uso.abrirPagar(pagar.dataset.pagarEnv); return; }
  const encerrar = e.target.closest('[data-encerrar-env]');
  if (encerrar) { await uso.abrirEncerrar(encerrar.dataset.encerrarEnv); return; }
  const reabrir = e.target.closest('[data-reabrir-env]');
  if (reabrir) { await estado.aplicarEvento('envelope.reaberto', { id: reabrir.dataset.reabrirEnv }); await pintar(); return; }
  const tirar = e.target.closest('[data-tirar]');
  if (tirar) { await janelas.abrirTirar(tirar.dataset.tirar); return; }
  const desfazer = e.target.closest('[data-desfazer-alocacao]');
  if (desfazer) {
    if (desfazer.dataset.confirmar !== '1') { desfazer.dataset.confirmar = '1'; desfazer.textContent = 'desfazer mesmo?'; return; }
    await estado.aplicarEvento('envelope.alocacaoRemovida', { id: desfazer.dataset.desfazerAlocacao });
    await pintar();
  }
});

document.addEventListener('app:tela', (e) => {
  ativa = e.detail.tela === 'envelopes';
  if (ativa) pintar();
  else $('subabas-envelopes').hidden = true;
});
estado.aoAplicar(() => pintar());
