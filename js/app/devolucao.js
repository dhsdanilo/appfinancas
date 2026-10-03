// A devolução — o estorno (03 §3.3). Não se cria do nada: parte-se da compra.
// Só se informam duas coisas, quanto e quando voltou; categoria, competência
// e o vínculo com a compra vêm herdados e não se editam, senão o abatimento
// cairia na categoria ou no mês errado.
//
// Estorno não é correção de erro: digitou errado, corrige ou apaga. Aqui é o
// dinheiro que voltou de verdade.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { hoje, diaCurto } from '../core/datas.js';
import { nomeDaCategoria, restanteEstornavel, dataVista } from '../core/lancamentos.js';
import { ligarZonaDePerigo } from './zona-perigo.js';
import { areaDaConta } from './areas.js';

const MARCACAO = `
  <p class="nota" data-papel="de"></p>
  <label class="campo-simples">
    <span class="miudo">quanto voltou</span>
    <input type="text" inputmode="decimal" data-papel="valor" autocomplete="off" aria-label="Quanto voltou">
  </label>
  <label class="campo-simples">
    <span class="miudo">quando voltou</span>
    <input type="date" data-papel="data" aria-label="Quando o dinheiro voltou">
  </label>
  <p class="recado" data-papel="recado" hidden></p>
  <div class="acoes"><button type="button" class="principal" data-papel="b-salvar">Registrar devolução</button></div>
  <p class="zona-perigo" data-papel="perigo" hidden></p>
`;

/**
 * @param {object} o
 * @param {HTMLDialogElement} o.janela
 * @param {HTMLElement} o.raiz
 * @param {Function} [o.aoSalvar]
 */
export function criarDevolucao({ janela, raiz, aoSalvar }) {
  raiz.innerHTML = MARCACAO;
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);

  let app = null;
  let compra = null;
  let editando = null;

  const perigo = ligarZonaDePerigo(el('perigo'), {
    rotulo: 'apagar devolução',
    descricao: () => formatar(editando.valor),
    apagar: async () => {
      await estado.aplicarEvento('lancamento.removido', { id: editando.id });
      if (aoSalvar) await aoSalvar();
      janela.close();
    },
  });

  function recadar(texto) {
    el('recado').textContent = texto;
    el('recado').hidden = !texto;
  }

  async function abrir(alvo) {
    app = await estado.calcular();
    // Abre pela compra (registrar) ou pelo próprio estorno (corrigir).
    editando = alvo.tipo === 'estorno' ? alvo : null;
    compra = editando ? app.lancamentos[editando.estornoDe] : alvo;
    if (!compra) return;

    const resta = restanteEstornavel(app, compra.id, editando?.id);
    el('de').innerHTML = `De <strong>${escapar(nomeDaCategoria(app, compra.categoriaId) || 'compra')}</strong> · ${escapar(formatar(compra.valor))} em ${diaCurto(dataVista(compra))}, ${escapar(app.contas[compra.contaId]?.nome ?? '')}. Dá pra devolver até ${escapar(formatar(resta))}.`;
    el('valor').value = formatar(editando ? editando.valor : resta, { comPrefixo: false });
    el('data').value = editando ? editando.devolvidoEm ?? editando.dataCaixa : hoje();
    el('b-salvar').textContent = editando ? 'Salvar' : 'Registrar devolução';
    recadar('');
    perigo.mostrar(Boolean(editando));
    // A janela veste a área da conta para onde o dinheiro volta.
    janela.dataset.area = areaDaConta(app.contas[compra.contaId]) || 'caixa';
    janela.showModal();
    el('valor').focus();
    el('valor').select();
  }

  async function salvar() {
    const valor = Math.abs(deTexto(el('valor').value));
    const data = el('data').value;
    const resta = restanteEstornavel(app, compra.id, editando?.id);
    if (!valor) return recadar('Falta quanto voltou.');
    if (valor > resta) {
      // A recusa diz o que resolve.
      return recadar(`Dá pra devolver no máximo ${formatar(resta)}: a soma das devoluções não passa o valor da compra.`);
    }
    if (!data) return recadar('Falta quando o dinheiro voltou.');

    if (editando) {
      const m = {};
      if (valor !== editando.valor) m.valor = valor;
      if (data !== (editando.devolvidoEm ?? editando.dataCaixa)) m.devolvidoEm = data;
      if (Object.keys(m).length) await estado.aplicarEvento('lancamento.alterado', { id: editando.id, ...m });
    } else {
      const ap = await log.aparelho();
      await estado.aplicarEvento('lancamento.registrado', {
        id: novoId('lan'),
        tipo: 'estorno',
        valor,
        estornoDe: compra.id,
        // Herdados da compra: é o que faz o mês dela voltar a ser verdade.
        categoriaId: compra.categoriaId,
        detalheId: compra.detalheId,
        etiquetas: compra.etiquetas ?? [],
        contaId: compra.contaId,
        dataCompetencia: compra.dataCompetencia,
        dataCaixa: data,
        devolvidoEm: data,
        // O saldo sobe quando o dinheiro voltou, não antes (D2).
        confirmado: data <= hoje(),
        lancadoPor: ap?.id ?? null,
      });
    }
    if (aoSalvar) await aoSalvar();
    janela.close();
  }

  el('b-salvar').addEventListener('click', salvar);
  raiz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      salvar();
    }
  });

  return { abrir };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
