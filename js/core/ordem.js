// A ordem das contas dentro de uma área: a que ele escolheu primeiro (`ordem`,
// 1, 2, 3…), e as que ainda não têm ordem depois, pelo nome.

const nome = (c) => c.nome.toLocaleLowerCase('pt-BR');

export function porOrdemDaConta(a, b) {
  const oa = a.ordem ?? Infinity;
  const ob = b.ordem ?? Infinity;
  if (oa !== ob) return oa < ob ? -1 : 1;
  return nome(a) < nome(b) ? -1 : nome(a) > nome(b) ? 1 : 0;
}

/** As iniciais para o ícone de uma conta: "Banco Azul" → "BA", "Moeda" → "M". */
export function iniciaisDaConta(texto) {
  const palavras = String(texto).trim().split(/\s+/).filter((p) => !/^(d[aeo]s?|e)$/i.test(p));
  if (!palavras.length) return '?';
  if (palavras.length === 1) return palavras[0][0].toLocaleUpperCase('pt-BR');
  return (palavras[0][0] + palavras[1][0]).toLocaleUpperCase('pt-BR');
}

const CORES = ['#185FA5', '#0F6E56', '#993C1D', '#534AB7', '#993556', '#854F0B', '#3B6D11', '#5F5E5A'];

/** Uma cor firme e sempre a mesma para cada conta, tirada do nome. */
export function corDaConta(texto) {
  let h = 0;
  for (const ch of String(texto)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
}
