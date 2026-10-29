// A tela Energia (#/energia): o sistema fotovoltaico mês a mês. Um registro por mês, digitado à
// mão, com o que a fatura e o inversor dizem; a conta (consumo real, custo integral, economia)
// está em js/core/energia.js. Sem ligação com os envelopes: é só o demonstrativo.

import * as estado from './core/estado.js';
import { formatar, deTexto } from './core/dinheiro.js';
import { hoje, nomeDoMes, somarMeses } from './core/datas.js';
import {
  calculoDoMes, mesesDeEnergia, resumoDeEnergia, tarifaDeTexto, tarifaParaTexto, kwhDeTexto, sugestaoDeSaldo, creditosAntes, lancamentoDaFatura,
} from './core/energia.js';
import { envelopesAtivos } from './core/envelopes.js';
import { linhas as graficoDeLinhas, cor } from './app/graficos.js';
import { ligarSeletorDeMes } from './app/seletor-mes.js';

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

/** A linha do vínculo: com que envelope e conta a Energia conversa, e o botão que abre a configuração. */
function textoDoVinculo() {
  const cfg = app.energiaConfig;
  const envelope = cfg?.envelopeId ? app.envelopes?.[cfg.envelopeId] : null;
  const conta = cfg?.contaId ? app.contas?.[cfg.contaId] : null;
  const partes = envelope
    ? [`A economia vira compromisso do envelope <strong>${esc(envelope.nome)}</strong>, ${cfg.defasagem ?? 2} meses depois, a partir de ${esc(mesCurto(cfg.desde))}`]
    : ['A economia ainda não está ligada a nenhum envelope'];
  if (conta) partes.push(`a fatura vira despesa agendada em <strong>${esc(conta.nome)}</strong>`);
  return `<p class="vinculo-energia">${partes.join(' · ')}. <button type="button" class="elo" data-en-vinculo>${envelope || conta ? 'mudar' : 'ligar'}</button></p>`;
}

