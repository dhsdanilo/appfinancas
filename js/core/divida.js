// A dívida com contrato (design/10 §4, ajusta D22 e D24).
//
// Cada empréstimo é uma conta de dívida com um contrato: valor tomado,
// parcelas, taxa opcional e a conta que paga. O saldo devedor de verdade vem do
// banco, por foto; entre uma foto e outra, o app estima pelo contrato e mostra
// com ~. A foto do banco sempre manda.
//
// A estimativa segue o calendário do contrato (sistema Price): assume as
// parcelas pagas em dia. Amortização extra ou atraso aparecem na próxima foto —
// é ela que corrige, nunca uma fórmula mais esperta.

import { hoje, somarMeses } from './datas.js';
import { visiveis } from './lancamentos.js';

const DIAS_NO_MES = 30.4375;

/** Taxa mensal que faz `parcela` pagar `valor` em `n` meses (Price), por bisseção. */
export function taxaImplicita(valor, n, parcela) {
  if (!valor || !n || !parcela || parcela * n <= valor) return 0;
  let baixo = 0;
  let alto = 1;
  for (let i = 0; i < 100; i += 1) {
    const meio = (baixo + alto) / 2;
    const pmt = (valor * meio) / (1 - (1 + meio) ** -n);
    if (pmt > parcela) alto = meio;
    else baixo = meio;
  }
  return (baixo + alto) / 2;
}

/** Saldo de `pv` depois de `k` parcelas de `pmt` a `i` ao mês (Price). */
function saldoPrice(pv, i, pmt, k) {
  if (k <= 0) return pv;
  if (!i) return Math.max(0, pv - pmt * k);
  const f = (1 + i) ** k;
  return Math.max(0, pv * f - (pmt * (f - 1)) / i);
}

/** As datas de vencimento do contrato, da primeira à última. */
export function calendario(contrato) {
  const datas = [];
  for (let k = 0; k < contrato.parcelas; k += 1) datas.push(somarMeses(contrato.primeira, k));
  return datas;
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
  const pagos = pagamentos(estado, conta.id).filter((l) => l.dataCaixa > a.data && l.dataCaixa <= b.data);
  const pago = pagos.reduce((t, l) => t + l.valor, 0);
  const meses = mesesEntre(a.data, b.data);
  if (!pago || meses <= 0 || !a.valor) return null;
  const juros = pago - (a.valor - b.valor);
  if (juros <= 0) return null;
  return { taxa: juros / a.valor / meses, meses: Math.max(1, Math.round(meses)) };
}

/** O que foi pago para esta dívida: tudo que entrou nela, confirmado. */
export function pagamentos(estado, dividaId) {
  return visiveis(estado).filter((l) => l.confirmado && l.contaDestinoId === dividaId);
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

  const datas = calendario(c);
  const devidas = datas.filter((d) => d <= dia).length;
  const restantes = c.parcelas - devidas;

  const observada = taxaObservada(estado, conta);
  const implicita = taxaImplicita(c.valorTomado, c.parcelas, c.valorParcela);
  const taxa = c.taxa ?? observada?.taxa ?? implicita;
  const origemTaxa = c.taxa != null ? 'contratual' : observada ? 'observada' : 'implicita';

  // A base é a última foto até o dia; sem foto, o próprio contrato.
  const fotos = (conta.fotos ?? []).filter((f) => f.data <= dia);
  const foto = fotos[fotos.length - 1] ?? null;
  let saldo;
  if (foto) {
    const depois = datas.filter((d) => d > foto.data && d <= dia).length;
    saldo = saldoPrice(foto.valor, taxa, c.valorParcela, depois);
  } else {
    saldo = saldoPrice(c.valorTomado, taxa, c.valorParcela, devidas);
  }
  saldo = Math.round(saldo);
  const estimado = !foto || foto.data !== dia;

  const somaRestante = restantes * c.valorParcela;
  const pagoNoCalendario = devidas * c.valorParcela;
  return {
    conta,
    contrato: c,
    saldoDevedor: saldo,
    estimado,
    foto,
    parcelasPagas: devidas,
    parcelasTotal: c.parcelas,
    restantes,
    somaRestante,
    // Os dois "quanto falta" (D22): quitar hoje × desembolsar até o fim.
    jurosFuturos: Math.max(0, somaRestante - saldo),
    jurosPagos: Math.max(0, pagoNoCalendario - (c.valorTomado - saldo)),
    taxa,
    origemTaxa,
    mesesObservados: observada?.meses ?? null,
    proxima: datas.find((d) => d > dia) ?? null,
    termina: datas[datas.length - 1],
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
