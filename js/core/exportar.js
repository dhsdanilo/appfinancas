// Exportar o que está na tela: a planilha dos lançamentos (CSV). O PDF sai pelo
// diálogo de imprimir do navegador (js/relatorios.js e css/dinheiro.css).
//
// Formato pensado para o Excel e o LibreOffice em português: separador ";",
// vírgula decimal, BOM no começo (senão os acentos quebram) e fim de linha CRLF.

const COLUNAS = ['Data', 'Tipo', 'Descrição', 'Detalhes', 'Etiquetas', 'Parcela', 'Situação', 'Valor'];

const celula = (v) => {
  const t = String(v ?? '');
  // Aspas, ";" ou quebra de linha: protege. E uma fórmula (=, +, -, @) não pode
  // ser lida como tal quando o texto veio do banco.
  const seguro = /^[=+\-@]/.test(t) && !/^[+-]?\d/.test(t) ? `'${t}` : t;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

/** Centavos inteiros → "-1234,56" (sem milhar, que a planilha entende como número). */
export const valorDaPlanilha = (centavos) => {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(Math.round(centavos));
  return `${sinal}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
};

/**
 * @param linhas [{ data: 'AAAA-MM-DD', tipo, descricao, detalhes, etiquetas: [], parcela, situacao, valor (centavos, com sinal) }]
 * @returns o texto do arquivo, com BOM.
 */
export function csvDosLancamentos(linhas) {
  const dataBR = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
  const corpo = linhas.map((l) => [
    dataBR(l.data), l.tipo, l.descricao, l.detalhes, (l.etiquetas ?? []).join(', '),
    l.parcela ?? '', l.situacao, valorDaPlanilha(l.valor),
  ].map(celula).join(';'));
  return `﻿${[COLUNAS.join(';'), ...corpo].join('\r\n')}\r\n`;
}
