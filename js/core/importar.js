// Importar extrato e fatura (design/13 §2 e §3). Tudo aqui é lido no próprio
// aparelho: o arquivo nunca sai dele.
//
// Três peças, sem tela:
//   ler      — OFX (o formato de extrato dos bancos) e CSV (cada banco à sua
//              maneira: as colunas se acham sozinhas, ou se dizem uma vez);
//   regras   — o texto do banco, limpo, vira categoria (e o que mais se ensinou);
//   casar    — cada linha do arquivo contra o que já existe: já importada, já
//              lançada à mão (ou prevista, ou automática), ou nova.

import { lancados, visiveis, sinalDeSaida } from './lancamentos.js';
import { ocorrenciasPrevistas } from './previsto.js';
import { cicloDaCompra, temCiclo } from './cartao.js';
import { somarDias, hoje } from './datas.js';

// ── ler o arquivo ───────────────────────────────────────────────────────────

/**
 * Bytes do arquivo → texto. O OFX antigo vem em windows-1252 (acentos), o
 * novo em UTF-8: tenta UTF-8 a sério, e cai para 1252 se não for.
 */
export function decodificar(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** "1.234,56", "-1234.56", "R$ -12,34", "(12,34)" → centavos com sinal. */
export function lerValor(texto) {
  let t = String(texto ?? '').trim().replace(/\s|R\$/g, '');
  if (!t) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
  if (t.endsWith('-')) { negativo = true; t = t.slice(0, -1); }
  if (t.startsWith('-')) { negativo = !negativo; t = t.slice(1); }
  if (t.startsWith('+')) t = t.slice(1);
  if (/[DdCc]$/.test(t)) { if (/[Dd]$/.test(t)) negativo = !negativo; t = t.slice(0, -1); }
  // O separador decimal é o ÚLTIMO de vírgula ou ponto, se tiver 1 ou 2 dígitos depois.
  const m = t.match(/[.,](\d{1,2})$/);
  const inteiro = m ? t.slice(0, -m[0].length) : t;
  const decimal = m ? m[1].padEnd(2, '0') : '00';
  const limpo = inteiro.replace(/[.,]/g, '');
  if (!/^\d+$/.test(limpo || '0') || !/^\d+$/.test(decimal)) return null;
  const centavos = Number(limpo || '0') * 100 + Number(decimal);
  return negativo ? -centavos : centavos;
}

/** "20261003", "2026-10-03", "03/10/2026", "03/10/26" → '2026-10-03'. */
export function lerData(texto) {
  const t = String(texto ?? '').trim();
  let m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * O OFX (SGML antigo ou XML novo): as transações, a conta e o saldo do fim.
 * { tipo: 'conta'|'cartao', conta: { banco, numero }, linhas: [{ fitid, data,
 *   valor, texto }], saldo: { valor, data } | null }
 */
export function lerOFX(texto) {
  const campo = (bloco, tag) => {
    const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const linhas = [];
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  for (const b of blocos) {
    const bloco = b.split(/<\/STMTTRN>/i)[0];
    const data = lerData(campo(bloco, 'DTPOSTED'));
    const valor = lerValor(campo(bloco, 'TRNAMT'));
    if (!data || valor == null) continue;
    const memo = campo(bloco, 'MEMO');
    const nome = campo(bloco, 'NAME');
    linhas.push({
      fitid: campo(bloco, 'FITID') || null,
      data,
      valor,
      texto: [nome, memo].filter(Boolean).filter((x, i, l) => l.indexOf(x) === i).join(' ').replace(/\s+/g, ' ').trim(),
    });
  }
  const cartao = /<CCSTMTRS>|<CCACCTFROM>/i.test(texto);
  const saldoValor = lerValor(campo(texto.split(/<LEDGERBAL>/i)[1] ?? '', 'BALAMT'));
  const saldoData = lerData(campo(texto.split(/<LEDGERBAL>/i)[1] ?? '', 'DTASOF'));
  // Linhas sem número do banco ganham um, estável, para reimportar sem duplicar.
  numerarSemId(linhas, 'ofx');
  return {
    formato: 'ofx',
    tipo: cartao ? 'cartao' : 'conta',
    conta: { banco: campo(texto, 'BANKID') || campo(texto, 'ORG'), numero: campo(texto, 'ACCTID') },
    linhas,
    saldo: saldoValor != null && saldoData ? { valor: saldoValor, data: saldoData } : null,
  };
}

function numerarSemId(linhas, prefixo) {
  const vistos = new Map();
  for (const l of linhas) {
    if (l.fitid) continue;
    const base = `${prefixo}:${l.data}:${l.valor}:${chave(l.texto)}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    l.fitid = `${base}:${n}`;
  }
}

/** Divide uma linha de CSV respeitando aspas. */
function dividir(linha, sep) {
  const saida = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') { atual += '"'; i += 1; } else aspas = !aspas;
    } else if (c === sep && !aspas) {
      saida.push(atual.trim());
      atual = '';
    } else {
      atual += c;
    }
  }
  saida.push(atual.trim());
  return saida;
}

const sem = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * O CSV cru: o separador, as linhas e o palpite de quais colunas são data,
 * descrição, valor (ou débito e crédito). { cabecalho, linhas, mapa, inicio }
 */
export function lerCSV(texto) {
  const todas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const amostra = todas.slice(0, 20).join('\n');
  const sep = [';', '\t', ','].map((s) => ({ s, n: (amostra.match(new RegExp(s === '\t' ? '\\t' : `\\${s}`, 'g')) ?? []).length }))
    .sort((a, b) => b.n - a.n)[0].s;
  const linhas = todas.map((l) => dividir(l, sep));
  // O cabeçalho é a primeira linha cuja seguinte já tem uma data.
  let inicio = 0;
  for (let i = 0; i < Math.min(linhas.length - 1, 15); i += 1) {
    if (linhas[i + 1].some((c) => lerData(c)) && !linhas[i].some((c) => lerData(c))) { inicio = i; break; }
  }
  const cabecalho = linhas[inicio].map((c, i) => c || `coluna ${i + 1}`);
  const corpo = linhas.slice(inicio + 1).filter((l) => l.some((c) => lerData(c)));
  return { formato: 'csv', separador: sep, cabecalho, linhas: corpo, mapa: adivinharColunas(cabecalho, corpo) };
}

/** Qual coluna é o quê, pelo nome e, se preciso, pelo conteúdo. */
export function adivinharColunas(cabecalho, corpo) {
  const nomes = cabecalho.map(sem);
  const achar = (...termos) => nomes.findIndex((n) => termos.some((t) => n.includes(t)));
  const mapa = {
    data: achar('data', 'date', 'dt '),
    texto: achar('descri', 'histor', 'lancamento', 'estabelecimento', 'titulo', 'memo', 'detalhe', 'title', 'description'),
    valor: achar('valor', 'quantia', 'montante', 'amount', 'value'),
    debito: achar('debito', 'saida', 'saque'),
    credito: achar('credito', 'entrada', 'deposito'),
  };
  if (mapa.valor >= 0 && (mapa.valor === mapa.debito || mapa.valor === mapa.credito)) mapa.valor = -1;
  if (mapa.data < 0) mapa.data = cabecalho.findIndex((_, i) => corpo.slice(0, 5).every((l) => lerData(l[i])));
  if (mapa.valor < 0 && mapa.debito < 0) {
    // A última coluna que é sempre número.
    for (let i = cabecalho.length - 1; i >= 0; i -= 1) {
      if (i !== mapa.data && corpo.slice(0, 5).every((l) => lerValor(l[i]) != null)) { mapa.valor = i; break; }
    }
  }
  if (mapa.texto < 0) {
    // A coluna com mais texto.
    let melhor = -1;
    let maior = 0;
    cabecalho.forEach((_, i) => {
      if (i === mapa.data || i === mapa.valor) return;
      const tam = corpo.slice(0, 10).reduce((t, l) => t + (lerValor(l[i]) == null ? (l[i] ?? '').length : 0), 0);
      if (tam > maior) { maior = tam; melhor = i; }
    });
    mapa.texto = melhor;
  }
  return mapa;
}

/** As linhas do CSV, com o mapa de colunas: [{ fitid, data, valor, texto }]. */
export function linhasDoCSV(csv, mapa = csv.mapa, { inverter = false } = {}) {
  const linhas = [];
  for (const l of csv.linhas) {
    const data = lerData(l[mapa.data]);
    let valor = null;
    if (mapa.valor >= 0) valor = lerValor(l[mapa.valor]);
    else {
      const d = mapa.debito >= 0 ? lerValor(l[mapa.debito]) : null;
      const c = mapa.credito >= 0 ? lerValor(l[mapa.credito]) : null;
      if (d) valor = -Math.abs(d);
      else if (c) valor = Math.abs(c);
    }
    if (!data || valor == null || valor === 0) continue;
    linhas.push({ fitid: null, data, valor: inverter ? -valor : valor, texto: String(l[mapa.texto] ?? '').replace(/\s+/g, ' ').trim() });
  }
  numerarSemId(linhas, 'csv');
  return linhas;
}

// ── regras ──────────────────────────────────────────────────────────────────

// As palavras que todo banco põe e não dizem nada de quem recebeu.
const VAZIAS = new Set([
  'compra', 'compras', 'cartao', 'credito', 'debito', 'pix', 'enviado', 'enviada', 'recebido', 'recebida',
  'pagamento', 'pagto', 'pgto', 'pag', 'ted', 'doc', 'transferencia', 'transf', 'aut', 'autorizacao',
  'nr', 'no', 'num', 'de', 'da', 'do', 'das', 'dos', 'em', 'para', 'p', 'a', 'o', 'e', 'com', 'via',
  'internet', 'app', 'elo', 'visa', 'master', 'mastercard', 'maestro', 'nacional', 'int', 'br', 'bra',
  'parc', 'parcela', 'ltda', 'me', 'sa', 'eireli', 'epp', 'cp', 'cd', 'cartoes',
]);

/**
 * O texto do banco, limpo para comparar: sem acento, sem número, sem as
 * palavras que todo banco põe. "COMPRA CARTAO POSTO SHELL 123" → "posto shell".
 */
export function chave(texto) {
  const palavras = sem(texto).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((p) => p.length > 1 && !VAZIAS.has(p));
  return palavras.slice(0, 4).join(' ');
}

/** O id de uma regra é o próprio texto: os dois celulares chegam à mesma regra. */
export const idDaRegra = (padrao) => `regra:${padrao}`;

/**
 * A regra para um texto do banco: a de padrão igual à chave; senão, a de padrão
 * mais longo contido nela (palavra inteira). Ou null.
 */
export function regraPara(estado, texto) {
  const k = chave(texto);
  if (!k) return null;
  const regras = Object.values(estado.regras ?? {});
  const igual = regras.find((r) => r.padrao === k);
  if (igual) return igual;
  const contidas = regras.filter((r) => r.padrao && ` ${k} `.includes(` ${r.padrao} `))
    .sort((a, b) => b.padrao.length - a.padrao.length);
  return contidas[0] ?? null;
}

/** Quantas vezes cada regra acertou: lançamentos com texto do banco que ela cobre, na categoria dela. */
export function usosDasRegras(estado) {
  const usos = new Map();
  for (const l of lancados(estado)) {
    if (!l.textoBanco) continue;
    const r = regraPara(estado, l.textoBanco);
    if (r && r.categoriaId === l.categoriaId) usos.set(r.id, (usos.get(r.id) ?? 0) + 1);
  }
  return usos;
}

// ── casar com o que já existe ───────────────────────────────────────────────

const diasEntre = (a, b) => Math.abs((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 86400000);

/**
 * Cada linha do arquivo, decidida. `linhas`: [{ fitid, data, valor, texto }],
 * valor com sinal (negativo = saiu da conta; no cartão, negativo = compra).
 * `fatura` (só cartão): o fechamento do ciclo da fatura que se está importando.
 *
 * Devolve [{ ...linha, situacao: 'importada'|'lancada'|'prevista'|'nova',
 *   lancamento?, ocorrencia?, sugestao: { tipo, categoriaId, detalheId,
 *   etiquetas, regraId } }]
 */
export function casar(estado, contaId, linhas, { fatura = null, dia = hoje() } = {}) {
  const conta = estado.contas[contaId];
  const cartao = conta?.tipo === 'cartao';
  const fitidsDaConta = new Set(lancados(estado)
    .filter((l) => l.fitid && (l.contaId === contaId || l.contaDestinoId === contaId)).map((l) => l.fitid));
  const ignorados = new Set(Object.keys(estado.importIgnorados ?? {}));
  const usados = new Set();
  // O que pode casar: o lançado (com ou sem número do banco ainda), as
  // parcelas automáticas de contrato e as ocorrências previstas.
  const candidatos = visiveis(estado, dia).filter((l) => !l.fitid && (l.contaId === contaId || l.contaDestinoId === contaId));
  const previstas = ocorrenciasPrevistas(estado, somarDias(linhas.reduce((m, l) => (l.data < m ? l.data : m), dia), -5), somarDias(dia, 40), dia, { comPassado: true })
    .filter((o) => o.contaId === contaId || o.contaDestinoId === contaId);

  // O sinal do movimento visto desta conta: negativo = saiu dela.
  const efeito = (l) => (l.contaDestinoId === contaId && l.contaId !== contaId ? l.valor : -sinalDeSaida(l));
  const perto = (l, linha) => {
    if (cartao && fatura && l.cicloFatura) return l.cicloFatura === fatura;
    const d = cartao ? l.dataCompetencia : l.dataCaixa;
    return diasEntre(d, linha.data) <= (cartao ? 5 : 3);
  };

  return linhas.map((linha) => {
    const base = { ...linha, sugestao: sugerir(estado, linha, cartao) };
    if (fitidsDaConta.has(linha.fitid) || ignorados.has(`${contaId}|${linha.fitid}`)) {
      return { ...base, situacao: ignorados.has(`${contaId}|${linha.fitid}`) ? 'ignorada' : 'importada' };
    }
    const achar = (lista) => lista
      .filter((l) => !usados.has(l.id) && efeito(l) === linha.valor && perto(l, linha))
      .sort((a, b) => diasEntre(cartao ? a.dataCompetencia : a.dataCaixa, linha.data) - diasEntre(cartao ? b.dataCompetencia : b.dataCaixa, linha.data))[0];
    const l = achar(candidatos);
    if (l) { usados.add(l.id); return { ...base, situacao: 'lancada', lancamento: l }; }
    const o = achar(previstas);
    if (o) { usados.add(o.id); return { ...base, situacao: 'prevista', ocorrencia: o }; }
    return { ...base, situacao: 'nova' };
  });
}

/** O que a linha nova deve virar: o tipo pelo sinal e a categoria da regra. */
function sugerir(estado, linha, cartao) {
  const r = regraPara(estado, linha.texto);
  const entra = linha.valor > 0;
  // No cartão, o que entra é quase sempre o pagamento da fatura: transferência
  // da conta que paga.
  if (cartao && entra && /pag/i.test(linha.texto)) return { tipo: 'transferencia', contaOutra: null, pagamento: true, regraId: null };
  const tipo = cartao ? (entra ? 'estorno' : 'despesa') : entra ? 'receita' : 'despesa';
  const natureza = tipo === 'receita' ? 'receita' : 'despesa';
  const categoriaOk = r?.categoriaId && (estado.categorias[r.categoriaId]?.natureza ?? 'despesa') === natureza;
  if (r?.transferePara) return { tipo: 'transferencia', contaOutra: r.transferePara, regraId: r.id };
  return {
    tipo: cartao && entra ? 'estorno' : tipo,
    categoriaId: categoriaOk ? r.categoriaId : null,
    detalheId: categoriaOk ? r.detalheId ?? null : null,
    etiquetas: categoriaOk ? r.etiquetas ?? [] : [],
    regraId: categoriaOk ? r.id : null,
  };
}

/**
 * O deslocamento de fatura para uma compra de `data` cair na fatura que fecha
 * em `fechamento` (a parcela 3/10 com data de meses atrás, por exemplo).
 */
export function deslocamentoParaFatura(conta, data, fechamento) {
  if (!temCiclo(conta) || !fechamento) return 0;
  const natural = cicloDaCompra(conta, data).fechamento;
  const meses = (Number(fechamento.slice(0, 4)) - Number(natural.slice(0, 4))) * 12
    + (Number(fechamento.slice(5, 7)) - Number(natural.slice(5, 7)));
  return meses;
}
