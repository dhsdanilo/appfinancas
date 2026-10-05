// Envelopes: de quem é o dinheiro (design/11-envelopes.md).
//
// Duas operações independentes (§3): MOVER muda onde o dinheiro está e leva o
// dono junto; APORTAR e RESGATAR do envelope (a alocação) mudam de quem ele é,
// sempre no mesmo lugar, sem mexer em saldo de conta nenhuma. Dinheiro novo
// chega sem dono.
//
// Lugar é onde o dinheiro está de fato (§2):
//   ativo          — o CDB, o Tesouro, a ação: o envelope é dono de uma FRAÇÃO
//   conta que rende — poupança, cofrinho (investimento sem ativos): FRAÇÃO
//   caixa          — corrente, espécie, caixa parado da corretora: VALOR FIXO
//
// A fração vira "cotas internas": quem entra num lugar que rende compra cotas
// pelo valor do lugar naquele dia, e cada um vale cotas × valor ÷ cotas. É o
// que divide o rendimento (e a perda) sem passo nenhum. No caixa, o envelope
// tem reais; o sem dono é o saldo menos o que os envelopes têm ali.
//
// Nada daqui é gravado: tudo sai dos lançamentos (com `donos`) e das alocações.

import { hoje, somarMeses, fimDoMes } from './datas.js';
import { visiveis, saldoReal, sinalDeSaida } from './lancamentos.js';
import { posicao, resumoDaConta, ativosDaConta, saldoAte } from './investimentos.js';

const SEM_DONO = '';

