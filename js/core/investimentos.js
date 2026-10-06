// Investimentos: contas, ativos e o que cada um vale (design/10 §3).
//
// Nada daqui é gravado. O valor de um ativo anda no tempo: a última avaliação
// informada (o "valor de hoje" que o banco mostra), mais o que foi aplicado e
// menos o que foi resgatado depois dela. Sem avaliação, vale o que foi posto —
// e aparece com ~, porque ninguém disse quanto rendeu.
//
// Rendeu = o que vale hoje + o que já voltou (resgates) + proventos − o que
// foi aplicado. É a conta que fecha mesmo depois de um resgate total.

import { hoje, somarDias } from './datas.js';
import { visiveis, saldoReal, sinalDeSaida } from './lancamentos.js';

/** As classes: lista nossa, como os níveis de risco (design/10 §3.1). */
export const CLASSES = [
  { id: 'renda_fixa', nome: 'Renda fixa' },
  { id: 'tesouro', nome: 'Tesouro' },
  { id: 'acoes', nome: 'Ações' },
  { id: 'fii', nome: 'FII' },
  { id: 'fundos', nome: 'Fundos' },
  { id: 'previdencia', nome: 'Previdência' },
  { id: 'cripto', nome: 'Cripto' },
];

export const nomeDaClasse = (id) => CLASSES.find((c) => c.id === id)?.nome ?? 'Outros';

/** As classes que, por padrão, se acompanham por quantidade e preço. */
export const CLASSES_POR_COTAS = new Set(['acoes', 'fii', 'cripto']);

/** Os ativos de uma conta de investimento, os arquivados por último. */
export function ativosDaConta(estado, contaId) {
  return Object.values(estado.ativos ?? {})
    .filter((a) => a.contaId === contaId)
    .sort((a, b) => Number(a.arquivado) - Number(b.arquivado) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** De onde sai e para onde volta o dinheiro desta conta (design/10 §3.6). */
export const contaDoDinheiro = (conta) => conta.caixaEm ?? conta.id;

/**
 * Operação de antes de a conta do dinheiro entrar no app não sai de conta
 * nenhuma: o saldo informado no cadastro dela já não tinha esse dinheiro. É a
 * regra do empréstimo antigo (design/10 §4.4), aplicada ao investimento.
 * Devolve a conta que a operação deve mexer, ou null.
 */
export function contaDaOperacao(estado, contaInvestimento, data) {
  const id = contaDoDinheiro(contaInvestimento);
  const marco = estado.contas[id]?.dataInicial ?? null;
  return marco && data < marco ? null : id;
}

/** Meses entre dois dias, com fração (30,4375 dias por mês). */
const mesesEntre = (de, ate) => (new Date(`${ate}T12:00:00`) - new Date(`${de}T12:00:00`)) / 86400000 / 30.4375;

/**
 * A posição de um ativo no dia.
 * { aplicado, resgatado, proventos, valorAtual, investido, rendeu, pct,
 *   avaliacao, estimado, encerrado }
 */
export function posicao(estado, ativoId, dia = hoje()) {
  const ativo = estado.ativos?.[ativoId];
  if (!ativo) return null;
  const ops = visiveis(estado, dia).filter((l) => l.ativoId === ativoId && l.confirmado && l.dataCompetencia <= dia);
  if (ativo.unidade === 'cotas') return posicaoPorCotas(ativo, ops, dia);

  let aplicado = 0;
  let resgatado = 0;
  let proventos = 0;
  for (const l of ops) {
    if (l.tipo === 'aplicacao') aplicado += l.valor;
    if (l.tipo === 'resgate') resgatado += l.valor;
    if (l.tipo === 'provento') proventos += l.valor;
  }

  // O valor anda no tempo: no mesmo dia, as operações vêm antes da avaliação
  // — o valor informado hoje já inclui a aplicação de hoje.
  const marcos = [
    ...ops.filter((l) => l.tipo !== 'provento').map((l) => ({ data: l.dataCompetencia, ordem: 0, delta: l.tipo === 'aplicacao' ? l.valor : -l.valor })),
    ...ativo.avaliacoes.filter((a) => a.data <= dia && a.valor != null).map((a) => ({ data: a.data, ordem: 1, valor: a.valor })),
  ].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.ordem - b.ordem));
  let valorAtual = 0;
  let avaliacao = null;
  let mexeuDepois = false;
  for (const m of marcos) {
    if (m.valor != null) {
      valorAtual = m.valor;
      avaliacao = m;
      mexeuDepois = false;
    } else {
      valorAtual = Math.max(0, valorAtual + m.delta);
      mexeuDepois = true;
    }
  }

  const rendeu = valorAtual + resgatado + proventos - aplicado;
  return {
    ativo,
    ...periodo(ops, dia, rendeu, aplicado),
    aplicado,
    resgatado,
    proventos,
    valorAtual,
    // O que ainda está posto: o aplicado que não voltou. Nunca negativo — o
    // que voltou a mais é rendimento, não "investido negativo".
    investido: Math.max(0, aplicado - resgatado),
    rendeu,
    pct: aplicado ? rendeu / aplicado : 0,
    avaliacao: avaliacao ? { data: avaliacao.data, valor: avaliacao.valor } : null,
    estimado: !avaliacao || mexeuDepois,
    encerrado: valorAtual === 0 && resgatado > 0,
  };
}

