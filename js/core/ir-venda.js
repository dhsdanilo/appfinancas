// Quanto sobra se um título do Tesouro for vendido agora: o valor pelo preço de venda,
// menos o IR da tabela regressiva (a mesma do banco). Conta feita por compra, só sobre o
// ganho, com a alíquota de cada uma pelos dias desde que foi feita. Não inclui a taxa de
// custódia da B3 (o banco também não a desconta do "valor líquido"). Perda não gera IR
// e não compensa o ganho de outra compra.

import { hoje } from './datas.js';

/** Alíquota do IR de renda fixa pelos dias corridos da compra. */
export function aliquotaDoIR(dias) {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}

const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);

/**
 * @param p a posição por cotas (core/investimentos.js `posicao`)
 * @returns null quando não dá para calcular; senão
 *   { data, bruto, custo, ganho, ir, liquido, aliquotas: [0.175], preco }
 */
export function liquidoDaVenda(p, dia = hoje()) {
  if (!p?.porCotas || !p.cotacao || !p.quantidade || !p.lotes?.length) return null;
  let bruto = 0;
  let custo = 0;
  let ganho = 0;
  let ir = 0;
  const aliquotas = new Set();
  for (const l of p.lotes) {
    const valor = l.resta * p.cotacao.preco;
    const dele = l.valor != null && l.quantidade ? (l.valor * l.resta) / l.quantidade : l.resta * l.preco;
    const g = Math.max(0, valor - dele);
    const aliquota = aliquotaDoIR(diasEntre(l.data, dia));
    bruto += valor;
    custo += dele;
    ganho += g;
    ir += g * aliquota;
    if (g > 0) aliquotas.add(aliquota);
  }
  const b = Math.round(bruto);
  const i = Math.round(ir);
  return {
    data: p.cotacao.data,
    preco: p.cotacao.preco,
    bruto: b,
    custo: Math.round(custo),
    ganho: Math.round(ganho),
    ir: i,
    liquido: b - i,
    aliquotas: [...aliquotas].sort(),
  };
}
