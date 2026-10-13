// Gravar é uma vez por toque. Sem isto, dois toques rápidos (ou Enter e o
// clique juntos) entravam os dois na mesma gravação antes de a primeira acabar,
// e o mesmo lançamento saía duas vezes.

/**
 * Envolve uma ação assíncrona: enquanto ela roda, chamá-la de novo não faz
 * nada (devolve undefined, que quem chama lê como "não salvou").
 */
export function umaVez(acao) {
  let rodando = false;
  return async function (...args) {
    if (rodando) return undefined;
    rodando = true;
    try {
      return await acao.apply(this, args);
    } finally {
      rodando = false;
    }
  };
}