/**
 * O ativo por cotas (ação, FII, cripto): quantidade, preço médio, valor pela
 * cotação e cada compra com a sua variação.
 *
 * O preço médio é o da B3 e da Receita: a compra o recalcula, a venda não —
 * ela tira do custo a quantidade vendida ao preço médio. Para mostrar "compra
 * a compra", a venda consome as compras mais antigas primeiro.
 */
function posicaoPorCotas(ativo, ops, dia) {
  const ordem = (l) => (l.tipo === 'aplicacao' ? 0 : 1);
  const emOrdem = [...ops].sort((a, b) => (a.dataCompetencia < b.dataCompetencia ? -1 : a.dataCompetencia > b.dataCompetencia ? 1 : ordem(a) - ordem(b)));
  let quantidade = 0;
  let custo = 0;
  let aplicado = 0;
  let resgatado = 0;
  let proventos = 0;
  const lotes = [];
  for (const l of emOrdem) {
    const q = Number(l.quantidade) || 0;
    if (l.tipo === 'aplicacao') {
      aplicado += l.valor;
      quantidade += q;
      custo += l.valor;
      lotes.push({ id: l.id, data: l.dataCompetencia, quantidade: q, resta: q, valor: l.valor, preco: l.preco ?? (q ? l.valor / q : 0) });
    } else if (l.tipo === 'resgate') {
      resgatado += l.valor;
      const medio = quantidade ? custo / quantidade : 0;
      const vendida = Math.min(q, quantidade);
      custo -= medio * vendida;
      quantidade -= vendida;
      let falta = vendida;
      for (const lote of lotes) {
        if (!falta) break;
        const tira = Math.min(lote.resta, falta);
        lote.resta -= tira;
        falta -= tira;
      }
    } else if (l.tipo === 'provento') {
      proventos += l.valor;
    }
  }
  if (quantidade < 1e-9) { quantidade = 0; custo = 0; }

  const cotacoes = ativo.avaliacoes.filter((a) => a.data <= dia && a.preco != null);
  const cotacao = cotacoes[cotacoes.length - 1] ?? null;
  const valorAtual = cotacao ? Math.round(quantidade * cotacao.preco) : Math.round(custo);
  const rendeu = valorAtual + resgatado + proventos - aplicado;
  return {
    ativo,
    ...periodo(ops, dia, rendeu, aplicado),
    porCotas: true,
    quantidade,
    precoMedio: quantidade ? custo / quantidade : 0,
    custo: Math.round(custo),
    cotacao: cotacao ? { data: cotacao.data, preco: cotacao.preco } : null,
    lotes: lotes.filter((x) => x.resta > 1e-9).map((x) => ({
      ...x,
      variacao: cotacao && x.preco ? cotacao.preco / x.preco - 1 : null,
    })),
    aplicado,
    resgatado,
    proventos,
    valorAtual,
    investido: Math.round(custo),
    rendeu,
    pct: aplicado ? rendeu / aplicado : 0,
    // A variação do que está na mão, contra o que custou (sem o que já foi vendido).
    variacao: custo ? valorAtual / custo - 1 : 0,
    avaliacao: cotacao ? { data: cotacao.data, valor: valorAtual } : null,
    estimado: !cotacao,
    encerrado: quantidade === 0 && resgatado > 0,
  };
}

