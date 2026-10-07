// A dívida com contrato (design/10 §4, ajusta D22 e D24).
//
// Cada empréstimo é uma conta de dívida com um contrato: valor tomado,
// parcelas, taxa opcional e a conta que paga. O saldo devedor de verdade vem do
// banco, por foto; entre uma foto e outra, o app estima pelo contrato e mostra
// com ~. A foto do banco sempre manda.
//
// A estimativa segue o calendário do contrato (sistema Price): assume as
// parcelas pagas em dia. Atraso aparece na próxima foto — é ela que corrige,
// nunca uma fórmula mais esperta. A amortização entra no calendário pelo
// resultado escolhido no dia (js/core/contrato.js).

import { hoje } from './datas.js';
import { visiveis } from './lancamentos.js';
import { saldoPrice, parcelaPrice, taxaImplicita } from './contrato.js';
import { calendarioDaDivida, amortizacoesValidas, caiAPartirDe } from './parcelas.js';

export { taxaImplicita };

const DIAS_NO_MES = 30.4375;

/** As datas de vencimento do contrato, da primeira à última, sem amortização. */
export function calendario(contrato) {
  return calendarioDaDivida({ lancamentos: {} }, { contrato }).map((p) => p.data);
}

const mesesEntre = (de, ate) => (new Date(ate + 'T12:00:00') - new Date(de + 'T12:00:00')) / 86400000 / DIAS_NO_MES;

/**
 * A taxa observada nas fotos (D24): juros do período ÷ saldo, entre duas fotos
 * com pagamentos registrados no meio. Precisa de duas fotos; com menos, null.
 */
export function taxaObservada(estado, conta) {
  const fotos = conta.fotos ?? [];
  if (fotos.length < 2) return null;
  const a = fotos[fotos.length - 2];
  const b = fotos[fotos.length - 1];
  const pagos = pagamentos(estado, conta.id, b.data).filter((l) => l.dataCaixa > a.data && l.dataCaixa <= b.data);
  const pago = pagos.reduce((t, l) => t + l.valor, 0);
  const meses = mesesEntre(a.data, b.data);
  if (!pago || meses <= 0 || !a.valor) return null;
  const juros = pago - (a.valor - b.valor);
  if (juros <= 0) return null;
  return { taxa: juros / a.valor / meses, meses: Math.max(1, Math.round(meses)) };
}

/** O que foi pago para esta dívida: tudo que entrou nela, confirmado — parcelas automáticas inclusive. */
export function pagamentos(estado, dividaId, dia = hoje()) {
  return visiveis(estado, dia).filter((l) => l.confirmado && l.contaDestinoId === dividaId);
}

/** A taxa usada, e de onde ela veio: contratual, observada nas fotos, ou implícita no contrato. */
function taxaDoContrato(estado, conta) {
  const c = conta.contrato;
  const observada = taxaObservada(estado, conta);
  const implicita = taxaImplicita(c.valorTomado, c.parcelas, c.valorParcela);
  return {
    taxa: c.taxa ?? observada?.taxa ?? implicita,
    origemTaxa: c.taxa != null ? 'contratual' : observada ? 'observada' : 'implicita',
    mesesObservados: observada?.meses ?? null,
  };
}

/**
 * O cronograma inteiro, parcela a parcela: { k, data, valor, juros,
 * amortizacao, saldoDepois, antesDoApp }. Andando no tempo: cada foto do banco
 * repõe o saldo (manda), cada amortização o abate. No mesmo dia de uma
 * parcela, a parcela vem primeiro — a foto daquele dia já a inclui.
 */
export function cronograma(estado, dividaId) {
  const conta = estado.contas[dividaId];
  const c = conta?.contrato;
  if (!c || !c.parcelas || !c.valorParcela) return null;
  const { taxa } = taxaDoContrato(estado, conta);
  const desde = caiAPartirDe(estado, conta);
  const marcos = marcosDaDivida(estado, conta);

  // Juros do contrato informados e nenhuma foto nem amortização: o cronograma sai do fim para o começo, pelo
  // valor presente das parcelas, e fecha em zero na última (igual ao saldo devedor de cima).
  if (c.taxa != null && marcos.length === 0) {
    const cal = calendarioDaDivida(estado, conta);
    const depois = new Array(cal.length + 1).fill(0);
    for (let k = cal.length - 1; k >= 0; k -= 1) depois[k] = (depois[k + 1] + cal[k].valor) / (1 + taxa);
    const parcelas = cal.map((p, k) => {
      const juros = Math.min(p.valor, Math.round(depois[k] * taxa));
      return { ...p, juros, amortizacao: p.valor - juros, saldoDepois: Math.round(depois[k + 1]), antesDoApp: p.data < desde };
    });
    return { parcelas, marcos, taxa };
  }

  let saldo = c.valorTomado;
  let m = 0;
  const parcelas = [];
  for (const p of calendarioDaDivida(estado, conta)) {
    while (m < marcos.length && marcos[m].data < p.data) {
      saldo = marcos[m].foto ?? Math.max(0, saldo - marcos[m].abate);
      m += 1;
    }
    const juros = Math.min(p.valor, Math.round(saldo * taxa));
    const amortizacao = p.valor - juros;
    saldo = Math.max(0, saldo - amortizacao);
    parcelas.push({ ...p, juros, amortizacao, saldoDepois: saldo, antesDoApp: p.data < desde });
  }
  return { parcelas, marcos, taxa };
}

