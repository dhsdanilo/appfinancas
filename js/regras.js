// A aba Regras, em Configurações (design/13 §2): o que cada texto do banco
// vira, quantas vezes acertou, e apagar a que errou. Nada a cadastrar aqui —
// as regras nascem das decisões na importação e das correções.

import * as estado from './core/estado.js';
import { nomeDaCategoria } from './core/lancamentos.js';
import { usosDasRegras } from './core/importar.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function pintar() {
  const lista = $('lista-regras');
  if (!lista || $('painel-regras').hidden) return;
  const app = await estado.calcular();
  const usos = usosDasRegras(app);
  const regras = Object.values(app.regras ?? {}).sort((a, b) => a.padrao.localeCompare(b.padrao, 'pt-BR'));
  $('contador-regras').textContent = regras.length || '';
  lista.innerHTML = regras.length
    ? regras.map((r) => {
      const vira = r.transferePara
        ? `transferência ↔ ${app.contas[r.transferePara]?.nome ?? 'conta'}`
        : [nomeDaCategoria(app, r.categoriaId) || 'sem categoria', app.detalhes?.[r.detalheId]?.nome].filter(Boolean).join(' · ');
      const n = usos.get(r.id) ?? 0;
      return `<li class="item" data-regra="${esc(r.id)}">
        <span class="nome">“${esc(r.padrao)}”</span>
        <span class="meta">vira ${esc(vira)}</span>
        <span class="uso">${n ? `acertou ${n} ${n === 1 ? 'vez' : 'vezes'}` : 'ainda não usada'}</span>
        <span class="acoes-item"><button type="button" class="elo" data-apagar-regra="${esc(r.id)}">apagar</button></span>
      </li>`;
    }).join('')
    : '<li class="vazio">Nenhuma regra ainda. Elas nascem sozinhas: ao importar um extrato, a categoria que você escolhe para um texto do banco vira a regra dele.</li>';
}

document.addEventListener('click', async (e) => {
  const aba = e.target.closest('[data-aba="regras"]');
  if (aba) { setTimeout(pintar); return; }
  const b = e.target.closest('[data-apagar-regra]');
  if (!b) return;
  if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'apagar mesmo?'; return; }
  await estado.aplicarEvento('regra.removida', { id: b.dataset.apagarRegra });
});

document.addEventListener('app:tela', (e) => {
  if (e.detail.tela === 'configuracoes') setTimeout(pintar);
});
estado.aoAplicar(() => pintar());