/** Os envelopes em uso, os arquivados por último. Encerrado não está em uso (D18). */
export function envelopesAtivos(estado, { comArquivados = false, comEncerrados = false } = {}) {
  return Object.values(estado.envelopes ?? {})
    .filter((v) => (comArquivados || !v.arquivado) && (comEncerrados || !v.encerradoEm))
    .sort((a, b) => Number(a.arquivado) - Number(b.arquivado) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Projeto tem data; o que acumula, não (§1). */
export const ehProjeto = (envelope) => Boolean(envelope.alvoData);

/** A despesa paga com o dinheiro de um envelope (D18, design/11 §8). */
const ehCusteio = (l) => l.tipo === 'despesa' && Boolean(l.custeadoPor);

/** O dia em que o movimento conta: o da compra no ativo e no gasto do envelope (no cartão também). */
const diaDoMovimento = (l) => (l.ativoId || ehCusteio(l) ? l.dataCompetencia : l.dataCaixa);

/**
 * O estado do envelope (D18), calculado: juntando · completo · em uso ·
 * encerrado. `r` é o do `donosNoDia`.
 */
export function estadoDoEnvelope(envelope, r) {
  if (envelope.encerradoEm) return 'encerrado';
  if ((r?.custo ?? 0) > 0) return 'em uso';
  if (envelope.alvoValor != null && (r?.total ?? 0) >= envelope.alvoValor) return 'completo';
  return 'juntando';
}

// ── lugares ─────────────────────────────────────────────────────────────────

/** O lugar de uma conta: { id, tipo: 'caixa'|'fracao' } ou null (cartão, dívida, folha). */
export function lugarDaConta(estado, contaId) {
  const c = contaId ? estado.contas[contaId] : null;
  if (!c) return null;
  if (c.tipo === 'corrente' || c.tipo === 'especie') return { id: c.id, tipo: 'caixa' };
  if (c.tipo !== 'investimento' || c.caixaEm) return null;
  // Na própria corretora: com ativos, o que sobra é caixa parado; sem ativos
  // (poupança), a conta inteira rende.
  return ativosDaConta(estado, c.id).length ? { id: c.id, tipo: 'caixa' } : { id: c.id, tipo: 'fracao' };
}

/** Todos os lugares onde pode haver dinheiro de envelope, com o nome e o valor no dia. */
export function lugares(estado, dia = hoje()) {
  const lista = [];
  for (const c of Object.values(estado.contas)) {
    const l = lugarDaConta(estado, c.id);
    if (!l) continue;
    lista.push({ ...l, nome: c.nome, contaId: c.id, arquivado: c.arquivada, valor: valorDoLugar(estado, l, dia) });
  }
  for (const a of Object.values(estado.ativos ?? {})) {
    const conta = estado.contas[a.contaId];
    lista.push({
      id: a.id, tipo: 'fracao', ativo: true, nome: a.nome, contaId: a.contaId,
      contaNome: conta?.nome ?? '', arquivado: a.arquivado, valor: valorDoLugar(estado, { id: a.id, tipo: 'fracao', ativo: true }, dia),
    });
  }
  return lista;
}

function valorDoLugar(estado, lugar, dia) {
  if (lugar.ativo || estado.ativos?.[lugar.id]) return posicao(estado, lugar.id, dia)?.valorAtual ?? 0;
  if (lugar.tipo === 'fracao') return resumoDaConta(estado, estado.contas[lugar.id], dia).valorAtual;
  return dia === hoje() ? saldoReal(estado, lugar.id) : saldoAte(estado, lugar.id, dia);
}

/** O lugar de um id qualquer: ativo ou conta. */
function lugarDoId(estado, id) {
  if (!id) return null;
  if (estado.ativos?.[id]) return { id, tipo: 'fracao', ativo: true };
  return lugarDaConta(estado, id);
}

// ── o cálculo ───────────────────────────────────────────────────────────────

/**
 * Os movimentos de um lançamento entre lugares: de onde sai e para onde vai.
 * Só interessam os que tocam um lugar que rende ou levam dono.
 */
function movimentoDe(estado, l) {
  // O gasto pago pelo envelope: sai do que ele tem na conta que pagou — no
  // cartão, a que paga a fatura (design/11 §8). O que faltar é estouro.
  if (ehCusteio(l)) {
    const conta = estado.contas[l.contaId];
    const paga = conta?.tipo === 'cartao' ? conta.pagaCom : l.contaId;
    return {
      l, de: lugarDaConta(estado, paga), para: null, valor: l.valor, custeio: true,
      donos: [{ envelopeId: l.custeadoPor, valor: l.valor }], data: l.dataCompetencia,
    };
  }
  let de = null;
  let para = null;
  let valor = l.valor;
  if (l.ativoId && (l.tipo === 'aplicacao' || l.tipo === 'resgate')) {
    const conta = lugarDaConta(estado, l.contaId);
    const ativo = estado.ativos?.[l.ativoId] ? { id: l.ativoId, tipo: 'fracao', ativo: true } : null;
    if (l.tipo === 'aplicacao') { de = conta; para = ativo; } else { de = ativo; para = conta; }
  } else if (l.contaDestinoId) {
    de = lugarDaConta(estado, l.contaId);
    para = lugarDaConta(estado, l.contaDestinoId);
  } else {
    const s = sinalDeSaida(l);
    if (s > 0) de = lugarDaConta(estado, l.contaId);
    else para = lugarDaConta(estado, l.contaId);
    valor = Math.abs(s);
  }
  const donos = (l.donos ?? []).filter((d) => d.envelopeId && d.valor > 0);
  const rende = (x) => x?.tipo === 'fracao';
  if (!rende(de) && !rende(para) && !donos.length) return null;
  if (!de && !para) return null;
  return { l, de, para, valor, donos, data: diaDoMovimento(l) };
}

/**
 * De quem é o dinheiro no dia. Devolve:
 *   porLugar   Map lugarId → { lugar, valor, donos: Map(envelopeId|'' → centavos), semDono }
 *   porEnvelope Map envelopeId → { total, porLugar: Map, posto, rendeu, extrato[] }
 *   semDono    total sem dono nos lugares
 *
 * O extrato de cada envelope tem os aportes, resgates, remanejamentos e as
 * mudanças de lugar (§3, o "fluxo organizado" que ele pediu).
 */
export function donosNoDia(estado, dia = hoje()) {
  const inteiroDe = new Map();
  for (const v of Object.values(estado.envelopes ?? {})) {
    for (const lugarId of v.inteiros ?? []) inteiroDe.set(lugarId, v.id);
  }

  // Cotas internas de cada lugar que rende; reais de cada envelope no caixa.
  const cotas = new Map();   // lugarId → Map(dono → cotas)
  const caixa = new Map();   // lugarId → Map(envelopeId → centavos)
  const extrato = new Map(); // envelopeId → [linhas]
  const posto = new Map();   // envelopeId → o que entrou menos o que saiu do envelope
  const gastos = new Map();  // envelopeId → { custo, financiado, pagamentos, porCategoria }
  const doLugar = (mapa, id) => { if (!mapa.has(id)) mapa.set(id, new Map()); return mapa.get(id); };
  const soma = (m) => [...m.values()].reduce((t, v) => t + v, 0);
  const somar = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
  const anotar = (envelopeId, linha) => {
    if (!envelopeId) return;
    if (!extrato.has(envelopeId)) extrato.set(envelopeId, []);
    extrato.get(envelopeId).push(linha);
  };

  const movimentos = visiveis(estado, dia)
    .filter((l) => l.confirmado && diaDoMovimento(l) <= dia)
    .map((l) => movimentoDe(estado, l))
    .filter(Boolean);
  const alocacoes = Object.values(estado.alocacoes ?? {}).filter((a) => !a.removida && a.data <= dia);

  const dias = [...new Set([...movimentos.map((m) => m.data), ...alocacoes.map((a) => a.data)])].sort();

  for (const d of dias) {
    // O preço da cota no dia: o valor do lugar no dia, sem o que entrou e saiu
    // nele, ÷ as cotas. O valor informado hoje vale para o aporte de hoje — é
    // sobre ele que se distribui. Fica o mesmo o dia inteiro: entrar e sair
    // não mudam o preço de quem já está.
    const doDia = movimentos.filter((x) => x.data === d);
    const precos = new Map();
    const preco = (lugar) => {
      if (precos.has(lugar.id)) return precos.get(lugar.id);
      const c = doLugar(cotas, lugar.id);
      const fluxo = doDia.reduce((t, m) => t + (m.para?.id === lugar.id ? m.valor : 0) - (m.de?.id === lugar.id ? m.valor : 0), 0);
      const valor = valorDoLugar(estado, lugar, d) - fluxo;
      let total = soma(c);
      if (total > 0 && valor <= 0) { c.clear(); total = 0; }
      // Valor sem dono de cota nenhuma (o que já estava lá antes): sem dono.
      if (total <= 0 && valor > 0) {
        const dono = inteiroDe.get(lugar.id);
        c.set(dono ?? SEM_DONO, valor);
        // Do envelope dono do lugar inteiro, isso foi posto — não rendimento.
        if (dono) somar(posto, dono, valor);
        total = valor;
      }
      const p = total > 0 ? valor / total : 1;
      precos.set(lugar.id, p);
      return p;
    };

    const processarMovimento = (m) => {
      // Quem sai: os donos ditos, e o resto do sem dono (depois do envelope
      // "inteiro" do lugar, e por último de todos na proporção).
      const efetivos = new Map();
      if (m.de?.tipo === 'fracao') {
        const p = preco(m.de);
        const c = doLugar(cotas, m.de.id);
        let falta = m.valor / p;
        const tirar = (dono, quanto) => {
          const tem = c.get(dono) ?? 0;
          const t = Math.min(tem, quanto);
          if (t <= 0) return 0;
          c.set(dono, tem - t);
          if (dono !== SEM_DONO) somar(efetivos, dono, t * p);
          return t;
        };
        for (const dn of m.donos) falta -= tirar(dn.envelopeId, dn.valor / p);
        falta -= tirar(SEM_DONO, falta);
        const inteiro = inteiroDe.get(m.de.id);
        if (inteiro && falta > 0) falta -= tirar(inteiro, falta);
        const resto = soma(c);
        if (falta > 1e-9 && resto > 0) {
          const parte = Math.min(1, falta / resto);
          for (const [dono, tem] of [...c.entries()]) tirar(dono, tem * parte);
        }
      } else if (m.de?.tipo === 'caixa') {
        const c = doLugar(caixa, m.de.id);
        for (const dn of m.donos) {
          const t = Math.min(c.get(dn.envelopeId) ?? 0, dn.valor);
          if (t <= 0) continue;
          c.set(dn.envelopeId, (c.get(dn.envelopeId) ?? 0) - t);
          somar(efetivos, dn.envelopeId, t);
        }
      }

      // Quem chega: os mesmos donos; o resto chega sem dono — ou no envelope
      // de quem o lugar é inteiro.
      const comDono = soma(efetivos);
      if (m.para?.tipo === 'fracao') {
        const p = preco(m.para);
        const c = doLugar(cotas, m.para.id);
        for (const [dono, v] of efetivos) somar(c, dono, v / p);
        const resto = Math.max(0, m.valor - comDono);
        const inteiro = inteiroDe.get(m.para.id);
        somar(c, inteiro ?? SEM_DONO, resto / p);
        if (inteiro && resto > 0) {
          somar(posto, inteiro, resto);
          anotar(inteiro, { data: d, tipo: 'entrou', valor: Math.round(resto), lugar: m.para.id, lancamentoId: m.l.id, lc: m.l.lc ?? 0 });
        }
      } else if (m.para?.tipo === 'caixa') {
        const c = doLugar(caixa, m.para.id);
        for (const [dono, v] of efetivos) somar(c, dono, v);
      }

      if (m.custeio) {
        // Custou o valor inteiro; o envelope financiou o que tinha ali, e o
        // resto saiu do caixa comum — o estouro (02 §3.6).
        const env = m.donos[0].envelopeId;
        const usado = efetivos.get(env) ?? 0;
        somar(posto, env, -usado);
        if (!gastos.has(env)) gastos.set(env, { custo: 0, financiado: 0, pagamentos: 0, porCategoria: new Map() });
        const g = gastos.get(env);
        g.custo += m.valor;
        g.financiado += usado;
        g.pagamentos += 1;
        somar(g.porCategoria, m.l.categoriaId ?? '', m.valor);
        anotar(env, {
          data: d, tipo: 'gasto', valor: m.valor, usado: Math.round(usado), estouro: Math.round(m.valor - usado),
          de: m.de?.id ?? null, lancamentoId: m.l.id, lc: m.l.lc ?? 0,
        });
        return;
      }

      for (const [dono, v] of efetivos) {
        if (m.para) anotar(dono, { data: d, tipo: 'movido', valor: Math.round(v), de: m.de?.id ?? null, para: m.para.id, lancamentoId: m.l.id, lc: m.l.lc ?? 0 });
        else {
          // Saiu da família: a fatia 2 (despesa custeada) mora aqui.
          somar(posto, dono, -v);
          anotar(dono, { data: d, tipo: 'saiu', valor: Math.round(v), de: m.de?.id ?? null, lancamentoId: m.l.id, lc: m.l.lc ?? 0 });
        }
      }
    };

    // Os aportes e resgates: mudam o dono, no mesmo lugar.
    const processarAlocacao = (a) => {
      const lugar = lugarDoId(estado, a.lugarId);
      if (!lugar) return;
      const de = a.de ?? SEM_DONO;
      const para = a.para ?? SEM_DONO;
      let movido;
      if (lugar.tipo === 'fracao') {
        const p = preco(lugar);
        const c = doLugar(cotas, lugar.id);
        const u = Math.min(c.get(de) ?? 0, a.valor / p);
        c.set(de, (c.get(de) ?? 0) - u);
        somar(c, para, u);
        movido = u * p;
      } else {
        const c = doLugar(caixa, lugar.id);
        movido = de === SEM_DONO ? a.valor : Math.min(c.get(de) ?? 0, a.valor);
        if (de !== SEM_DONO) c.set(de, (c.get(de) ?? 0) - movido);
        if (para !== SEM_DONO) somar(c, para, movido);
      }
      const v = Math.round(movido);
      if (a.de && a.para) {
        anotar(a.de, { data: d, tipo: 'remanejo', valor: v, para: a.para, lugar: lugar.id, alocacaoId: a.id, lc: a.lc ?? 0 });
        anotar(a.para, { data: d, tipo: 'remanejo', valor: v, de: a.de, lugar: lugar.id, alocacaoId: a.id, lc: a.lc ?? 0 });
      } else if (a.para) {
        anotar(a.para, { data: d, tipo: 'aporte', valor: v, lugar: lugar.id, alocacaoId: a.id, lc: a.lc ?? 0 });
      } else if (a.de) {
        anotar(a.de, { data: d, tipo: 'resgate', valor: v, lugar: lugar.id, alocacaoId: a.id, lc: a.lc ?? 0 });
      }
      if (a.de) somar(posto, a.de, -movido);
      if (a.para) somar(posto, a.para, movido);
    };

    // Na ordem em que foram registrados (lc, o relógio do registro): o aporte
    // feito na corrente antes da aplicação já está lá quando ela sai, e o que
    // acabou de chegar sem dono pode ganhar dono no mesmo dia.
    const fila = [
      ...doDia.map((m) => ({ lc: m.l.lc ?? 0, m })),
      ...alocacoes.filter((x) => x.data === d).map((a) => ({ lc: a.lc ?? 0, a })),
    ].sort((x, y) => x.lc - y.lc);
    for (const x of fila) {
      if (x.m) processarMovimento(x.m);
      else processarAlocacao(x.a);
    }
  }

  // O valor de cada um hoje.
  const porLugar = new Map();
  const porEnvelope = new Map();
  const doEnvelope = (id) => {
    if (!porEnvelope.has(id)) porEnvelope.set(id, { total: 0, porLugar: new Map() });
    return porEnvelope.get(id);
  };
  for (const lugar of lugares(estado, dia)) {
    const donos = new Map();
    if (lugar.tipo === 'fracao') {
      const c = cotas.get(lugar.id) ?? new Map();
      const total = soma(c);
      if (total > 0 && lugar.valor > 0) {
        for (const [dono, u] of c) if (dono !== SEM_DONO && u > 1e-9) donos.set(dono, Math.round((u / total) * lugar.valor));
      } else if (lugar.valor > 0 && inteiroDe.has(lugar.id)) {
        donos.set(inteiroDe.get(lugar.id), lugar.valor);
        somar(posto, inteiroDe.get(lugar.id), lugar.valor);
      }
    } else {
      for (const [dono, v] of caixa.get(lugar.id) ?? []) if (Math.round(v) > 0) donos.set(dono, Math.round(v));
    }
    const comDono = soma(donos);
    porLugar.set(lugar.id, { lugar, valor: lugar.valor, donos, semDono: lugar.valor - comDono });
    for (const [dono, v] of donos) {
      const env = doEnvelope(dono);
      env.total += v;
      env.porLugar.set(lugar.id, v);
    }
  }
  for (const v of Object.values(estado.envelopes ?? {})) {
    const env = doEnvelope(v.id);
    env.posto = Math.round(posto.get(v.id) ?? 0);
    const g = gastos.get(v.id);
    env.custo = g?.custo ?? 0;
    env.financiado = Math.round(g?.financiado ?? 0);
    env.estouro = env.custo - env.financiado;
    env.pagamentos = g?.pagamentos ?? 0;
    env.porCategoria = g?.porCategoria ?? new Map();
    // Rendeu: o que tem, menos o que entrou, mais o que o envelope já pagou.
    env.rendeu = env.total - env.posto;
    env.extrato = (extrato.get(v.id) ?? []).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.lc - a.lc));
  }
  const semDono = [...porLugar.values()].reduce((t, x) => t + Math.max(0, x.semDono), 0);
  return { porLugar, porEnvelope, semDono };
}

