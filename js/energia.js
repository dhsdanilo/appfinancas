// A tela Energia (#/energia): o sistema fotovoltaico mês a mês. Um registro por mês, digitado à
// mão, com o que a fatura e o inversor dizem; a conta (consumo real, custo integral, economia)
// está em js/core/energia.js. Sem ligação com os envelopes: é só o demonstrativo.

import * as estado from './core/estado.js';
import { formatar, deTexto } from './core/dinheiro.js';
import { hoje, nomeDoMes, somarMeses } from './core/datas.js';
import {
  calculoDoMes, mesesDeEnergia, resumoDeEnergia, tarifaDeTexto, tarifaParaTexto, kwhDeTexto,
} from './core/energia.js';
import { linhas as graficoDeLinhas, cor } from './app/graficos.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mesCurto = (mes) => `${nomeDoMes(mes).split(' ')[0].slice(0, 3)}/${mes.slice(2, 4)}`;
const kwh = (v) => `${Math.round(v).toLocaleString('pt-BR')} kWh`;
const reais = (v) => `${v < 0 ? '−' : ''}${formatar(Math.abs(v))}`;
const campoReais = (v) => (v ? formatar(v, { comPrefixo: false }) : '');
const campoKwh = (v) => (v == null ? '' : String(v).replace('.', ','));
const eixoReais = (v) => {
  const abs = Math.abs(v / 100);
  return `${v < 0 ? '−' : ''}${abs >= 1000 ? `${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : Math.round(abs).toLocaleString('pt-BR')}`;
};

const PERIODOS = [['6', '6 meses'], ['12', '12 meses'], ['tudo', 'tudo']];
let ativa = false;
let periodo = '12';
let grandeza = 'kwh';
let app = null;

// ── a tela ──────────────────────────────────────────────────────────────────

async function pintar() {
  if (!ativa) return;
  app = await estado.calcular();
  const todos = mesesDeEnergia(app);
  const corpo = $('corpo-energia');
  const novo = '<button type="button" class="principal" data-en-novo>Novo registro</button>';
  if (!todos.length) {
    corpo.innerHTML = `<div class="topo-energia">${novo}</div>
      <p class="nota-rel">Nenhum mês registrado ainda. A cada fatura, digite o consumo da concessionária, o que foi injetado, o que o sistema produziu e as tarifas: o app mostra quanto a luz custaria sem o sistema e quanto ele economizou.</p>`;
    return;
  }

  // A janela: os últimos N meses até o último registrado, com os meses sem registro no meio (lacuna).
  const ate = todos[todos.length - 1].registro.mes;
  // Os últimos N meses, mas nunca antes do primeiro registro (senão o gráfico fica com um trecho só, no canto).
  const primeiro = todos[0].registro.mes;
  const de = periodo === 'tudo' ? primeiro : [primeiro, somarMeses(`${ate}-01`, -(Number(periodo) - 1)).slice(0, 7)].sort().pop();
  const calendario = [];
  for (let m = de; m <= ate; m = somarMeses(`${m}-01`, 1).slice(0, 7)) calendario.push(m);
  const porMes = new Map(todos.map((x) => [x.registro.mes, x]));
  const doPeriodo = calendario.map((m) => porMes.get(m)).filter(Boolean);
  const resumo = resumoDeEnergia(doPeriodo);

  const numero = (rotulo, valor, nota = '', classe = '') =>
    `<div class="numero-det"><span class="rotulo-numero">${esc(rotulo)}</span><span class="valor-numero ${classe}">${valor}</span>${nota ? `<span class="fino">${esc(nota)}</span>` : ''}</div>`;
  const numeros = [
    numero('economia no período', resumo.mesesComConta ? reais(resumo.economia) : '—',
      resumo.mesesComConta ? `${resumo.mesesComConta} de ${resumo.meses} meses com conta paga` : 'registre a conta paga para ver',
      resumo.economia > 0 ? 'positivo' : ''),
    numero('custo integral', resumo.meses ? reais(resumo.custoIntegral) : '—', 'o que a luz custaria sem o sistema'),
    numero('consumo real', resumo.meses ? kwh(resumo.consumoReal / resumo.meses) : '—', 'média por mês (rede + FV direto)'),
  ].join('');

  const periodos = `<span class="seg-det" role="group" aria-label="Período">${PERIODOS.map(([id, nome]) =>
    `<button type="button" data-en-periodo="${id}" aria-pressed="${id === periodo}">${nome}</button>`).join('')}</span>`;
  const grandezas = `<span class="seg-det" role="group" aria-label="O que mostrar">
      <button type="button" data-en-grandeza="kwh" aria-pressed="${grandeza === 'kwh'}">kWh</button>
      <button type="button" data-en-grandeza="reais" aria-pressed="${grandeza === 'reais'}">R$</button></span>`;

  const linhasDaTabela = [...doPeriodo].reverse().map(({ registro: r, calculo: c }) => c
    ? `<tr data-en-mes="${esc(r.mes)}" tabindex="0">
        <td>${esc(mesCurto(r.mes))}${c.inconsistente ? ' <span class="aviso-mini" title="Injetou mais do que produziu: confira as leituras">!</span>' : ''}</td>
        <td>${kwh(c.consumoReal)}</td><td>${kwh(c.consumo)}</td><td>${kwh(c.injetado)}</td><td>${kwh(c.diretoFV)}</td>
        <td>${reais(c.custoIntegral)}</td><td>${c.conta != null ? reais(c.conta) : '—'}</td>
        <td class="${c.economia > 0 ? 'positivo' : c.economia < 0 ? 'negativo' : ''}">${c.economia != null ? reais(c.economia) : '—'}</td></tr>`
    : `<tr data-en-mes="${esc(r.mes)}" tabindex="0" class="incompleto"><td>${esc(mesCurto(r.mes))}</td><td colspan="7">faltam dados para a conta · toque para completar</td></tr>`).join('');
  const rodape = resumo.meses
    ? `<tfoot><tr><td>no período</td><td>${kwh(resumo.consumoReal)}</td><td>${kwh(resumo.consumo)}</td><td>${kwh(resumo.injetado)}</td><td>${kwh(resumo.diretoFV)}</td>
        <td>${reais(resumo.custoIntegral)}</td><td>${resumo.mesesComConta ? reais(resumo.conta) : '—'}</td><td>${resumo.mesesComConta ? reais(resumo.economia) : '—'}</td></tr></tfoot>`
    : '';

  corpo.innerHTML = `<div class="topo-energia">${periodos}${novo}</div>
    <div class="numeros-detalhe">${numeros}</div>
    <div class="ferramentas-detalhe">${grandezas}</div>
    <div id="g-energia"></div>
    <div class="rolagem-energia"><table class="tabela-energia">
      <thead><tr><th>mês</th><th>consumo real</th><th>da concessionária</th><th>injetado</th><th>FV direto</th><th>custo integral</th><th>conta paga</th><th>economia</th></tr></thead>
      <tbody>${linhasDaTabela}</tbody>${rodape}</table></div>
    <p class="nota-rel">Consumo real = consumo da concessionária + o que o sistema produziu e foi consumido na hora (produzido − injetado). Custo integral = consumo real × (TE + TUSD + bandeira) + iluminação pública. Economia = custo integral − conta paga.</p>`;
  desenhar(calendario, porMes);
}

function desenhar(calendario, porMes) {
  const raiz = $('g-energia');
  const registrados = calendario.filter((m) => porMes.has(m));
  if (registrados.length < 2) { raiz.innerHTML = '<p class="nota-rel">O gráfico aparece a partir de dois meses registrados.</p>'; return; }
  const valor = (m, f) => { const x = porMes.get(m); return x ? f(x.registro, x.calculo) : null; };
  const real = (r, c) => c?.consumoReal ?? null;
  const series = grandeza === 'kwh'
    ? [
      { nome: 'consumo da concessionária', cor: cor(1), valores: calendario.map((m) => valor(m, (r) => r.consumo)) },
      { nome: 'abatimento (injetado)', cor: cor(2), valores: calendario.map((m) => valor(m, (r) => r.injetado)) },
      { nome: 'consumo real', cor: cor(3), valores: calendario.map((m) => valor(m, real)) },
      { nome: 'produção do sistema', cor: cor(4), fina: true, valores: calendario.map((m) => valor(m, (r) => r.producao)) },
    ]
    : [
      { nome: 'custo integral', cor: cor(1), valores: calendario.map((m) => valor(m, (r, c) => c?.custoIntegral ?? null)) },
      { nome: 'conta paga', cor: cor(2), valores: calendario.map((m) => valor(m, (r, c) => c?.conta ?? null)) },
      { nome: 'economia', cor: cor(3), valores: calendario.map((m) => valor(m, (r, c) => c?.economia ?? null)) },
    ];
  graficoDeLinhas(raiz, {
    series,
    rotulos: calendario.map(mesCurto),
    dica: (i) => {
      const x = porMes.get(calendario[i]);
      if (!x) return `<strong>${esc(nomeDoMes(calendario[i]))}</strong><span>sem registro</span>`;
      const { registro: r, calculo: c } = x;
      const partes = [`consumo da concessionária ${kwh(r.consumo ?? 0)}`, `abatido ${kwh(r.injetado ?? 0)}`, `produzido ${kwh(r.producao ?? 0)}`];
      if (c) partes.unshift(`consumo real ${kwh(c.consumoReal)} (FV direto ${kwh(c.diretoFV)})`);
      const dinheiro = c ? [`custo integral ${reais(c.custoIntegral)}`, c.conta != null ? `conta paga ${reais(c.conta)}` : '', c.economia != null ? `economia ${reais(c.economia)}` : ''].filter(Boolean) : [];
      return `<strong>${esc(nomeDoMes(calendario[i]))}</strong>${[...partes, ...dinheiro].map((t) => `<span class="fino">${esc(t)}</span>`).join('')}`;
    },
    formatar: grandeza === 'kwh' ? (v) => Math.round(v).toLocaleString('pt-BR') : eixoReais,
    altura: 230,
  });
}

// ── o registro de um mês ─────────────────────────────────────────────────────

let editando = null;      // o mês aberto, ou null num registro novo
let confirmaApagar = false;

const campos = () => $('f-energia').elements;

function lerRegistro() {
  const f = campos();
  const dinheiro = (t) => (t.trim() ? Math.abs(deTexto(t)) : 0);
  return {
    mes: f.mes.value,
    consumo: kwhDeTexto(f.consumo.value),
    injetado: kwhDeTexto(f.injetado.value) ?? 0,
    producao: kwhDeTexto(f.producao.value),
    te6: tarifaDeTexto(f.te.value),
    tusd6: tarifaDeTexto(f.tusd.value),
    bandeira6: tarifaDeTexto(f.bandeira.value),
    ilum: dinheiro(f.ilum.value),
    conta: f.conta.value.trim() ? Math.abs(deTexto(f.conta.value)) : null,
  };
}

/** A conta ao vivo, embaixo dos campos, enquanto se digita. */
function pintarPrevia() {
  const c = calculoDoMes(lerRegistro());
  const saida = $('en-previa');
  if (!c) { saida.hidden = true; return; }
  saida.hidden = false;
  saida.innerHTML = `<span>direto do FV <strong>${kwh(c.diretoFV)}</strong></span><span>consumo real <strong>${kwh(c.consumoReal)}</strong></span>
    <span>custo integral <strong>${reais(c.custoIntegral)}</strong></span>${c.economia != null ? `<span>economia <strong class="${c.economia >= 0 ? 'positivo' : 'negativo'}">${reais(c.economia)}</strong></span>` : ''}
    ${c.inconsistente ? '<span class="negativo">Injetou mais do que produziu: confira as leituras.</span>' : ''}`;
}

function abrir(mes = null) {
  editando = mes;
  confirmaApagar = false;
  const f = campos();
  const todos = mesesDeEnergia(app);
  const existente = mes ? app.energia[mes] : null;
  // Um mês novo: o seguinte ao último registrado (ou o atual), com as tarifas do último como ponto de partida.
  const ultimo = todos[todos.length - 1]?.registro;
  const base = existente ?? (ultimo ? { te6: ultimo.te6, tusd6: ultimo.tusd6, bandeira6: ultimo.bandeira6, ilum: ultimo.ilum } : {});
  f.mes.value = existente ? existente.mes : ultimo ? somarMeses(`${ultimo.mes}-01`, 1).slice(0, 7) : hoje().slice(0, 7);
  f.consumo.value = existente ? campoKwh(existente.consumo) : '';
  f.injetado.value = existente ? campoKwh(existente.injetado) : '';
  f.producao.value = existente ? campoKwh(existente.producao) : '';
  f.te.value = base.te6 ? tarifaParaTexto(base.te6) : '';
  f.tusd.value = base.tusd6 ? tarifaParaTexto(base.tusd6) : '';
  f.bandeira.value = base.bandeira6 ? tarifaParaTexto(base.bandeira6) : '';
  f.ilum.value = campoReais(base.ilum);
  f.conta.value = existente?.conta != null ? campoReais(existente.conta) : '';
  $('titulo-energia').textContent = existente ? `Registro de ${nomeDoMes(existente.mes)}` : 'Novo registro do mês';
  $('en-apagar').hidden = !existente;
  $('en-apagar').textContent = 'apagar este mês';
  $('en-aviso').hidden = true;
  pintarPrevia();
  $('dialogo-energia').showModal();
  (existente ? f.consumo : f.consumo).focus();
}

const avisar = (t) => { $('en-aviso').textContent = t; $('en-aviso').hidden = !t; };

async function salvar() {
  const r = lerRegistro();
  if (!/^\d{4}-\d{2}$/.test(r.mes)) return avisar('Escolha o mês da fatura.');
  if (r.consumo == null) return avisar('Falta o consumo da concessionária, em kWh.');
  if (r.producao == null) return avisar('Falta o que o sistema produziu no mês, em kWh.');
  if (!r.te6 || !r.tusd6) return avisar('Faltam as tarifas TE e TUSD (R$/kWh, com tributos).');
  // Mudou o mês de um registro que já existia: o antigo sai, o novo entra.
  if (editando && editando !== r.mes) await estado.aplicarEvento('energia.removida', { mes: editando });
  await estado.aplicarEvento('energia.registrada', r);
  $('dialogo-energia').close();
  await pintar();
}

async function apagar() {
  if (!editando) return;
  if (!confirmaApagar) {
    confirmaApagar = true;
    $('en-apagar').textContent = 'toque de novo para apagar';
    return;
  }
  await estado.aplicarEvento('energia.removida', { mes: editando });
  $('dialogo-energia').close();
  await pintar();
}

// ── ligações ─────────────────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  if (!ativa) return;
  if (e.target.closest('[data-en-novo]')) return abrir();
  const per = e.target.closest('[data-en-periodo]');
  if (per) { periodo = per.dataset.enPeriodo; return pintar(); }
  const gr = e.target.closest('[data-en-grandeza]');
  if (gr) { grandeza = gr.dataset.enGrandeza; return pintar(); }
  const linha = e.target.closest('[data-en-mes]');
  if (linha) return abrir(linha.dataset.enMes);
});
document.addEventListener('keydown', (e) => {
  if (!ativa || e.key !== 'Enter') return;
  const linha = e.target.closest?.('[data-en-mes]');
  if (linha) abrir(linha.dataset.enMes);
});

$('f-energia')?.addEventListener('input', pintarPrevia);
$('f-energia')?.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'salvar') return;
  e.preventDefault();
  await salvar();
});
$('en-apagar')?.addEventListener('click', apagar);

document.addEventListener('app:tela', (e) => {
  ativa = e.detail.tela === 'energia';
  if (ativa) pintar();
});
estado.aoAplicar(() => pintar());