/**
 * Desde quando o ativo existe (a primeira aplicação) e o rendimento no
 * período, com o equivalente ao ano — aproximado: considera o dinheiro todo
 * aplicado desde o começo, que é o caso comum de uma aplicação só.
 */
function periodo(ops, dia, rendeu, aplicado) {
  const primeiras = ops.filter((l) => l.tipo === 'aplicacao').map((l) => l.dataCompetencia).sort();
  const desde = primeiras[0] ?? null;
  const meses = desde ? mesesEntre(desde, dia) : 0;
  const fator = aplicado ? (aplicado + rendeu) / aplicado : 1;
  const aoAno = meses >= 1 && fator > 0 ? fator ** (12 / meses) - 1 : null;
  return { desde, meses, aoAno };
}

/**
 * A linha do tempo de um ativo, para o gráfico: [{ data, valor, investido, preco }].
 * Um ponto por dia em que algo aconteceu (operação ou valor/cotação informado) dentro
 * de [de, ate], mais as pontas; começa na primeira aplicação. Passando de `maximo`
 * pontos, fica um subconjunto espalhado, sempre com o primeiro e o último.
 */
export function serieDoAtivo(estado, ativoId, de, ate = hoje(), maximo = 70) {
  const ativo = estado.ativos?.[ativoId];
  if (!ativo) return [];
  const ops = visiveis(estado, ate).filter((l) => l.ativoId === ativoId && l.confirmado && l.dataCompetencia <= ate);
  const primeira = ops.filter((l) => l.tipo === 'aplicacao').map((l) => l.dataCompetencia).sort()[0];
  if (!primeira) return [];
  const inicio = de > primeira ? de : primeira;
  const datas = new Set([inicio, ate]);
  for (const v of ativo.avaliacoes) if (v.data >= inicio && v.data <= ate) datas.add(v.data);
  for (const l of ops) if (l.dataCompetencia >= inicio) datas.add(l.dataCompetencia);
  let dias = [...datas].sort();
  if (dias.length > maximo) {
    const passo = (dias.length - 1) / (maximo - 1);
    dias = Array.from({ length: maximo }, (_, i) => dias[Math.round(i * passo)]);
  }
  return dias.map((data) => {
    const p = posicao(estado, ativoId, data);
    return { data, valor: p.valorAtual, investido: p.investido, preco: p.cotacao?.preco ?? null };
  });
}

/**
 * O que um ativo rendeu num período [de, ate]: o valor no começo (o do dia anterior), o que
 * entrou e saiu no meio, o valor no fim. `base` é o que estava posto no período (valor do
 * começo mais o que se aplicou); `pct` é o rendimento sobre ela. A média por mês e o
 * equivalente ao ano são compostos e só existem com cerca de 1 mês ou mais de período.
 * null quando o ativo ainda não tinha aplicação no fim do período.
 */
// Menos que isto de período não dá média nem equivalente anual com sentido (o "1 mês" da tela tem 30 dias).
const MES_MINIMO = 0.9;