// ── a evolução (§5.1, D34) ──────────────────────────────────────────────────

/**
 * O que os envelopes `ids` tinham no fim de cada mês (ou ano) dos `meses`,
 * separado em aportado (o que entrou menos o que saiu deles — `posto`) e
 * rendimento (o resto). O último balde, se é o atual, vale hoje. Dos baldes
 * antes do primeiro aporte, só o último fica (zerado, o ponto de partida).
 *
 * [{ balde, dia, total, aportado, rendeu }]
 */
export function evolucaoDosEnvelopes(estado, ids, meses, tempo = 'mes', dia = hoje()) {
  const alocacoes = Object.values(estado.alocacoes ?? {}).filter((a) => !a.removida);
  const temInteiro = Object.values(estado.envelopes ?? {}).some((v) => v.inteiros?.length);
  // Sem aporte, o envelope dono de um lugar inteiro tem história desde sempre.
  const primeiro = alocacoes.reduce((m, a) => (!m || a.data < m ? a.data : m), null) ?? (temInteiro ? '0000-00-00' : null);
  if (!primeiro) return [];
  const baldes = tempo === 'ano' ? [...new Set(meses.map((m) => m.slice(0, 4)))] : meses;
  return baldes
    .map((b) => {
      const fim = tempo === 'ano' ? `${b}-12-31` : fimDoMes(`${b}-01`);
      return { balde: b, dia: fim >= dia ? dia : fim };
    })
    // Um balde de antes do primeiro aporte fica, zerado: é dele que a curva
    // parte — senão o envelope novo seria um ponto só, sem subida.
    .filter((p, i, todos) => p.dia >= primeiro || todos[i + 1]?.dia >= primeiro)
    .map((p) => {
      const porEnvelope = donosNoDia(estado, p.dia).porEnvelope;
      let total = 0;
      let aportado = 0;
      for (const id of ids) {
        const r = porEnvelope.get(id);
        if (!r) continue;
        total += r.total;
        aportado += r.posto;
      }
      return { ...p, total, aportado, rendeu: total - aportado };
    });
}

