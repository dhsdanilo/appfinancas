// Transferência: de onde sai, pra onde vai e quanto. Nada mais.
// design/03-alimentacao.md §3.1
//
// Sem categoria, de propósito: o dinheiro não saiu da vida, só trocou de bolso.
// Tratar transferência como despesa é o erro número um dos apps desse gênero —
// dobra o gasto do mês e faz o relatório perder credibilidade na primeira
// semana.
//
// Transferir, sacar, depositar, aportar e resgatar são a MESMA operação, mudando
// só o nome que a tela usa. Por isso existe um formulário só.
//
// Ela vive no andar de cima, nunca no térreo: precisa de duas contas (mais
// toques do que a tela de 3 toques tolera) e não é perecível — o valor de um
// saque se registra em casa sem perder nada (§3).

import { valorLancavel, formatar } from '../core/dinheiro.js';
import { novoId } from '../core/id.js';
import * as log from '../core/log.js';
import * as estado from '../core/estado.js';
import { hoje, nasceConfirmado, correcao, tipoDaTransferencia } from '../core/lancamentos.js';
import { MARCACAO_CAMPO_VALOR, ligarCampoValor } from './campo-valor.js';
import { ligarZonaDePerigo } from './zona-perigo.js';
import { areaDaConta, opcoesDeConta } from './areas.js';

// Todas as contas que não estão arquivadas. Cartão, dívida e folha entram
// porque o dinheiro passa por elas de verdade: pagar a fatura é corrente →
// cartão, e o líquido do holerite é folha → corrente.
//
// Pagar a fatura é ESTA operação com destino num cartão, e o tipo
// `pagamento_fatura` sai do destino sozinho — não existe como errar
// (03-alimentacao §6.2). O holerite (D25) ainda não tem tipo próprio.

const MARCACAO = `
  ${MARCACAO_CAMPO_VALOR}

  <div class="contexto contexto-transferencia">
    <input type="date" class="data-exata" data-papel="data" aria-label="Data da transferência">
  </div>

  <div class="rota">
    <label class="perna">
      <span class="miudo">de</span>
      <select data-papel="origem" aria-label="Conta de origem"></select>
    </label>
    <span class="seta" aria-hidden="true">→</span>
    <label class="perna">
      <span class="miudo">para</span>
      <select data-papel="destino" aria-label="Conta de destino"></select>
    </label>
  </div>

  <p class="recado" data-papel="recado" hidden></p>

  <div class="acoes">
    <button type="button" class="principal" data-papel="b-salvar" disabled>Transferir</button>
  </div>

  <p class="zona-perigo" data-papel="perigo" hidden></p>
`;

/**
 * @param {object} opcoes
 * @param {HTMLElement} opcoes.raiz
 * @param {Function} [opcoes.aoSalvar]
 * @param {Function} [opcoes.aoFechar]
 */
