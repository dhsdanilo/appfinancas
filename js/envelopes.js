// A área Envelopes (design/11 §5): de quem é o dinheiro guardado.
//
// Geral: quanto cada envelope tem, o alvo e o ritmo, e o sem dono de cada
// lugar com o seu "distribuir". A aba de um envelope: onde o dinheiro dele
// está, o que ele já pagou (o fechamento do projeto, R28) e o extrato dele —
// aportes, resgates, remanejamentos, mudanças de lugar e gastos.

import * as estado from './core/estado.js';
import { formatar } from './core/dinheiro.js';
import { hoje, diaCurto } from './core/datas.js';
import {
  envelopesAtivos, ehProjeto, donosNoDia, numerosDoEnvelope, nomeDoLugar, estadoDoEnvelope,
} from './core/envelopes.js';
import { nomeDaCategoria } from './core/lancamentos.js';
import { criarJanelasDeEnvelope } from './app/envelope.js';
import { criarJanelasDeUso } from './app/envelope-uso.js';
import { pizza, cor } from './app/graficos.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mesAno = (dia) => `${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
const pct = (v) => `${Math.round(v * 100)}%`;
const numero = (rotulo, valor, classe = '') =>
  `<div class="numero-faixa ${classe}"><span class="rotulo-numero">${esc(rotulo)}</span><span class="valor-numero">${valor}</span></div>`;

let ativa = false;
let foco = 'geral';
let app = null;

const janelas = criarJanelasDeEnvelope({ aoSalvar: () => pintar() });
const uso = criarJanelasDeUso({ aoSalvar: () => pintar() });
const dataCheia = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

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
  $('subabas-envelopes').hidden = !abas.length;
  $('subabas-envelopes').innerHTML = [{ id: 'geral', nome: 'Geral' }, ...abas]
    .map((v) => `<button type="button" data-env-aba="${esc(v.id)}" aria-pressed="${v.id === foco}">${esc(v.nome)}</button>`)
    .join('');

  const donos = donosNoDia(app);
  if (!lista.length && foco === 'geral') {
    $('corpo-envelopes').innerHTML = `<p class="vazio">Envelope é dinheiro guardado que já tem dono: a reserva de emergência, a aposentadoria,
      o IPVA do ano, a viagem. Nada sai do lugar — o dinheiro continua no CDB ou na corrente, e cada pedaço ganha dono.
      Comece pelo botão "Novo envelope".</p>`;
  } else {
    $('corpo-envelopes').innerHTML = foco === 'geral' ? geral(lista, donos) : doEnvelope(app.envelopes[foco], donos);
    desenharOnde(donos);
  }
  if (encerrados.length && foco === 'geral') {
    $('corpo-envelopes').insertAdjacentHTML('beforeend', `<p class="arquivadas-area fino">encerrados: ${encerrados
      .map((v) => `<button type="button" class="elo" data-env-aba="${esc(v.id)}">${esc(v.nome)}</button>`).join(' · ')}</p>`);
  }
  if (arquivados.length && foco === 'geral') {
    $('corpo-envelopes').insertAdjacentHTML('beforeend', `<p class="arquivadas-area fino">arquivados: ${arquivados
      .map((v) => `<button type="button" class="elo" data-env-editar="${esc(v.id)}">${esc(v.nome)}</button>`).join(' · ')}</p>`);
  }
}

// ── Geral ─────────────────────────────────────────────────────────────────

