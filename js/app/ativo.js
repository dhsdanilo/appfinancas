// A janela de um ativo de investimento (design/10 §3 e §3.6): criar, e depois
// aplicar, resgatar, receber provento e informar o valor de hoje — tudo dali,
// sem passar pelo formulário de lançamento, que é de gasto e receita.
//
// O dinheiro sai e volta pela conta da conta de investimento: a própria
// corretora (caixa parado) ou a corrente do banco a que ela está ligada.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { hoje, diaCurto } from '../core/datas.js';
import { visiveis } from '../core/lancamentos.js';
import { CLASSES, nomeDaClasse, posicao, contaDoDinheiro } from '../core/investimentos.js';

const MARCACAO = `
<dialog id="dialogo-ativo" class="dialogo-captura dialogo-ativo" data-area="investimentos" aria-labelledby="titulo-ativo">
  <div class="cabecalho-dialogo">
    <strong id="titulo-ativo">Ativo</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples">
    <p class="nota" data-ativo="cabeca"></p>

    <!-- Criar, ou corrigir o que o ativo é. -->
    <div class="ficha-ativo" data-ativo="ficha">
      <label class="campo-simples"><span class="miudo">nome</span>
        <input type="text" data-ativo="nome" autocomplete="off" placeholder="CDB Banco, Tesouro IPCA+ 2035"></label>
      <label class="campo-simples"><span class="miudo">classe</span>
        <select data-ativo="classe">${CLASSES.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('')}</select></label>
      <label class="campo-simples"><span class="miudo">vencimento · opcional</span>
        <input type="date" data-ativo="vencimento"></label>
      <div class="acoes"><button type="button" class="principal" data-ativo="b-ficha">Criar</button></div>
    </div>

    <!-- As operações, num ativo que já existe. -->
    <div class="operacoes-ativo" data-ativo="operacoes" hidden>
      <div class="numeros-renda" data-ativo="numeros"></div>
      <div class="pilulas" role="group" aria-label="Operação" data-ativo="tipos">
        <button type="button" data-op="aplicacao" aria-pressed="true">aplicar</button>
        <button type="button" data-op="resgate" aria-pressed="false">resgatar</button>
        <button type="button" data-op="provento" aria-pressed="false">provento / juros</button>
        <button type="button" data-op="avaliacao" aria-pressed="false">valor de hoje</button>
      </div>
      <div class="linha-operacao">
        <label class="campo-simples"><span class="miudo" data-ativo="rotulo-valor">valor</span>
          <input type="text" inputmode="decimal" data-ativo="valor" autocomplete="off" placeholder="0,00"></label>
        <label class="campo-simples"><span class="miudo">data</span>
          <input type="date" data-ativo="data"></label>
      </div>
      <p class="nota" data-ativo="pista"></p>
      <p class="recado" data-ativo="recado" hidden></p>
      <div class="acoes"><button type="button" class="principal" data-ativo="b-op">Registrar</button></div>

      <p class="miudo titulo-linhas">operações</p>
      <ol class="linhas-holerite operacoes-lista" data-ativo="lista"></ol>

      <p class="zona-perigo fim-contrato">
        <button type="button" class="elo" data-ativo="b-editar">editar ativo</button>
        <button type="button" class="elo" data-ativo="b-arquivar"></button>
        <button type="button" class="elo perigo" data-ativo="b-excluir">excluir</button>
      </p>
    </div>
  </div>
</dialog>`;

const NOME_DA_OP = { aplicacao: 'aplicação', resgate: 'resgate', provento: 'provento', avaliacao: 'valor informado' };