export async function criarTransferencia({ raiz, aoSalvar, aoFechar, aoMudarTitulo }) {
  raiz.innerHTML = MARCACAO;
  // Transferência não é de área: leva a cor do próprio tipo, ela e a janela.
  raiz.dataset.area = 'transferencia';
  const janela = raiz.closest('dialog');
  if (janela) janela.dataset.area = 'transferencia';
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);

  let app = null;
  let data = hoje();
  let editando = null;
  // A série de que esta transferência é a ocorrência, quando veio de um previsto.
  let daSerie = null;

  const valor = ligarCampoValor(raiz, {
    aoMudar: () => pintarAcao(),
    aoConfirmar: async () => {
      const salvou = await salvar();
      if (salvou && aoFechar) aoFechar();
    },
  });

  const origem = () => el('origem').value || null;
  const destino = () => el('destino').value || null;

  const pronto = () =>
    valorLancavel(valor.centavos()) && origem() && destino() && origem() !== destino();

  const pagandoFatura = () => Boolean(app) && tipoDaTransferencia(app, destino()) === 'pagamento_fatura';

  /** Cada perna veste a cor da área da sua conta (09-identidade §3). */
  function pintarAreas() {
    if (!app) return;
    el('origem').closest('.perna').dataset.area = areaDaConta(app.contas[origem()]);
    el('destino').closest('.perna').dataset.area = areaDaConta(app.contas[destino()]);
  }

  function pintarAcao() {
    pintarAreas();
    el('b-salvar').disabled = !pronto();
    el('b-salvar').textContent = editando ? 'Salvar' : pagandoFatura() ? 'Pagar fatura' : 'Transferir';
    if (aoMudarTitulo) aoMudarTitulo(pagandoFatura() ? 'Pagar fatura' : 'Transferência');

    // A recusa diz o que resolve, nunca só que não dá.
    const mesma = origem() && origem() === destino();
    el('recado').textContent = mesma
      ? 'Escolha duas contas diferentes: transferência é dinheiro trocando de bolso.'
      : '';
    el('recado').hidden = !mesma;
  }

  function contasDisponiveis() {
    return Object.values(app.contas)
      .filter((c) => !c.arquivada)
      .sort((a, b) => (a.nome < b.nome ? -1 : 1));
  }

  function pintarContas() {
    const contas = contasDisponiveis();
    const opcoes = (escolhida) => opcoesDeConta(contas, escolhida, { vazia: true });

    const antesOrigem = editando ? editando.contaId : origem();
    const antesDestino = editando ? editando.contaDestinoId : destino();
    el('origem').innerHTML = opcoes(antesOrigem);
    el('destino').innerHTML = opcoes(antesDestino);
  }

  function pintarData() {
    el('data').value = data;
  }

  // ── apagar ──────────────────────────────────────────────────────────────

  const perigo = ligarZonaDePerigo(el('perigo'), {
    rotulo: 'apagar transferência',
    descricao: () => {
      const de = app.contas[editando.contaId]?.nome ?? '—';
      const para = app.contas[editando.contaDestinoId]?.nome ?? '—';
      return `${formatar(editando.valor)} · ${de} → ${para}`;
    },
    apagar: async () => {
      await estado.aplicarEvento('lancamento.removido', { id: editando.id });
      if (aoSalvar) await aoSalvar();
      if (aoFechar) aoFechar();
    },
  });

  // ── salvar ──────────────────────────────────────────────────────────────

  async function salvar() {
    if (!pronto()) return false;
    return editando ? salvarCorrecao() : registrar();
  }

  async function registrar() {
    const ap = await log.aparelho();
    await estado.aplicarEvento('lancamento.registrado', {
      id: novoId('lan'),
      tipo: tipoDaTransferencia(app, destino()),
      valor: valor.centavos(),
      dataCompetencia: data,
      dataCaixa: data,
      contaId: origem(),
      contaDestinoId: destino(),
      // Sem categoria: não é gasto nem ganho (§3.1).
      categoriaId: null,
      confirmado: nasceConfirmado({ manual: true, dataCaixa: data }),
      recorrenciaId: daSerie,
      lancadoPor: ap?.id ?? null,
    });
    daSerie = null;
    await recarregar();
    if (aoSalvar) await aoSalvar();
    return true;
  }

  async function salvarCorrecao() {
    const mudancas = correcao(editando, {
      valor: valor.centavos(),
      tipo: tipoDaTransferencia(app, destino()),
      contaId: origem(),
      contaDestinoId: destino(),
      dataCaixa: data,
    });
    if (Object.keys(mudancas).length === 0) return true;

    await estado.aplicarEvento('lancamento.alterado', { id: editando.id, ...mudancas });
    await recarregar();
    editando = app.lancamentos[editando.id] ?? editando;
    if (aoSalvar) await aoSalvar();
    return true;
  }

  // ── eventos ─────────────────────────────────────────────────────────────

  el('b-salvar').addEventListener('click', async () => {
    const salvou = await salvar();
    if (salvou && aoFechar) aoFechar();
  });

  el('origem').addEventListener('change', pintarAcao);
  el('destino').addEventListener('change', pintarAcao);
  el('data').addEventListener('change', () => {
    if (!el('data').value) { pintarData(); return; }
    data = el('data').value;
  });

  // ── partida ─────────────────────────────────────────────────────────────

  async function recarregar() {
    app = await estado.calcular();
    pintarContas();
    pintarData();
    perigo.mostrar(Boolean(editando));
    valor.pintar();
    pintarAcao();
  }

  await recarregar();

  return {
    recarregar,
    focar: () => valor.focar(),

    async carregar(l) {
      editando = l;
      data = l.dataCaixa;
      valor.definir(l.valor);
      await recarregar();
    },

    limpar: () => {
      editando = null;
      daSerie = null;
      data = hoje();
      valor.limpar();
      el('origem').value = '';
      el('destino').value = '';
      pintarData();
      perigo.mostrar(false);
      pintarAcao();
    },

    /**
     * A ocorrência de uma transferência recorrente, vinda do extrato: tudo
     * preenchido, e lançar amarra à série — o previsto some (03 §4).
     */
    async preencher(o) {
      editando = null;
      daSerie = o.recorrenciaId;
      data = o.dataCompetencia;
      await recarregar();
      el('origem').value = o.contaId ?? '';
      el('destino').value = o.contaDestinoId ?? '';
      valor.definir(o.valor);
      pintarAcao();
    },

    /**
     * O botão "pagar fatura" do cartão: a mesma transferência, já com a conta
     * que paga, o cartão e o valor. Tudo editável — pagamento parcial é
     * permitido, e o que falta continua devido (03-alimentacao §6.2).
     */
    async pagarFatura({ cartaoId, origemId, centavos }) {
      editando = null;
      data = hoje();
      await recarregar();
      el('origem').value = origemId ?? '';
      el('destino').value = cartaoId;
      if (centavos > 0) valor.definir(centavos); else valor.limpar();
      pintarAcao();
    },
  };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
