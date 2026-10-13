// Faz cair as contas fixas marcadas "cai sozinha" (design/13 §1): ao abrir o
// app e depois de cada sincronização. Nunca avisa (D7) — a linha aparece no
// extrato com a marca "caiu sozinha".

import * as estado from '../core/estado.js';
import { automaticasPendentes } from '../core/automaticas.js';

let rodando = false;

export async function lancarAutomaticas() {
  if (rodando) return;
  rodando = true;
  try {
    const app = await estado.calcular();
    for (const dados of automaticasPendentes(app)) {
      await estado.aplicarEvento('lancamento.registrado', dados);
    }
  } finally {
    rodando = false;
  }
}

/**
 * Liga: depois da primeira sincronização (ou de 8 s sem ela — sem rede, cai assim
 * mesmo), e de novo quando a sincronização trouxer algo de outro aparelho.
 * Rodar antes de receber gravava de novo o que o outro aparelho já tinha
 * lançado e corrigido.
 */
export async function ligarAutomaticas({ depoisDe = Promise.resolve() } = {}) {
  estado.aoAplicar((motivo) => { if (motivo === 'recebido') lancarAutomaticas(); });
  await Promise.race([depoisDe, new Promise((r) => setTimeout(r, 8000))]);
  await lancarAutomaticas();
}
