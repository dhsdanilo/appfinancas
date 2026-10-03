// Aritmética de calendário em ISO curto ('2027-03-10'). Sem fuso no meio: o dia
// é o dia de quem usa, e comparar strings ISO é comparar datas.

const dois = (n) => String(n).padStart(2, '0');

/** Data de hoje em ISO curto, no fuso de quem usa (não em UTC). */
export function hoje() {
  const d = new Date();
  const fuso = d.getTimezoneOffset() * 60000;
  return new Date(d - fuso).toISOString().slice(0, 10);
}

/**
 * O dia `dia` do mês, sem estourar: dia 31 em fevereiro é o último de
 * fevereiro, não 3 de março. `mes` é 1–12 e pode passar disso — 13 é janeiro
 * do ano seguinte.
 */
export function diaNoMes(ano, mes, dia) {
  const alvo = new Date(ano, mes - 1, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  return `${alvo.getFullYear()}-${dois(alvo.getMonth() + 1)}-${dois(Math.min(dia, ultimo))}`;
}

/** Mês cheio, sem estourar: 31/01 + 1 mês é 28/02, não 03/03. */
export function somarMeses(dia, quantos) {
  const [ano, mes, d] = dia.split('-').map(Number);
  return diaNoMes(ano, mes + quantos, d);
}

export function somarDias(dia, quantos) {
  const d = new Date(dia + 'T12:00:00');
  d.setDate(d.getDate() + quantos);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

export const inicioDoMes = (dia) => `${dia.slice(0, 7)}-01`;

export function fimDoMes(dia) {
  const [ano, mes] = dia.split('-').map(Number);
  return diaNoMes(ano, mes, 31);
}

/** '2027-03' → '2027-04'. */
export const proximoMes = (mes) => somarMeses(`${mes}-01`, 1).slice(0, 7);

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** '2027-03' → 'março de 2027'. */
export function nomeDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} de ${ano}`;
}

/** '2027-03-10' → '10/03'. */
export const diaCurto = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