/**
 * As fotos e as amortizações, em ordem. No mesmo dia, vale a ordem em que
 * aconteceram (o relógio lógico do evento): a foto tirada antes de amortizar
 * não apaga a amortização, e a tirada depois já a inclui.
 */
function marcosDaDivida(estado, conta) {
  return [
    ...(conta.fotos ?? []).map((f) => ({ data: f.data, foto: f.valor, lc: f.lc ?? 0 })),
    ...amortizacoesValidas(estado, conta).map((a) => ({ data: a.data, abate: a.valor, lc: a.lc ?? 0 })),
  ].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.lc - b.lc));
}

/**
 * O valor, hoje, de parcelas futuras à taxa `i` ao mês: a primeira vale um mês à frente. É assim
 * que o banco calcula o valor para quitar (os juros das parcelas que faltam saem do valor).
 */
function valorPresente(valores, i) {
  let pv = 0;
  for (let m = valores.length; m >= 1; m -= 1) pv = (pv + valores[m - 1]) / (1 + i);
  return pv;
}

/**
 * O saldo devedor num dia, andando pelo cronograma: a última foto até ali, e
 * as parcelas e amortizações depois dela. A parcela do dia vem antes dos
 * marcos do dia — a foto daquele dia já a inclui.
 */
function saldoNoDia(estado, conta, taxa, dia) {
  const c = conta.contrato;
  // Com os juros do contrato informados e sem foto do banco, o saldo é o que falta pagar trazido a valor de
  // hoje por esses juros: não depende do "valor tomado" (que pode ser o líquido, sem o IOF e as tarifas).
  const temFoto = marcosDaDivida(estado, conta).some((m) => m.foto != null && m.data <= dia);
  if (c.taxa != null && !temFoto) {
    const restantes = calendarioDaDivida(estado, conta).filter((p) => p.data > dia).map((p) => p.valor);
    return Math.round(valorPresente(restantes, taxa));
  }
  const marcos = [
    ...calendarioDaDivida(estado, conta).map((p) => ({ data: p.data, parcela: p.valor, ordem: 0, lc: 0 })),
    ...marcosDaDivida(estado, conta).map((m) => ({ ...m, ordem: 1 })),
  ]
    .filter((x) => x.data <= dia)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.ordem - b.ordem || a.lc - b.lc));
  let saldo = c.valorTomado;
  for (const x of marcos) {
    if (x.foto != null) saldo = x.foto;
    else if (x.abate != null) saldo = Math.max(0, saldo - x.abate);
    else saldo = Math.max(0, saldoPrice(saldo, taxa, x.parcela, 1));
  }
  return Math.round(saldo);
}

/**
 * A situação de uma dívida com contrato, no dia: saldo devedor (da foto, ou
 * estimado), parcelas, os dois "quanto falta" da D22, juros e a taxa usada.
 * Devolve null para dívida sem contrato.
 */
export function situacao(estado, dividaId, dia = hoje()) {
  const conta = estado.contas[dividaId];
  const c = conta?.contrato;
  if (!c || !c.parcelas || !c.valorParcela) return null;

  const { taxa, origemTaxa, mesesObservados } = taxaDoContrato(estado, conta);
  const calendario = calendarioDaDivida(estado, conta);
  const vencidas = calendario.filter((p) => p.data <= dia);
  const porVir = calendario.filter((p) => p.data > dia);

  const fotos = (conta.fotos ?? []).filter((f) => f.data <= dia);
  const foto = fotos[fotos.length - 1] ?? null;
  const saldo = saldoNoDia(estado, conta, taxa, dia);
  // Amortização depois da última foto: o número é a foto menos ela — conta
  // do app, até o banco mostrar o novo.
  const ultimoMarco = marcosDaDivida(estado, conta).filter((m) => m.data <= dia).pop();
  const amortizouDepois = Boolean(foto && ultimoMarco && ultimoMarco.abate != null);
  const estimado = !foto || foto.data !== dia || amortizouDepois;

  const somaRestante = porVir.reduce((t, p) => t + p.valor, 0);
  const amortizado = amortizacoesValidas(estado, conta)
    .filter((a) => a.data <= dia)
    .reduce((t, a) => t + a.valor, 0);
  const pagoNoCalendario = vencidas.reduce((t, p) => t + p.valor, 0) + amortizado;
  const desde = caiAPartirDe(estado, conta);
  // O empréstimo inteiro, pagando mês a mês até a última parcela: todas as
  // parcelas do calendário (as de antes do app também) e o que foi amortizado.
  const amortizadoTudo = amortizacoesValidas(estado, conta).reduce((t, a) => t + a.valor, 0);
  const totalDoContrato = calendario.reduce((t, p) => t + p.valor, 0) + amortizadoTudo;
  return {
    conta,
    contrato: c,
    totalDoContrato,
    jurosDoContrato: Math.max(0, totalDoContrato - c.valorTomado),
    saldoDevedor: saldo,
    estimado,
    foto,
    amortizouDepois,
    parcelasPagas: vencidas.length,
    parcelasTotal: calendario.length,
    // As que venceram antes de o empréstimo entrar no app: contam como pagas,
    // mas não mexeram em conta nenhuma (design/10 §4.4).
    antesDoApp: calendario.filter((p) => p.data < desde).length,
    restantes: porVir.length,
    somaRestante,
    valorParcela: porVir[0]?.valor ?? c.valorParcela,
    // Os dois "quanto falta" (D22): quitar hoje × desembolsar até o fim.
    jurosFuturos: Math.max(0, somaRestante - saldo),
    jurosPagos: Math.max(0, pagoNoCalendario - (c.valorTomado - saldo)),
    amortizado,
    taxa,
    origemTaxa,
    mesesObservados,
    // O CET (opcional) só mostra o custo real; não entra no saldo. `taxaAno`/`cetAno`: como foram digitados.
    cet: c.cet ?? null,
    cetAno: c.cetAno ?? null,
    taxaAno: c.taxaAno ?? null,
    proxima: porVir[0]?.data ?? null,
    termina: calendario[calendario.length - 1]?.data ?? null,
    quitada: porVir.length === 0 || saldo === 0,
  };
}

