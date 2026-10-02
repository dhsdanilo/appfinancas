// A zona de apagar, em um lugar só — usada pela correção de lançamento e pela
// de transferência.
//
// Duas regras, do design/03-alimentacao.md §3.3 e §9:
//   fica DENTRO do diálogo, nunca na lista — ação destrutiva a um toque na
//   linha é como se apaga coisa sem querer no celular;
//   a pergunta vem ANTES, nomeando o que vai embora, e não há "desfazer"
//   depois: apagar não é desfazer.

/**
 * @param {HTMLElement} zona       o elemento que hospeda o botão
 * @param {object} opcoes
 * @param {Function} opcoes.descricao  devolve o texto do que será apagado
 * @param {Function} opcoes.apagar     executa a remoção
 * @param {string}  [opcoes.rotulo]
 */
export function ligarZonaDePerigo(zona, { descricao, apagar, rotulo = 'apagar lançamento' }) {
  function emRepouso() {
    zona.innerHTML = `<button type="button" class="elo" data-papel="b-apagar">${rotulo}</button>`;
  }

  function perguntar() {
    zona.innerHTML =
      `<span class="pergunta">apagar ${escapar(descricao())}?</span>` +
      '<button type="button" class="perigo" data-papel="b-sim">apagar</button>' +
      '<button type="button" class="elo" data-papel="b-nao">não</button>';
  }

  zona.addEventListener('click', async (e) => {
    if (e.target.closest('[data-papel="b-apagar"]')) return perguntar();
    if (e.target.closest('[data-papel="b-nao"]')) return emRepouso();
    if (e.target.closest('[data-papel="b-sim"]')) return apagar();
  });

  return {
    /** Mostra a zona (modo correção) ou a esconde (modo captura). */
    mostrar(sim) {
      zona.hidden = !sim;
      if (sim) emRepouso();
    },
  };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