export function rendimentoDoAtivo(estado, ativoId, de, ate = hoje()) {
  const ativo = estado.ativos?.[ativoId];
  if (!ativo) return null;
  const ops = visiveis(estado, ate).filter((l) => l.ativoId === ativoId && l.confirmado && l.dataCompetencia <= ate);
  const primeira = ops.filter((l) => l.tipo === 'aplicacao').map((l) => l.dataCompetencia).sort()[0];
  if (!primeira) return null;
  const desde = de > primeira ? de : primeira;
  const diaAntes = somarDias(desde, -1);
  const inicio = de > primeira ? (posicao(estado, ativoId, diaAntes)?.valorAtual ?? 0) : 0;
  let aplicado = 0;
  let resgatado = 0;
  let proventos = 0;
  for (const l of ops) {
    if (l.dataCompetencia <= diaAntes) continue;
    if (l.tipo === 'aplicacao') aplicado += l.valor;
    if (l.tipo === 'resgate') resgatado += l.valor;
    if (l.tipo === 'provento') proventos += l.valor;
  }
  const fim = posicao(estado, ativoId, ate)?.valorAtual ?? 0;
  const rendeu = fim + resgatado + proventos - inicio - aplicado;
  const base = inicio + aplicado;
  const meses = (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000 / 30.4375;
  const fator = base > 0 ? 1 + rendeu / base : null;
  return {
    desde, ate, inicio, fim, aplicado, resgatado, proventos, rendeu, base, meses,
    pct: base > 0 ? rendeu / base : 0,
    mensal: fator > 0 && meses >= MES_MINIMO ? fator ** (1 / meses) - 1 : null,
    anual: fator > 0 && meses >= MES_MINIMO ? fator ** (12 / meses) - 1 : null,
  };
}

/** O saldo de uma conta até um dia (o que se moveu até ali). */
export function saldoAte(estado, contaId, dia) {
  const conta = estado.contas[contaId];
  let saldo = conta?.saldoInicial ?? 0;
  for (const l of visiveis(estado, dia)) {
    if (!l.confirmado || l.dataCaixa > dia) continue;
    if (l.contaId === contaId) saldo -= sinalDeSaida(l);
    if (l.contaDestinoId === contaId) saldo += l.valor;
  }
  return saldo;
}

/** O que entrou numa conta por transferência, menos o que saiu, e o saldo de partida. */
function aportesLiquidos(estado, conta, dia) {
  let total = conta.saldoInicial ?? 0;
  for (const l of visiveis(estado, dia)) {
    if (!l.confirmado || l.dataCaixa > dia || l.tipo !== 'transferencia') continue;
    if (l.contaDestinoId === conta.id) total += l.valor;
    if (l.contaId === conta.id) total -= l.valor;
  }
  return total;
}

/**
 * Uma conta de investimento inteira: os ativos, o caixa parado (só na própria
 * corretora) e, na conta sem ativos (poupança), o valor informado.
 * { posicoes, caixa, valorAtual, investido, rendeu, estimado, semAtivos, foto }
 */
export function resumoDaConta(estado, conta, dia = hoje()) {
  const ativos = ativosDaConta(estado, conta.id);
  const posicoes = ativos.map((a) => posicao(estado, a.id, dia)).filter(Boolean);
  const proprio = !conta.caixaEm;
  let caixa = proprio ? saldoReal(estado, conta.id) : 0;
  let rendeuCaixa = 0;
  let foto = null;

  // Conta sem ativos (poupança, conta remunerada): o valor de hoje é a foto
  // informada; o que ela tem a mais que o saldo movimentado é rendimento.
  if (!ativos.length && proprio) {
    foto = (conta.fotos ?? []).filter((f) => f.data <= dia).pop() ?? null;
    if (foto) {
      rendeuCaixa = foto.valor - saldoAte(estado, conta.id, foto.data);
      caixa += rendeuCaixa;
    }
  }

  const valorAtual = caixa + posicoes.reduce((t, p) => t + p.valorAtual, 0);
  // Na própria corretora, o investido é o que entrou por aporte menos o que
  // saiu por resgate — as transferências. No banco, o que está aplicado.
  const investido = proprio
    ? aportesLiquidos(estado, conta, dia)
    : posicoes.reduce((t, p) => t + p.investido, 0);
  return {
    conta,
    posicoes,
    caixa,
    proprio,
    semAtivos: !ativos.length,
    foto,
    valorAtual,
    investido,
    rendeu: proprio ? valorAtual - investido : posicoes.reduce((t, p) => t + p.rendeu, 0),
    estimado: posicoes.some((p) => p.estimado && p.valorAtual) || (!ativos.length && proprio && (!foto || foto.data !== dia)),
  };
}
