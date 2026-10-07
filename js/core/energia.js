// Energia (sistema fotovoltaico): o registro mensal, digitado à mão, do que a fatura da
// concessionária e o inversor dizem, e a conta do que a luz custaria se não houvesse o
// sistema. Não tem ligação nenhuma com os envelopes: é só o demonstrativo do mês.
//
// O inversor de quem escreveu isto não mede o que o sistema gera e é consumido na hora, então:
//   consumido direto do FV = produzido − injetado na rede
//   consumo real           = consumo da concessionária + consumido direto do FV
//   custo integral         = consumo real × (TE + TUSD + bandeira) + iluminação pública
//   economia               = custo integral − conta paga
//
// As tarifas são os "preços unitários com tributos" da fatura, em R$/kWh com 6 casas: guardam-se
// em milionésimos de real (338941 = R$ 0,338941). Dinheiro continua em centavos inteiros.

import { hoje } from './datas.js';

/** A fração de real de uma tarifa digitada ("0,338941" → 338941). */
export const tarifaDeTexto = (texto) => {
  const n = Number(String(texto ?? '').trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) : 0;
};

/** Milionésimos de real → "0,338941". */
export const tarifaParaTexto = (micro) => (micro / 1e6).toFixed(6).replace('.', ',');

/** Um número de kWh digitado ("1.296,5" → 1296.5); vazio ou inválido → null. */
export function kwhDeTexto(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A conta de um mês. `r`: { consumo, injetado, producao, te6, tusd6, bandeira6, ilum, conta }.
 * Devolve null enquanto faltar o que a conta precisa (consumo, produção e as duas tarifas).
 * `inconsistente`: injetou mais do que produziu — os dois medidores não batem; o direto vira 0.
 */
export function calculoDoMes(r) {
  if (!r || r.consumo == null || r.producao == null || !r.te6 || !r.tusd6) return null;
  const injetado = r.injetado ?? 0;
  const inconsistente = r.producao < injetado;
  const diretoFV = Math.max(0, r.producao - injetado);
  const consumoReal = r.consumo + diretoFV;
  const tarifa6 = r.te6 + r.tusd6 + (r.bandeira6 ?? 0);
  const custoEnergia = Math.round((consumoReal * tarifa6) / 10000);
  const custoIntegral = custoEnergia + (r.ilum ?? 0);
  const conta = r.conta ?? null;
  return {
    mes: r.mes,
    consumo: r.consumo,
    injetado,
    producao: r.producao,
    diretoFV,
    consumoReal,
    // O que a concessionária de fato cobra por energia: o consumo menos o abatido.
    faturado: Math.max(0, r.consumo - injetado),
    tarifa6,
    custoEnergia,
    ilum: r.ilum ?? 0,
    custoIntegral,
    conta,
    economia: conta != null ? custoIntegral - conta : null,
    inconsistente,
  };
}

/** Os meses registrados, do mais antigo ao mais novo, já com a conta de cada um. */
export function mesesDeEnergia(estado) {
  return Object.values(estado.energia ?? {})
    .sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0))
    .map((r) => ({ registro: r, calculo: calculoDoMes(r) }));
}

/** Os meses entre `de` e `ate` (AAAA-MM), inclusive; `de` null = desde o primeiro registro. */
export function periodoDeEnergia(estado, de = null, ate = hoje().slice(0, 7)) {
  return mesesDeEnergia(estado).filter((x) => (de == null || x.registro.mes >= de) && x.registro.mes <= ate);
}

/** Somas de um período: só os meses que têm conta pronta; a economia só onde há conta paga. */
export function resumoDeEnergia(meses) {
  const prontos = meses.filter((x) => x.calculo);
  const soma = (f) => prontos.reduce((t, x) => t + (f(x.calculo) ?? 0), 0);
  const comConta = prontos.filter((x) => x.calculo.conta != null);
  return {
    meses: prontos.length,
    consumoReal: soma((c) => c.consumoReal),
    diretoFV: soma((c) => c.diretoFV),
    consumo: soma((c) => c.consumo),
    injetado: soma((c) => c.injetado),
    producao: soma((c) => c.producao),
    custoIntegral: soma((c) => c.custoIntegral),
    conta: comConta.reduce((t, x) => t + x.calculo.conta, 0),
    economia: comConta.reduce((t, x) => t + x.calculo.economia, 0),
    mesesComConta: comConta.length,
  };
}
