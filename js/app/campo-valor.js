// O campo de dinheiro, em um lugar só.
//
// Ele existe em dois formulários — a captura (despesa e receita) e a
// transferência — e o comportamento tem que ser o mesmo nos dois: entrada
// estilo calculadora, dígitos pela direita, centavos em fonte menor.
//
// O campo real fica por cima, transparente: é ele que traz o teclado do
// aparelho e recebe as teclas; o desenho atrás é o que se lê. Um <input> não
// consegue dar tamanho menor só aos centavos nem garantir algarismo tabular.

import { deDigitos, partes } from '../core/dinheiro.js';

const MAX_DIGITOS = 10; // R$ 99.999.999,99

export const MARCACAO_CAMPO_VALOR = `
  <div class="campo-valor">
    <div class="valor dinheiro zerado" data-papel="valor" aria-hidden="true">
      <span class="moeda">R$</span><span data-papel="reais">0</span><span class="sep">,</span><span class="centavos" data-papel="centavos">00</span>
    </div>
    <input data-papel="entrada" class="entrada-valor" type="text" inputmode="numeric"
           pattern="[0-9]*" autocomplete="off" autocorrect="off" spellcheck="false"
           enterkeyhint="done" aria-label="Valor em reais">
  </div>
`;

/**
 * @param {HTMLElement} raiz        onde a marcação acima foi montada
 * @param {object} opcoes
 * @param {Function} [opcoes.aoMudar]     chamado a cada mudança de valor
 * @param {Function} [opcoes.aoConfirmar] chamado no Enter, com o evento
 */
export function ligarCampoValor(raiz, { aoMudar = () => {}, aoConfirmar = () => {} } = {}) {
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);
  const entrada = el('entrada');

  const centavos = () => deDigitos(entrada.value);

  function pintar() {
    const p = partes(centavos());
    el('reais').textContent = p.reais;
    el('centavos').textContent = p.centavos;
    el('valor').classList.toggle('zerado', centavos() === 0);
    aoMudar(centavos());
  }

  // O teclado do aparelho manda o que quiser — vírgula, ponto, texto colado.
  // Aqui só sobram dígitos, e é isso que mantém a entrada estilo calculadora
  // verdadeira mesmo num teclado que oferece a tecla de vírgula.
  function normalizar() {
    const limpo = entrada.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITOS);
    if (entrada.value !== limpo) entrada.value = limpo;
    pintar();
  }

  entrada.addEventListener('input', normalizar);
  entrada.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    aoConfirmar(e);
  });
  el('valor').parentElement.addEventListener('click', () => entrada.focus());

  return {
    centavos,
    pintar,
    /** Preenche com um valor em centavos (usado ao abrir uma correção). */
    definir(valor) {
      entrada.value = valor ? String(valor) : '';
      pintar();
    },
    limpar() {
      entrada.value = '';
      pintar();
    },
    focar: () => entrada.focus(),
    desfocar: () => entrada.blur(),
  };
}