/** O saldo devedor de qualquer dívida: do contrato, ou o que a conta diz. */
export function saldoDevedor(estado, dividaId, dia = hoje()) {
  const s = situacao(estado, dividaId, dia);
  if (s) return s.saldoDevedor;
  const conta = estado.contas[dividaId];
  const ultima = (conta?.fotos ?? []).filter((f) => f.data <= dia).pop();
  return ultima ? ultima.valor : null;
}

/**
 * Quanto de uma parcela é juros, pelo cronograma (Price): o saldo antes dela
 * vezes a taxa. É informação — juros aparecem como juros, não como gasto
 * (decidido 03/10/2026). `k` começa em 1.
 */
export function jurosDaParcela(estado, dividaId, k) {
  const cr = cronograma(estado, dividaId);
  return cr?.parcelas.find((p) => p.k === k)?.juros ?? null;
}

/**
 * Amortizar `valor` no `dia`: as duas saídas que o banco oferece, lado a lado
 * (design/10 §4.4). Devolve null quando não há o que amortizar.
 *
 *   prazo:   a parcela fica, o fim chega antes — { restantes, ultima, termina, economia, mesesAMenos }
 *   parcela: o fim fica, a parcela cai          — { parcela, economia }
 *   quita:   o valor paga tudo                  — { quita: true, economia }
 */
export function simularAmortizacao(estado, dividaId, valor, dia = hoje()) {
  const conta = estado.contas[dividaId];
  if (!conta?.contrato || !valor || valor <= 0) return null;
  const { taxa: i } = taxaDoContrato(estado, conta);
  const saldo = saldoNoDia(estado, conta, i, dia);
  const porVir = calendarioDaDivida(estado, conta).filter((p) => p.data > dia);
  if (!saldo || !porVir.length) return null;

  const desembolsoAntes = porVir.reduce((t, p) => t + p.valor, 0);
  const jurosAntes = Math.max(0, desembolsoAntes - saldo);
  const novo = saldo - valor;
  if (novo <= 0) {
    return { saldo, valor: Math.min(valor, saldo), quita: true, economia: jurosAntes };
  }

  // Reduzir prazo: a parcela de agora, até acabar. A última é o resto.
  const pmt = porVir[0].valor;
  let n = porVir.length;
  if (pmt > novo * i) {
    const exato = i ? -Math.log(1 - (novo * i) / pmt) / Math.log(1 + i) : novo / pmt;
    n = Math.min(porVir.length, Math.max(1, Math.ceil(exato - 1e-9)));
  }
  const resto = saldoPrice(novo, i, pmt, n - 1);
  const ultima = Math.max(1, Math.round(resto * (1 + i)));
  const desembolsoPrazo = (n - 1) * pmt + ultima;

  // Reduzir parcela: o mesmo número de parcelas, uma parcela menor.
  const parcela = Math.round(parcelaPrice(novo, i, porVir.length));
  const desembolsoParcela = parcela * porVir.length;

  return {
    saldo,
    valor,
    quita: false,
    prazo: {
      restantes: n,
      ultima: ultima === pmt ? null : ultima,
      termina: porVir[n - 1].data,
      mesesAMenos: porVir.length - n,
      economia: Math.max(0, jurosAntes - (desembolsoPrazo - novo)),
    },
    parcela: {
      parcela,
      economia: Math.max(0, jurosAntes - (desembolsoParcela - novo)),
    },
  };
}