// ── os números de um envelope (§1) ──────────────────────────────────────────

const mesesInclusivos = (de, ate) =>
  (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + (Number(ate.slice(5, 7)) - Number(de.slice(5, 7))) + 1;

/**
 * { tem, alvo, falta, porMes, deveriaTer, completo, mesesRestantes }
 * "No ritmo, deveria ter" = alvo × meses passados desde o começo ÷ meses do
 * começo à data, contando o mês do começo e o da data: IPVA de R$ 1.800
 * começado em fevereiro e vencendo em janeiro, em outubro, deveria ter 1.350.
 */
export function numerosDoEnvelope(envelope, tem, dia = hoje()) {
  const alvo = envelope.alvoValor ?? null;
  const falta = alvo != null ? Math.max(0, alvo - tem) : null;
  const r = { tem, alvo, falta, completo: alvo != null && tem >= alvo, porMes: null, deveriaTer: null, mesesRestantes: null };
  if (!ehProjeto(envelope) || alvo == null) return r;
  const inicio = envelope.inicio ?? dia;
  const total = Math.max(1, mesesInclusivos(inicio, envelope.alvoData));
  const passados = Math.min(total, Math.max(0, mesesInclusivos(inicio, dia)));
  // Antes do começo não há ritmo a cobrar: o IPVA 2028 começa em fevereiro.
  r.deveriaTer = inicio > dia ? null : Math.round((alvo * passados) / total);
  r.mesesRestantes = Math.max(0, total - passados);
  r.porMes = falta > 0 ? Math.ceil(falta / Math.max(1, r.mesesRestantes)) : 0;
  return r;
}

/**
 * O próximo de um projeto que se repete (design/11 §8): "IPVA 2027" →
 * "IPVA 2028", mesmo alvo, começo no mês seguinte ao fim, data um ano depois.
 */
export function proximoDoProjeto(envelope) {
  const anos = [...envelope.nome.matchAll(/\b(19|20)\d{2}\b/g)];
  const ultimo = anos[anos.length - 1];
  const nome = ultimo
    ? `${envelope.nome.slice(0, ultimo.index)}${Number(ultimo[0]) + 1}${envelope.nome.slice(ultimo.index + 4)}`
    : `${envelope.nome} (próximo)`;
  const fim = envelope.alvoData;
  return {
    nome,
    alvoValor: envelope.alvoValor ?? null,
    inicio: fim ? `${somarMeses(`${fim.slice(0, 7)}-01`, 1)}` : hoje(),
    alvoData: fim ? somarMeses(fim, 12) : null,
  };
}

/** O nome de um lugar para a tela: "CDB · Banco", "Corrente". */
export function nomeDoLugar(estado, lugarId) {
  const a = estado.ativos?.[lugarId];
  if (a) return a.nome;
  return estado.contas[lugarId]?.nome ?? '—';
}

/**
 * Quem é dono do dinheiro de um lugar, para a origem de um movimento: os
 * envelopes que têm algo ali (fora o sem dono). Serve para a janela perguntar
 * "de quem é o dinheiro que sai" só quando há o que perguntar (§4).
 */
export function envelopesNoLugar(estado, lugarId, dia = hoje()) {
  const r = donosNoDia(estado, dia).porLugar.get(lugarId);
  if (!r) return { semDono: 0, envelopes: [] };
  return {
    semDono: r.semDono,
    envelopes: [...r.donos.entries()].map(([id, valor]) => ({ envelope: estado.envelopes[id], valor })).filter((x) => x.envelope),
  };
}