async function pintar() {
  if (!ativa) return;
  app = await estado.calcular();
  const todos = mesesDeEnergia(app);
  const corpo = $('corpo-energia');
  const novo = '<button type="button" class="principal" data-en-novo>Novo registro</button>';
  const vinculo = textoDoVinculo();
  if (!todos.length) {
    corpo.innerHTML = `<div class="topo-energia">${novo}</div>${vinculo}
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
  ];
  // O saldo de créditos: o do último mês que o registrou.
  const comSaldo = [...doPeriodo].reverse().find((x) => x.registro.saldo != null);
  if (comSaldo) numeros.push(numero('saldo de créditos', kwh(comSaldo.registro.saldo), `no fim de ${mesCurto(comSaldo.registro.mes)}`));
  const numerosHTML = numeros.join('');

  const periodos = `<span class="seg-det" role="group" aria-label="Período">${PERIODOS.map(([id, nome]) =>
    `<button type="button" data-en-periodo="${id}" aria-pressed="${id === periodo}">${nome}</button>`).join('')}</span>`;
  const grandezas = `<span class="seg-det" role="group" aria-label="O que mostrar">
      <button type="button" data-en-grandeza="kwh" aria-pressed="${grandeza === 'kwh'}">kWh</button>
      <button type="button" data-en-grandeza="reais" aria-pressed="${grandeza === 'reais'}">R$</button></span>`;

  const linhasDaTabela = [...doPeriodo].reverse().map(({ registro: r, calculo: c }) => c
    ? `<tr data-en-mes="${esc(r.mes)}" tabindex="0">
        <td>${esc(mesCurto(r.mes))}${c.inconsistente ? ' <span class="aviso-mini" title="Injetou mais do que produziu: confira as leituras">!</span>' : ''}</td>
        <td>${kwh(c.consumoReal)}</td><td>${kwh(c.consumo)}</td><td>${kwh(c.injetado)}</td><td>${kwh(c.diretoFV)}</td>
        <td>${reais(c.custoIntegral)}</td>
        <td>${c.conta != null ? reais(c.conta) : `<span class="estimado-energia" title="Estimada pelas leituras: vale a da fatura quando você digitar">~${reais(c.contaEsperada)}</span>`}${r.vencimento ? `<small class="fino-energia">vence ${esc(r.vencimento.slice(8, 10))}/${esc(r.vencimento.slice(5, 7))}</small>` : ''}</td>
        <td class="${(c.economia ?? c.economiaEstimada) > 0 ? 'positivo' : (c.economia ?? c.economiaEstimada) < 0 ? 'negativo' : ''}">${c.economia != null ? reais(c.economia) : `<span class="estimado-energia">~${reais(c.economiaEstimada)}</span>`}</td>
        <td>${c.saldo != null ? kwh(c.saldo) : '—'}</td></tr>`
    : `<tr data-en-mes="${esc(r.mes)}" tabindex="0" class="incompleto"><td>${esc(mesCurto(r.mes))}</td><td colspan="8">faltam dados para a conta · toque para completar</td></tr>`).join('');
  const rodape = resumo.meses
    ? `<tfoot><tr><td>no período</td><td>${kwh(resumo.consumoReal)}</td><td>${kwh(resumo.consumo)}</td><td>${kwh(resumo.injetado)}</td><td>${kwh(resumo.diretoFV)}</td>
        <td>${reais(resumo.custoIntegral)}</td><td>${resumo.mesesComConta ? reais(resumo.conta) : '—'}</td><td>${resumo.mesesComConta ? reais(resumo.economia) : '—'}</td><td></td></tr></tfoot>`
    : '';

  corpo.innerHTML = `<div class="topo-energia">${periodos}${novo}</div>${vinculo}
    <div class="numeros-detalhe">${numerosHTML}</div>
    <div class="ferramentas-detalhe">${grandezas}</div>
    <div id="g-energia"></div>
    <div class="rolagem-energia"><table class="tabela-energia">
      <thead><tr><th>mês</th><th>consumo real</th><th>da concessionária</th><th>injetado</th><th>FV direto</th><th>custo integral</th><th>conta</th><th>economia</th><th>saldo de créditos</th></tr></thead>
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
      ...(registrados.some((m) => porMes.get(m).registro.saldo != null)
        ? [{ nome: 'saldo de créditos', cor: cor(5), fina: true, valores: calendario.map((m) => valor(m, (r) => r.saldo)) }]
        : []),
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
      if (r.saldo != null) partes.push(`saldo de créditos ${kwh(r.saldo)}`);
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

// O mês da fatura: o seletor de meses (sem dia), com ponto nos meses que já têm registro.
const avisoDeExistente = () => {
  const mes = campos().mes.value;
  $('en-existe').hidden = !(mes && app?.energia?.[mes] && mes !== editando);
};
const seletor = ligarSeletorDeMes($('en-mes'), {
  aoMudar: () => { avisoDeExistente(); aplicarLeituras(); },
  marcados: () => new Set(Object.keys(app?.energia ?? {})),
});

/** O mês anterior que tem leitura do medidor (antes de `mes`), ou null. */
function mesComLeituraAntes(mes) {
  return mesesDeEnergia(app).map((x) => x.registro)
    .filter((r) => r.mes < mes && r.leituraConsumo != null)
    .pop() ?? null;
}

/**
 * As leituras viram kWh: leitura atual − a do mês anterior (ou a "anterior" digitada, no primeiro mês).
 * Preenche os campos de kWh, que continuam podendo ser corrigidos à mão.
 */
function aplicarLeituras() {
  const f = campos();
  const mes = f.mes.value;
  const antes = mes ? mesComLeituraAntes(mes) : null;
  $('en-campo-ant-consumo').hidden = Boolean(antes);
  $('en-campo-ant-injetada').hidden = Boolean(antes);
  const nota = $('en-leituras-nota');
  const par = (atual, anterior, destino, nome) => {
    if (atual == null || anterior == null) return null;
    if (atual < anterior) { nota.textContent = `A leitura de ${nome} é menor que a anterior (${anterior}): confira os números.`; nota.hidden = false; return false; }
    destino.value = campoKwh(atual - anterior);
    return true;
  };
  nota.hidden = true;
  const consumoAtual = kwhDeTexto(f.leituraConsumo.value);
  const injetadaAtual = kwhDeTexto(f.leituraInjetada.value);
  const consumoAnt = antes ? antes.leituraConsumo : kwhDeTexto(f.antConsumo.value);
  const injetadaAnt = antes ? antes.leituraInjetada : kwhDeTexto(f.antInjetada.value);
  par(consumoAtual, consumoAnt, f.consumo, 'consumo');
  par(injetadaAtual, injetadaAnt, f.injetado, 'injeção');
  if (antes && (consumoAtual != null || injetadaAtual != null)) {
    nota.textContent = `Anterior (${nomeDoMes(antes.mes)}): consumo ${antes.leituraConsumo}${antes.leituraInjetada != null ? `, injeção ${antes.leituraInjetada}` : ''}.`;
    nota.hidden = false;
  }
}

function lerRegistro() {
  const f = campos();
  const dinheiro = (t) => (t.trim() ? Math.abs(deTexto(t)) : 0);
  return {
    mes: f.mes.value,
    consumo: kwhDeTexto(f.consumo.value),
    injetado: kwhDeTexto(f.injetado.value) ?? 0,
    leituraConsumo: kwhDeTexto(f.leituraConsumo.value),
    leituraInjetada: kwhDeTexto(f.leituraInjetada.value),
    antConsumo: mesComLeituraAntes(f.mes.value) ? null : kwhDeTexto(f.antConsumo.value),
    antInjetada: mesComLeituraAntes(f.mes.value) ? null : kwhDeTexto(f.antInjetada.value),
    producao: kwhDeTexto(f.producao.value),
    saldo: kwhDeTexto(f.saldo.value),
    minimo: kwhDeTexto(f.minimo.value),
    te6: tarifaDeTexto(f.te.value),
    tusd6: tarifaDeTexto(f.tusd.value),
    bandeira6: tarifaDeTexto(f.bandeira.value),
    ilum: dinheiro(f.ilum.value),
    conta: f.conta.value.trim() ? Math.abs(deTexto(f.conta.value)) : null,
    vencimento: f.vencimento.value || null,
  };
}

/** A conta ao vivo, embaixo dos campos, enquanto se digita. */
function pintarPrevia() {
  pintarSugestao();
  const reg = lerRegistro();
  const c = calculoDoMes(reg, creditosAntes(app, reg.mes));
  const saida = $('en-previa');
  if (!c) { saida.hidden = true; return; }
  saida.hidden = false;
  saida.innerHTML = `<span>direto do FV <strong>${kwh(c.diretoFV)}</strong></span><span>consumo real <strong>${kwh(c.consumoReal)}</strong></span>
    ${c.minimoPagar != null ? `<span>mínimo a pagar <strong>${reais(c.minimoPagar)}</strong> (${kwh(c.minimo)})</span><span>conta pelas leituras <strong>${reais(c.contaEsperada)}</strong></span>` : ''}
    <span>custo integral <strong>${reais(c.custoIntegral)}</strong></span>${c.economia != null ? `<span>economia <strong class="${c.economia >= 0 ? 'positivo' : 'negativo'}">${reais(c.economia)}</strong></span>` : ''}
    ${c.sobra > 0 ? `<span>injetou ${kwh(c.sobra)} a mais do que consumiu: vira crédito</span>` : ''}
    ${c.inconsistente ? '<span class="negativo">Injetou mais do que produziu: confira as leituras.</span>' : ''}`;
}

/** Sob o campo do saldo: o que as leituras sugerem, com um toque para usar. */
function pintarSugestao() {
  const f = campos();
  const consumo = kwhDeTexto(f.consumo.value);
  const s = f.mes.value && consumo != null ? sugestaoDeSaldo(app, f.mes.value, consumo, kwhDeTexto(f.injetado.value) ?? 0) : null;
  const saida = $('en-sugestao');
  if (!s) { saida.hidden = true; return; }
  const injetado = kwhDeTexto(f.injetado.value) ?? 0;
  saida.hidden = false;
  saida.innerHTML = `Pelas leituras: saldo anterior ${kwh(s.anterior)} + injetado ${kwh(injetado)} − consumo ${kwh(consumo)} = <strong>${kwh(s.sugerido)}</strong>.
    <button type="button" class="elo" data-en-usar="${s.sugerido}">usar</button> <span class="fino">O que vale é o saldo que a fatura mostra.</span>`;
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
  seletor.definir(existente ? existente.mes : ultimo ? somarMeses(`${ultimo.mes}-01`, 1).slice(0, 7) : hoje().slice(0, 7));
  avisoDeExistente();
  f.leituraConsumo.value = existente?.leituraConsumo != null ? campoKwh(existente.leituraConsumo) : '';
  f.leituraInjetada.value = existente?.leituraInjetada != null ? campoKwh(existente.leituraInjetada) : '';
  f.antConsumo.value = existente?.antConsumo != null ? campoKwh(existente.antConsumo) : '';
  f.antInjetada.value = existente?.antInjetada != null ? campoKwh(existente.antInjetada) : '';
  f.consumo.value = existente ? campoKwh(existente.consumo) : '';
  f.injetado.value = existente ? campoKwh(existente.injetado) : '';
  f.producao.value = existente ? campoKwh(existente.producao) : '';
  f.saldo.value = existente ? campoKwh(existente.saldo) : '';
  // O mínimo é do medidor, não do mês: o mês novo parte do último.
  f.minimo.value = campoKwh(existente ? existente.minimo : ultimo?.minimo);
  f.te.value = base.te6 ? tarifaParaTexto(base.te6) : '';
  f.tusd.value = base.tusd6 ? tarifaParaTexto(base.tusd6) : '';
  f.bandeira.value = base.bandeira6 ? tarifaParaTexto(base.bandeira6) : '';
  f.ilum.value = campoReais(base.ilum);
  f.conta.value = existente?.conta != null ? campoReais(existente.conta) : '';
  // O vencimento só aparece quando a fatura gera despesa numa conta; o do mês novo parte do anterior, um mês depois.
  const gera = Boolean(app.energiaConfig?.contaId);
  $('en-campo-vencimento').hidden = !gera;
  $('en-lanca').hidden = !gera;
  if (gera) $('en-lanca').textContent = `A fatura vira despesa agendada em ${app.contas[app.energiaConfig.contaId]?.nome ?? 'a conta escolhida'}, no vencimento: com o valor que você digitar ou, se ainda não tiver, estimado pelas leituras.`;
  f.vencimento.value = existente?.vencimento ?? (ultimo?.vencimento ? somarMeses(ultimo.vencimento, 1) : '');
  $('titulo-energia').textContent = existente ? `Registro de ${nomeDoMes(existente.mes)}` : 'Novo registro do mês';
  $('en-apagar').hidden = !existente;
  $('en-apagar').textContent = 'apagar este mês';
  $('en-aviso').hidden = true;
  // Os kWh do mês que vêm das leituras só se refazem quando se mexe nelas (o que está gravado vale ao reabrir).
  const nota = $('en-leituras-nota');
  nota.hidden = true;
  const antes = mesComLeituraAntes(f.mes.value);
  $('en-campo-ant-consumo').hidden = Boolean(antes);
  $('en-campo-ant-injetada').hidden = Boolean(antes);
  pintarPrevia();
  $('dialogo-energia').showModal();
  f.leituraConsumo.focus();
}

const avisar = (t) => { $('en-aviso').textContent = t; $('en-aviso').hidden = !t; };

async function salvar() {
  const r = lerRegistro();
  if (!/^\d{4}-\d{2}$/.test(r.mes)) return avisar('Escolha o mês da fatura.');
  if (r.consumo == null) return avisar('Falta o consumo da concessionária, em kWh.');
  if (r.producao == null) return avisar('Falta o que o sistema produziu no mês, em kWh.');
  if (!r.te6 || !r.tusd6) return avisar('Faltam as tarifas TE e TUSD (R$/kWh, com tributos).');
  // Mudou o mês de um registro que já existia: o antigo sai, o novo entra.
  if (editando && editando !== r.mes) {
    await estado.aplicarEvento('energia.removida', { mes: editando });
    await sincronizarFatura({ mes: editando, removido: true });
  }
  await estado.aplicarEvento('energia.registrada', r);
  await sincronizarFatura(r);
  $('dialogo-energia').close();
  await pintar();
}

// ── a despesa da fatura ──────────────────────────────────────────────────────

/** A categoria "Energia elétrica": a que já existe, ou uma nova. */
async function categoriaDaEnergia() {
  const a = await estado.calcular();
  const achada = Object.values(a.categorias).find((c) => !c.arquivada && c.natureza === 'despesa' && /energia/i.test(c.nome));
  if (achada) return achada.id;
  await estado.aplicarEvento('categoria.criada', { id: 'cat-energia', nome: 'Energia elétrica', natureza: 'despesa' });
  return 'cat-energia';
}

/**
 * Faz a despesa da fatura acompanhar o registro do mês: cria, corrige ou tira. Só mexe enquanto ela não foi
 * confirmada (paga): depois de paga, é um fato da conta e fica como está.
 */
async function sincronizarFatura(registro) {
  const a = await estado.calcular();
  const id = `energia-${registro.mes}`;
  const atual = a.lancamentos[id] && !a.lancamentos[id].removido ? a.lancamentos[id] : null;
  // A fatura do mês existe mesmo sem o valor digitado: nasce com a conta estimada pelas leituras e passa a valer a
  // do papel quando ela é digitada.
  const calc = registro.removido ? null : calculoDoMes(registro, creditosAntes(a, registro.mes));
  const estimada = registro.conta == null && calc?.contaEsperada > 0;
  const comValor = estimada ? { ...registro, conta: calc.contaEsperada, estimada: true } : registro;
  const quer = !registro.removido && lancamentoDaFatura(a.energiaConfig, comValor, null);
  if (!quer) {
    if (atual && !atual.confirmado) await estado.aplicarEvento('lancamento.removido', { id });
    return;
  }
  const dados = lancamentoDaFatura(a.energiaConfig, comValor, await categoriaDaEnergia());
  if (!atual) await estado.aplicarEvento('lancamento.registrado', dados);
  else if (!atual.confirmado) {
    const { tipo, confirmado, energiaMes, ...campos } = dados;
    await estado.aplicarEvento('lancamento.alterado', campos);
  }
}

async function apagar() {
  if (!editando) return;
  if (!confirmaApagar) {
    confirmaApagar = true;
    $('en-apagar').textContent = 'toque de novo para apagar';
    return;
  }
  await estado.aplicarEvento('energia.removida', { mes: editando });
  await sincronizarFatura({ mes: editando, removido: true });
  $('dialogo-energia').close();
  await pintar();
}

// ── o vínculo com o envelope e com a conta ────────────────────────────────────

const seletorDesde = ligarSeletorDeMes($('env-desde'));
const vinc = () => $('f-energia-vinculo').elements;

function abrirVinculo() {
  const cfg = app.energiaConfig;
  const f = vinc();
  $('env-envelope').innerHTML = `<option value="">nenhum (desligado)</option>${envelopesAtivos(app)
    .map((v) => `<option value="${esc(v.id)}">${esc(v.nome)}</option>`).join('')}`;
  // Envelope arquivado ou encerrado continua como opção: salvar não pode desligar o vínculo sem avisar (G2).
  if (cfg?.envelopeId && app.envelopes?.[cfg.envelopeId] && ![...f.envelope.options].some((o) => o.value === cfg.envelopeId)) {
    $('env-envelope').insertAdjacentHTML('beforeend', `<option value="${esc(cfg.envelopeId)}">${esc(app.envelopes[cfg.envelopeId].nome)} (fora da lista)</option>`);
  }
  f.envelope.value = cfg?.envelopeId ?? '';
  const primeiro = mesesDeEnergia(app)[0]?.registro.mes ?? hoje().slice(0, 7);
  seletorDesde.definir(cfg?.desde ?? primeiro);
  f.meses.value = cfg?.defasagem ?? 2;
  const contas = Object.values(app.contas).filter((c) => !c.arquivada && (c.tipo === 'corrente' || c.tipo === 'especie'))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  $('env-conta').innerHTML = `<option value="">não gerar a despesa</option>${contas.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('')}`;
  if (cfg?.contaId && app.contas[cfg.contaId] && ![...f.conta.options].some((o) => o.value === cfg.contaId)) {
    $('env-conta').insertAdjacentHTML('beforeend', `<option value="${esc(cfg.contaId)}">${esc(app.contas[cfg.contaId].nome)} (arquivada)</option>`);
  }
  f.conta.value = cfg?.contaId ?? '';
  $('env-aviso').hidden = true;
  mostrarCamposDoVinculo();
  $('dialogo-energia-vinculo').showModal();
}

function mostrarCamposDoVinculo() {
  const ligado = Boolean(vinc().envelope.value);
  $('env-campo-desde').hidden = !ligado;
  $('env-campo-meses').hidden = !ligado;
}

async function salvarVinculo() {
  const f = vinc();
  const envelopeId = f.envelope.value || null;
  if (envelopeId && !f.desde.value) { $('env-aviso').textContent = 'Escolha o mês de economia em que a cobrança começa.'; $('env-aviso').hidden = false; return; }
  const antes = app.energiaConfig;
  let desde = f.desde.value || null;
  // Trocar de envelope sem mexer no mês herdaria, no novo, a cobrança de meses que não são dele (auditoria M2).
  if (envelopeId && antes?.envelopeId && envelopeId !== antes.envelopeId && desde === antes.desde && desde < hoje().slice(0, 7)
    && confirm(`O novo envelope passaria a cobrar a economia desde ${desde}. Começar a cobrar só a partir deste mês?`)) {
    desde = hoje().slice(0, 7);
  }
  await estado.aplicarEvento('energia.configurada', {
    envelopeId,
    desde,
    defasagem: Math.max(0, Math.min(12, Number(f.meses.value) || 0)),
    contaId: f.conta.value || null,
  });
  $('dialogo-energia-vinculo').close();
  await pintar();
}

$('f-energia-vinculo')?.addEventListener('change', mostrarCamposDoVinculo);
$('f-energia-vinculo')?.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'salvar') return;
  e.preventDefault();
  await salvarVinculo();
});

// ── ligações ─────────────────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  if (!ativa) return;
  if (e.target.closest('[data-en-novo]')) return abrir();
  if (e.target.closest('[data-en-vinculo]')) return abrirVinculo();
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

$('f-energia')?.addEventListener('input', (ev) => {
  if (['leituraConsumo', 'leituraInjetada', 'antConsumo', 'antInjetada'].includes(ev.target.name)) aplicarLeituras();
  pintarPrevia();
});
$('f-energia')?.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'salvar') return;
  e.preventDefault();
  await salvar();
});
$('en-apagar')?.addEventListener('click', apagar);
$('en-sugestao')?.addEventListener('click', (e) => {
  const usar = e.target.closest('[data-en-usar]');
  if (!usar) return;
  campos().saldo.value = campoKwh(Number(usar.dataset.enUsar));
  pintarPrevia();
});

document.addEventListener('app:tela', (e) => {
  ativa = e.detail.tela === 'energia';
  if (ativa) pintar();
});
estado.aoAplicar(() => pintar());
