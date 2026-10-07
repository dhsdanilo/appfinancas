// Um seletor de mês (só mês e ano, sem dia): um botão com o mês escolhido que abre, logo abaixo, a
// grade dos 12 meses do ano, com ‹ › para trocar de ano. Substitui o <input type="month"> do navegador,
// que é feio e muda de um aparelho para outro.
//
// Marcação esperada (js/app/seletor-mes.js só liga):
//   <div class="seletor-mes">
//     <input type="hidden" name="mes">                         ← o valor, "AAAA-MM"
//     <button type="button" class="seletor-mes-botao"></button>
//     <div class="seletor-mes-painel" hidden></div>
//   </div>

import { hoje, nomeDoMes } from '../core/datas.js';

const NOMES = Array.from({ length: 12 }, (_, i) => nomeDoMes(`2000-${String(i + 1).padStart(2, '0')}`).split(' ')[0].slice(0, 3));
const maiuscula = (t) => t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1);

/**
 * @param raiz      o elemento .seletor-mes
 * @param aoMudar   (mes) → chamado quando a pessoa escolhe um mês
 * @param marcados  () → Set de meses (AAAA-MM) que ganham um ponto (já têm registro)
 */
export function ligarSeletorDeMes(raiz, { aoMudar = () => {}, marcados = () => new Set() } = {}) {
  const entrada = raiz.querySelector('input[type="hidden"]');
  const botao = raiz.querySelector('.seletor-mes-botao');
  const painel = raiz.querySelector('.seletor-mes-painel');
  let ano = Number(hoje().slice(0, 4));

  const rotulo = () => (entrada.value ? maiuscula(nomeDoMes(entrada.value)) : 'Escolher o mês');

  function desenhar() {
    botao.innerHTML = `<span>${rotulo()}</span><span aria-hidden="true">▾</span>`;
    botao.setAttribute('aria-expanded', String(!painel.hidden));
    if (painel.hidden) return;
    const ja = marcados();
    const atual = hoje().slice(0, 7);
    painel.innerHTML = `<div class="seletor-ano">
        <button type="button" data-ano="-1" aria-label="Ano anterior">‹</button><strong>${ano}</strong><button type="button" data-ano="1" aria-label="Próximo ano">›</button>
      </div>
      <div class="seletor-grade" role="group" aria-label="Meses de ${ano}">${NOMES.map((n, i) => {
        const mes = `${ano}-${String(i + 1).padStart(2, '0')}`;
        return `<button type="button" data-mes="${mes}" aria-pressed="${mes === entrada.value}" class="${mes === atual ? 'este-mes' : ''} ${ja.has(mes) ? 'registrado' : ''}"
          title="${ja.has(mes) ? 'já tem registro' : ''}">${n}</button>`;
      }).join('')}</div>`;
  }

  botao.addEventListener('click', () => {
    painel.hidden = !painel.hidden;
    if (!painel.hidden) ano = entrada.value ? Number(entrada.value.slice(0, 4)) : Number(hoje().slice(0, 4));
    desenhar();
  });
  painel.addEventListener('click', (e) => {
    const troca = e.target.closest('[data-ano]');
    if (troca) { ano += Number(troca.dataset.ano); desenhar(); return; }
    const mes = e.target.closest('[data-mes]');
    if (!mes) return;
    entrada.value = mes.dataset.mes;
    painel.hidden = true;
    desenhar();
    entrada.dispatchEvent(new Event('input', { bubbles: true }));
    aoMudar(entrada.value);
  });

  desenhar();
  return {
    /** Põe o mês (AAAA-MM) e fecha o painel. */
    definir(mes) { entrada.value = mes ?? ''; painel.hidden = true; desenhar(); },
    fechar() { painel.hidden = true; desenhar(); },
  };
}