function geral(lista, donos) {
  const guardado = lista.reduce((t, v) => t + (donos.porEnvelope.get(v.id)?.total ?? 0), 0);
  const lugares = [...donos.porLugar.values()].filter((x) => !x.lugar.arquivado || x.semDono);
  const furos = lugares.filter((x) => x.semDono < 0);
  const linhas = lista.map((v) => {
    const r = donos.porEnvelope.get(v.id) ?? { total: 0 };
    const n = numerosDoEnvelope(v, r.total);
    const situacao = estadoDoEnvelope(v, r);
    const sub = ehProjeto(v)
      ? [
        `de ${formatar(n.alvo)} até ${mesAno(v.alvoData)}`,
        situacao === 'em uso' ? `em uso · já pagou ${formatar(r.custo)}`
          : n.completo ? 'completo' : n.deveriaTer != null ? (r.total >= n.deveriaTer ? 'no ritmo ✓' : `no ritmo, deveria ter ${formatar(n.deveriaTer)}`) : '',
      ]
      : [n.alvo != null ? `acumula · alvo ${formatar(n.alvo)}` : 'acumula', situacao === 'em uso' ? `já pagou ${formatar(r.custo)}` : n.completo ? 'completo' : ''];
    const progresso = n.alvo ? pct(Math.min(1, r.total / n.alvo)) : '—';
    return `<button type="button" class="linha-ativo" data-env-aba="${esc(v.id)}">
      <span class="nome-ativo">${esc(v.nome)}<span class="fino">${esc(sub.filter(Boolean).join(' · '))}</span></span>
      <span class="valor-ativo">${formatar(r.total)}</span>
      <span class="rendeu-ativo">${progresso}</span>
    </button>`;
  }).join('');

  return `<div class="blocos"><div class="bloco largo total investimento-resumo">
      <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>geral</p>
      <div class="numeros-renda">
        ${numero('guardado', formatar(guardado))}
        ${numero('sem dono', formatar(donos.semDono))}
        ${numero('confere', furos.length ? 'não fecha' : 'fecha ✓', furos.length ? 'nao-fecha' : '')}
      </div>
      ${furos.length ? `<p class="aviso-bloco">${furos.map((x) => `${esc(nomeCompleto(x.lugar.id))} tem ${formatar(x.valor)}, e os envelopes dizem ter ${formatar(x.valor - x.semDono)} ali`).join('; ')}: gastou-se dinheiro de envelope sem dizer de qual. Tire do envelope o que foi gasto.</p>` : ''}
      <div class="ativos">
        <p class="classe-ativos"><span>envelopes</span><span>${formatar(guardado)}</span></p>
        ${linhas}
        ${semDonoHTML(lugares)}
      </div>
    </div></div>`;
}

