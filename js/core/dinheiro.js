// Dinheiro é inteiro, em centavos — e isso nunca aparece na tela.
// design/02-modelo-de-dados.md §1.1

/** Entrada estilo calculadora: dígitos entram da direita. "12740" → 12740 centavos. */
export function deDigitos(digitos) {
  const limpo = String(digitos).replace(/\D/g, '');
  if (limpo === '') return 0;
  return parseInt(limpo, 10);
}

/** Acrescenta um dígito ao valor em edição. 127 + "4" → 1274 (R$ 12,74). */
export function acrescentarDigito(centavos, digito) {
  const d = String(digito).replace(/\D/g, '');
  if (d === '') return centavos;
  return centavos * 10 + parseInt(d, 10);
}

/** Remove o último dígito. 1274 → 127. */
export function removerDigito(centavos) {
  return Math.trunc(centavos / 10);
}

/** De texto digitado por humano ("1.234,56", "1234.56", "12") para centavos. */
export function deTexto(texto) {
  const s = String(texto).trim();
  if (s === '') return 0;
  const negativo = /^-/.test(s);
  const corpo = s.replace(/^-/, '');
  // O último separador presente é o decimal; os outros são de milhar.
  const ultimoSep = Math.max(corpo.lastIndexOf(','), corpo.lastIndexOf('.'));
  let inteiros, decimais;
  if (ultimoSep === -1) {
    inteiros = corpo.replace(/\D/g, '');
    decimais = '';
  } else {
    inteiros = corpo.slice(0, ultimoSep).replace(/\D/g, '');
    decimais = corpo.slice(ultimoSep + 1).replace(/\D/g, '');
  }
  const cents = (decimais + '00').slice(0, 2);
  const valor = parseInt((inteiros || '0') + cents, 10);
  return negativo ? -valor : valor;
}

/**
 * Partes separadas, para a tela poder dar aos centavos fonte menor.
 * design/08-telas.md §3.3 — "R$ 1.842,50" com os centavos reduzidos.
 */
export function partes(centavos) {
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const reais = Math.trunc(abs / 100);
  const cents = abs % 100;
  return {
    negativo,
    sinal: negativo ? '−' : '',
    reais: agruparMilhar(reais),
    centavos: String(cents).padStart(2, '0'),
  };
}

/** Sempre vírgula, sempre dois dígitos, sempre separador de milhar. */
export function formatar(centavos, { comSinal = false, comPrefixo = true } = {}) {
  const p = partes(centavos);
  const sinal = p.negativo ? '−' : comSinal ? '+' : '';
  const prefixo = comPrefixo ? 'R$ ' : '';
  return `${sinal}${prefixo}${p.reais},${p.centavos}`;
}

/** Estimativa leva `~` obrigatoriamente. design/08-telas.md §3.1 */
export function formatarEstimado(centavos, opcoes) {
  return '~' + formatar(centavos, opcoes);
}

function agruparMilhar(inteiro) {
  return String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function somar(...valores) {
  return valores.flat().reduce((a, b) => a + b, 0);
}

/**
 * Rateio exato: distribui `total` entre `pesos` sem perder nem inventar centavo.
 * Usa maiores restos — a soma do resultado é SEMPRE igual a `total`.
 *
 * Necessário em vários lugares do design: rateio do rendimento entre envelopes
 * (D15), rateio sugerido do próximo aporte (D17), divisão proporcional em relatório.
 */
export function ratear(total, pesos) {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (soma <= 0) return pesos.map(() => 0);

  const brutos = pesos.map((p) => (total * p) / soma);
  const piso = brutos.map((b) => Math.floor(b));
  let resto = total - piso.reduce((a, b) => a + b, 0);

  // Quem tem o maior resto fracionário recebe o centavo sobrante primeiro.
  const ordem = brutos
    .map((b, i) => ({ i, frac: b - Math.floor(b) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const saida = piso.slice();
  for (let k = 0; resto > 0; k = (k + 1) % ordem.length) {
    saida[ordem[k].i] += 1;
    resto -= 1;
  }
  return saida;
}

/** Zero não é lançável. design/02-modelo-de-dados.md §1.1 */
export function valorLancavel(centavos) {
  return Number.isInteger(centavos) && centavos > 0;
}