export function criarJanelaDoAtivo({ aoSalvar } = {}) {
  document.body.insertAdjacentHTML('beforeend', MARCACAO);
  const janela = document.getElementById('dialogo-ativo');
  const el = (papel) => janela.querySelector(`[data-ativo="${papel}"]`);

  let app = null;
  let ativo = null;     // o ativo aberto; null ao criar
  let contaId = null;   // a conta de investimento
  let op = 'aplicacao';
  let editandoFicha = false;

  const recadar = (t) => { el('recado').textContent = t; el('recado').hidden = !t; };

  function pintar() {
    const conta = app.contas[contaId];
    const dinheiro = app.contas[contaDoDinheiro(conta)];
    if (!ativo || editandoFicha) {
      document.getElementById('titulo-ativo').textContent = ativo ? 'Editar ativo' : 'Novo ativo';
      el('cabeca').textContent = `em ${conta.nome}`;
      el('ficha').hidden = false;
      el('operacoes').hidden = true;
      el('b-ficha').textContent = ativo ? 'Salvar' : 'Criar';
      return;
    }
    document.getElementById('titulo-ativo').textContent = ativo.nome;
    el('cabeca').textContent = `${nomeDaClasse(ativo.classe)} · ${conta.nome}${ativo.vencimento ? ` · vence ${diaCurto(ativo.vencimento)}/${ativo.vencimento.slice(0, 4)}` : ''}`;
    el('ficha').hidden = true;
    el('operacoes').hidden = false;

    const p = posicao(app, ativo.id);
    const n = (r, v) => `<div class="numero-faixa"><span class="rotulo-numero">${r}</span><span class="valor-numero">${v}</span></div>`;
    el('numeros').innerHTML =
      n(p.avaliacao ? `valor em ${diaCurto(p.avaliacao.data)}${p.estimado ? ' + movimentos' : ''}` : 'valor (sem informar)', `${p.estimado ? '~' : ''}${formatar(p.valorAtual)}`) +
      n('investido', formatar(p.investido)) +
      n('rendeu', `${p.rendeu >= 0 ? '+' : '−'}${formatar(Math.abs(p.rendeu))}${p.aplicado ? ` · ${(p.pct * 100).toFixed(1).replace('.', ',')}%` : ''}`);

    for (const b of el('tipos').querySelectorAll('[data-op]')) b.setAttribute('aria-pressed', String(b.dataset.op === op));
    el('rotulo-valor').textContent = op === 'avaliacao' ? 'quanto vale hoje' : 'valor';
    el('pista').textContent =
      op === 'aplicacao' ? `sai de ${dinheiro.nome}`
        : op === 'resgate' ? `volta para ${dinheiro.nome}`
          : op === 'provento' ? `entra em ${dinheiro.nome} — conta como rendimento, não como receita`
            : 'o que o banco mostra: o rendimento sai da diferença';
    el('b-op').textContent = { aplicacao: 'Aplicar', resgate: 'Resgatar', provento: 'Registrar provento', avaliacao: 'Informar valor' }[op];

    // As operações do ativo, da mais nova para a mais antiga.
    const ops = visiveis(app)
      .filter((l) => l.ativoId === ativo.id)
      .map((l) => ({ id: l.id, data: l.dataCompetencia, tipo: l.tipo, valor: l.valor }));
    const avs = ativo.avaliacoes.map((a) => ({ id: `av:${a.data}`, data: a.data, tipo: 'avaliacao', valor: a.valor }));
    const todas = [...ops, ...avs].sort((a, b) => (a.data < b.data ? 1 : -1));
    el('lista').innerHTML = todas.length
      ? todas.map((o) => `<li class="linha-holerite operacao ${o.tipo}">
          <span class="quando">${diaCurto(o.data)}</span>
          <span class="nome-linha">${NOME_DA_OP[o.tipo]}</span>
          <span class="valor-lancado">${o.tipo === 'aplicacao' ? '−' : o.tipo === 'avaliacao' ? '=' : '+'} ${formatar(o.valor)}</span>
          ${o.tipo === 'avaliacao' ? '' : `<button type="button" class="elo" data-apagar-op="${o.id}">apagar</button>`}
        </li>`).join('')
      : '<li class="vazio">Nenhuma ainda. Comece pela aplicação.</li>';

    el('b-arquivar').textContent = ativo.arquivado ? 'desarquivar' : 'arquivar';
    el('b-excluir').hidden = ops.length > 0;
  }

  async function recarregar() {
    app = await estado.calcular();
    if (ativo) ativo = app.ativos[ativo.id] ?? null;
    pintar();
  }

  async function salvarFicha() {
    const nome = el('nome').value.trim();
    if (!nome) { el('nome').focus(); return; }
    const dados = { nome, classe: el('classe').value, vencimento: el('vencimento').value || null };
    if (ativo) {
      await estado.aplicarEvento('ativo.alterado', { id: ativo.id, ...dados });
    } else {
      const id = novoId('atv');
      await estado.aplicarEvento('ativo.criado', { id, contaId, ...dados });
      ativo = { id };
    }
    editandoFicha = false;
    await recarregar();
    if (aoSalvar) await aoSalvar();
    el('valor').focus();
  }

  async function registrar() {
    const valor = Math.abs(deTexto(el('valor').value));
    const data = el('data').value || hoje();
    if (!valor) { recadar('Falta o valor.'); return; }
    recadar('');
    if (op === 'avaliacao') {
      await estado.aplicarEvento('ativo.avaliado', { id: ativo.id, data, valor });
    } else {
      const conta = app.contas[contaId];
      const ap = await log.aparelho();
      await estado.aplicarEvento('lancamento.registrado', {
        id: novoId('lan'),
        tipo: op,
        valor,
        contaId: contaDoDinheiro(conta),
        ativoId: ativo.id,
        categoriaId: null,
        dataCompetencia: data,
        dataCaixa: data,
        confirmado: data <= hoje(),
        lancadoPor: ap?.id ?? null,
      });
    }
    el('valor').value = '';
    await recarregar();
    if (aoSalvar) await aoSalvar();
  }

  // ── eventos ─────────────────────────────────────────────────────────────

  janela.querySelector('[data-fechar]').addEventListener('click', () => janela.close());
  el('b-ficha').addEventListener('click', salvarFicha);
  el('nome').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvarFicha(); } });
  el('b-op').addEventListener('click', registrar);
  el('valor').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); registrar(); } });
  el('tipos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    op = b.dataset.op;
    recadar('');
    pintar();
    el('valor').focus();
  });
  el('lista').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-apagar-op]');
    if (!b) return;
    if (b.dataset.confirmar !== '1') {
      b.dataset.confirmar = '1';
      b.textContent = 'apagar mesmo?';
      return;
    }
    await estado.aplicarEvento('lancamento.removido', { id: b.dataset.apagarOp });
    await recarregar();
    if (aoSalvar) await aoSalvar();
  });
  el('b-editar').addEventListener('click', () => {
    editandoFicha = true;
    el('nome').value = ativo.nome;
    el('classe').value = ativo.classe;
    el('vencimento').value = ativo.vencimento ?? '';
    pintar();
    el('nome').focus();
  });
  el('b-arquivar').addEventListener('click', async () => {
    await estado.aplicarEvento('ativo.arquivado', { id: ativo.id, arquivado: !ativo.arquivado });
    janela.close();
    if (aoSalvar) await aoSalvar();
  });
  el('b-excluir').addEventListener('click', async () => {
    await estado.aplicarEvento('ativo.removido', { id: ativo.id });
    janela.close();
    if (aoSalvar) await aoSalvar();
  });

  return {
    /** Um ativo novo dentro da conta de investimento. */
    async novo(idDaConta) {
      app = await estado.calcular();
      contaId = idDaConta;
      ativo = null;
      editandoFicha = false;
      el('nome').value = '';
      el('classe').value = 'renda_fixa';
      el('vencimento').value = '';
      pintar();
      janela.showModal();
      el('nome').focus();
    },

    /** Um ativo que já existe: as operações dele. */
    async abrir(ativoId, opInicial = 'aplicacao') {
      app = await estado.calcular();
      ativo = app.ativos[ativoId];
      if (!ativo) return;
      contaId = ativo.contaId;
      op = opInicial;
      editandoFicha = false;
      el('valor').value = '';
      el('data').value = hoje();
      recadar('');
      pintar();
      janela.showModal();
      el('valor').focus();
    },
  };
}