/** O sem dono de cada lugar, com o "distribuir" de cada um (§3.1). */
function semDonoHTML(lugares) {
  const comAlgo = lugares.filter((x) => x.semDono !== 0)
    .sort((a, b) => Number(b.lugar.tipo === 'fracao') - Number(a.lugar.tipo === 'fracao') || b.semDono - a.semDono);
  if (!comAlgo.length) return '';
  const total = comAlgo.reduce((t, x) => t + x.semDono, 0);
  return `<p class="classe-ativos"><span>sem dono</span><span>${formatar(total)}</span></p>
    ${comAlgo.map((x) => `<div class="linha-ativo linha-sem-dono">
      <span class="nome-ativo">${esc(x.lugar.nome)}<span class="fino">${esc(x.lugar.ativo ? x.lugar.contaNome : x.lugar.tipo === 'caixa' ? 'caixa' : 'rende')}</span></span>
      <span class="valor-ativo ${x.semDono < 0 ? 'negativo' : ''}">${x.semDono < 0 ? '−' : ''}${formatar(Math.abs(x.semDono))}</span>
      <span class="rendeu-ativo">${x.semDono > 0 ? `<button type="button" class="elo" data-distribuir="${esc(x.lugar.id)}">distribuir</button>` : ''}</span>
    </div>`).join('')}`;
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
 * onde foi. Aparece desde o primeiro gasto — a reforma em andamento já mostra
 * quanto custou até agora (design/11 §8).
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
  const numeros = [numero('tem', formatar(r.total))];
  if (v.encerradoEm) numeros.push(numero('encerrado em', dataCheia(v.encerradoEm)));
  if (n.alvo != null) numeros.push(numero(ehProjeto(v) ? `alvo · ${mesAno(v.alvoData)}` : 'alvo', formatar(n.alvo)));
  // Encerrado não junta mais: falta e ritmo saem.
  if (n.falta && !v.encerradoEm) numeros.push(numero('falta', formatar(n.falta)));
  if (n.porMes && !v.encerradoEm) numeros.push(numero(`por mês · ${n.mesesRestantes} ${n.mesesRestantes === 1 ? 'mês' : 'meses'}`, formatar(n.porMes)));
  if (n.deveriaTer != null && !n.completo && !v.encerradoEm) numeros.push(numero('no ritmo, deveria ter', formatar(n.deveriaTer), r.total >= n.deveriaTer ? 'em-dia' : ''));
  if (n.completo && situacao === 'completo') numeros.push(numero('situação', 'completo ✓'));
  if (r.rendeu) numeros.push(numero('rendeu', `${r.rendeu >= 0 ? '+' : '−'}${formatar(Math.abs(r.rendeu))}`));

  const onde = [...r.porLugar.entries()].filter(([, val]) => val > 0).sort((a, b) => b[1] - a[1]);
  const ondeHTML = onde.length
    ? `<p class="classe-ativos"><span>onde está</span><span>${formatar(r.total)}</span></p>
      ${onde.map(([id, val]) => `<div class="linha-ativo">
        <span class="nome-ativo">${esc(nomeCompleto(id))}${(v.inteiros ?? []).includes(id) ? '<span class="fino">inteiro dele</span>' : ''}</span>
        <span class="valor-ativo">${formatar(val)}</span>
        <span class="rendeu-ativo">${r.total ? pct(val / r.total) : ''}</span>
      </div>`).join('')}`
    : v.encerradoEm ? '' : '<p class="nota">Ainda sem dinheiro. Aporte do sem dono de um lugar, logo abaixo.</p>';

  // Aportar: do sem dono de qualquer lugar que tenha.
  const deOnde = [...donos.porLugar.values()].filter((x) => x.semDono > 0 && !x.lugar.arquivado)
    .sort((a, b) => Number(b.lugar.tipo === 'fracao') - Number(a.lugar.tipo === 'fracao') || b.semDono - a.semDono);
  const aportar = deOnde.length && !v.encerradoEm
    ? `<p class="aportar-de fino">aportar do sem dono de: ${deOnde.map((x) => `<button type="button" class="elo" data-distribuir="${esc(x.lugar.id)}" data-para="${esc(v.id)}">${esc(x.lugar.nome)} ${formatar(x.semDono)}</button>`).join(' · ')}</p>`
    : '';

  const extrato = r.extrato.length
    ? `<ol class="linhas-holerite operacoes-lista extrato-envelope">${r.extrato.map((x) => linhaDoExtrato(v, x)).join('')}</ol>`
    : '<p class="nota">Nada ainda.</p>';

  const fim = v.encerradoEm
    ? `<button type="button" class="elo" data-reabrir-env="${esc(v.id)}">reabrir</button>`
    : `<button type="button" class="elo" data-encerrar-env="${esc(v.id)}">encerrar</button>`;
  return `<div class="topo-conta"><button type="button" class="elo" data-env-editar="${esc(v.id)}">editar ${esc(v.nome)}</button>${fim}</div>
    <div class="blocos"><div class="bloco largo investimento-resumo">
      <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${esc(v.nome)} · ${ehProjeto(v) ? `projeto, de ${mesAno(v.inicio ?? hoje())} a ${mesAno(v.alvoData)}` : 'acumula'} · ${situacao}</p>
      <div class="numeros-renda">${numeros.join('')}</div>
      ${onde.length > 1 ? '<div id="g-onde-env" class="onde-env"></div>' : ''}
      <div class="ativos">${ondeHTML}${fechamento(v, r)}</div>
      ${aportar}
      ${v.encerradoEm ? '' : `<div class="pe-bloco"><span class="fino">Tirar não mexe em conta nenhuma: o dinheiro fica onde está e volta ao sem dono, ou passa a outro envelope.</span>
        <span class="acoes-investimento">${r.total > 0 ? `<button type="button" class="elo" data-tirar="${esc(v.id)}">tirar</button>` : ''}
        <button type="button" class="principal" data-pagar-env="${esc(v.id)}">pagar com o envelope</button></span></div>`}
    </div></div>
    <div class="cabeca-lista"><h2>Extrato de ${esc(v.nome)}</h2></div>
    ${extrato}`;
}

/** Onde está o dinheiro do envelope, em pizza — quando está em mais de um lugar. */
function desenharOnde(donos) {
  const raiz = $('g-onde-env');
  if (!raiz || foco === 'geral') return;
  const r = donos.porEnvelope.get(foco);
  const onde = [...(r?.porLugar ?? new Map()).entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  pizza(raiz, {
    fatias: onde.map(([id, v], i) => ({ nome: nomeCompleto(id), valor: v, cor: cor(i + 1) })),
    formatar,
    centro: formatar(r.total).replace(/,\d\d$/, ''),
    subtitulo: 'onde está',
  });
}

function linhaDoExtrato(v, x) {
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

$('b-novo-envelope').addEventListener('click', () => janelas.abrirFicha());

document.addEventListener('click', async (e) => {
  if (!ativa) return;
  const aba = e.target.closest('[data-env-aba]');
  if (aba) { foco = aba.dataset.envAba; pintar(); scrollTo(0, 0); return; }
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
});
estado.aoAplicar(() => pintar());
