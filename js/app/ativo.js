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
import { CLASSES, CLASSES_POR_COTAS, nomeDaClasse, posicao, contaDoDinheiro } from '../core/investimentos.js';

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
      <label class="campo-simples"><span class="miudo">acompanhar</span>
        <select data-ativo="unidade">
          <option value="valor">pelo valor (CDB, Tesouro, poupança)</option>
          <option value="cotas">por quantidade e preço (ações, FII, cripto)</option>
        </select></label>
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
        <label class="campo-simples" data-ativo="campo-quantidade" hidden><span class="miudo">quantidade</span>
          <input type="text" inputmode="decimal" data-ativo="quantidade" autocomplete="off" placeholder="100"></label>
        <label class="campo-simples" data-ativo="campo-preco" hidden><span class="miudo" data-ativo="rotulo-preco">preço de cada</span>
          <input type="text" inputmode="decimal" data-ativo="preco" autocomplete="off" placeholder="0,00"></label>
        <label class="campo-simples" data-ativo="campo-taxas" hidden><span class="miudo">taxas · opcional</span>
          <input type="text" inputmode="decimal" data-ativo="taxas" autocomplete="off" placeholder="0,00"></label>
        <label class="campo-simples" data-ativo="campo-valor"><span class="miudo" data-ativo="rotulo-valor">valor</span>
          <input type="text" inputmode="decimal" data-ativo="valor" autocomplete="off" placeholder="0,00"></label>
        <label class="campo-simples"><span class="miudo">data</span>
          <input type="date" data-ativo="data"></label>
      </div>
      <p class="total-operacao" data-ativo="total" hidden></p>
      <p class="nota" data-ativo="pista"></p>
      <p class="recado" data-ativo="recado" hidden></p>
      <div class="acoes"><button type="button" class="principal" data-ativo="b-op">Registrar</button></div>

      <div data-ativo="parte-lotes" hidden>
        <p class="miudo titulo-linhas">compras na mão</p>
        <ol class="linhas-holerite operacoes-lista lotes" data-ativo="lotes"></ol>
      </div>
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
const NOME_DA_OP_COTAS = { aplicacao: 'compra', resgate: 'venda', provento: 'provento', avaliacao: 'cotação' };

/** "100", "0,5", "1.250,75" → número. Quantidade pode ser fracionada (cripto). */
function lerQuantidade(texto) {
  const t = String(texto).trim();
  if (!t) return 0;
  const limpo = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const quantos = (q) => q.toLocaleString('pt-BR', { maximumFractionDigits: 8 });

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
    const cotas = ativo.unidade === 'cotas';
    const nomes = cotas ? NOME_DA_OP_COTAS : NOME_DA_OP;
    for (const b of el('tipos').querySelectorAll('[data-op]')) {
      b.textContent = { aplicacao: cotas ? 'comprar' : 'aplicar', resgate: cotas ? 'vender' : 'resgatar', provento: 'provento / juros', avaliacao: cotas ? 'cotação' : 'valor de hoje' }[b.dataset.op];
    }
    const comQuantidade = cotas && (op === 'aplicacao' || op === 'resgate');
    el('campo-quantidade').hidden = !comQuantidade;
    el('campo-preco').hidden = !(comQuantidade || (cotas && op === 'avaliacao'));
    el('campo-taxas').hidden = !comQuantidade;
    el('campo-valor').hidden = comQuantidade || (cotas && op === 'avaliacao');
    el('rotulo-preco').textContent = op === 'avaliacao' ? 'preço de cada hoje' : 'preço de cada';
    pintarTotal();
    if (cotas) {
      el('numeros').innerHTML =
        n('quantidade', quantos(p.quantidade)) +
        n('preço médio', p.quantidade ? formatar(Math.round(p.precoMedio)) : '—') +
        n(p.cotacao ? `cotação de ${diaCurto(p.cotacao.data)}` : 'cotação', p.cotacao ? formatar(p.cotacao.preco) : 'sem informar') +
        n('valor atual', `${p.estimado ? '~' : ''}${formatar(p.valorAtual)}`) +
        n('rendeu', `${p.rendeu >= 0 ? '+' : '−'}${formatar(Math.abs(p.rendeu))}${p.aplicado ? ` · ${(p.pct * 100).toFixed(1).replace('.', ',')}%` : ''}`);
      el('parte-lotes').hidden = !p.lotes.length;
      el('lotes').innerHTML = p.lotes.map((l) => `<li class="linha-holerite operacao">
          <span class="quando">${diaCurto(l.data)}</span>
          <span class="nome-linha">${quantos(l.resta)} × ${formatar(Math.round(l.preco))}</span>
          <span class="valor-lancado ${l.variacao > 0 ? 'positivo' : l.variacao < 0 ? 'negativo' : ''}">${l.variacao == null ? '—' : `${l.variacao >= 0 ? '+' : ''}${(l.variacao * 100).toFixed(1).replace('.', ',')}%`}</span>
          <span></span>
        </li>`).join('');
    } else {
      el('parte-lotes').hidden = true;
    }
    if (!cotas) el('numeros').innerHTML =
      n(p.avaliacao ? `valor em ${diaCurto(p.avaliacao.data)}${p.estimado ? ' + movimentos' : ''}` : 'valor (sem informar)', `${p.estimado ? '~' : ''}${formatar(p.valorAtual)}`) +
      n('investido', formatar(p.investido)) +
      n('rendeu', `${p.rendeu >= 0 ? '+' : '−'}${formatar(Math.abs(p.rendeu))}${p.aplicado ? ` · ${(p.pct * 100).toFixed(1).replace('.', ',')}%` : ''}`);

    for (const b of el('tipos').querySelectorAll('[data-op]')) b.setAttribute('aria-pressed', String(b.dataset.op === op));
    el('rotulo-valor').textContent = op === 'avaliacao' ? 'quanto vale hoje' : 'valor';
    el('pista').textContent =
      op === 'aplicacao' ? `sai de ${dinheiro.nome}`
        : op === 'resgate' ? `volta para ${dinheiro.nome}${cotas ? ' — o preço médio não muda' : ''}`
          : op === 'provento' ? `entra em ${dinheiro.nome} — conta como rendimento, não como receita`
            : cotas ? 'o preço de uma unidade hoje; o valor é quantidade × cotação' : 'o que o banco mostra: o rendimento sai da diferença';
    el('b-op').textContent = cotas
      ? { aplicacao: 'Comprar', resgate: 'Vender', provento: 'Registrar provento', avaliacao: 'Informar cotação' }[op]
      : { aplicacao: 'Aplicar', resgate: 'Resgatar', provento: 'Registrar provento', avaliacao: 'Informar valor' }[op];

    // As operações do ativo, da mais nova para a mais antiga.
    const ops = visiveis(app)
      .filter((l) => l.ativoId === ativo.id)
      .map((l) => ({ id: l.id, data: l.dataCompetencia, tipo: l.tipo, valor: l.valor, quantidade: l.quantidade, preco: l.preco }));
    const avs = ativo.avaliacoes.map((a) => ({ id: `av:${a.data}`, data: a.data, tipo: 'avaliacao', valor: a.valor ?? a.preco, preco: a.preco }));
    const todas = [...ops, ...avs].sort((a, b) => (a.data < b.data ? 1 : -1));
    el('lista').innerHTML = todas.length
      ? todas.map((o) => `<li class="linha-holerite operacao ${o.tipo}">
          <span class="quando">${diaCurto(o.data)}</span>
          <span class="nome-linha">${nomes[o.tipo]}${o.quantidade ? ` · ${quantos(o.quantidade)} × ${formatar(o.preco ?? 0)}` : ''}</span>
          <span class="valor-lancado">${o.tipo === 'aplicacao' ? '−' : o.tipo === 'avaliacao' ? '=' : '+'} ${formatar(o.valor)}</span>
          ${o.tipo === 'avaliacao' ? '' : `<button type="button" class="elo" data-apagar-op="${o.id}">apagar</button>`}
        </li>`).join('')
      : '<li class="vazio">Nenhuma ainda. Comece pela aplicação.</li>';

    el('b-arquivar').textContent = ativo.arquivado ? 'desarquivar' : 'arquivar';
    el('b-excluir').hidden = ops.length > 0;
  }

  /** Na compra e na venda por cotas, o total que mexe na conta. */
  function pintarTotal() {
    const cotas = ativo?.unidade === 'cotas' && (op === 'aplicacao' || op === 'resgate');
    el('total').hidden = !cotas;
    if (!cotas) return;
    const q = lerQuantidade(el('quantidade').value);
    const preco = Math.abs(deTexto(el('preco').value));
    const taxas = Math.abs(deTexto(el('taxas').value));
    const bruto = Math.round(q * preco);
    const total = op === 'aplicacao' ? bruto + taxas : bruto - taxas;
    el('total').textContent = q && preco
      ? `${op === 'aplicacao' ? 'sai' : 'volta'} ${formatar(Math.max(0, total))}${taxas ? ` (${formatar(bruto)} ${op === 'aplicacao' ? '+' : '−'} ${formatar(taxas)} de taxas)` : ''}`
      : '';
  }

  async function recarregar() {
    app = await estado.calcular();
    if (ativo) ativo = app.ativos[ativo.id] ?? null;
    pintar();
  }

  async function salvarFicha() {
    const nome = el('nome').value.trim();
    if (!nome) { el('nome').focus(); return; }
    const dados = { nome, classe: el('classe').value, unidade: el('unidade').value, vencimento: el('vencimento').value || null };
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
    focarPrimeiro();
  }

  async function registrar() {
    const cotas = ativo.unidade === 'cotas';
    const data = el('data').value || hoje();
    let valor = Math.abs(deTexto(el('valor').value));
    let extra = {};
    if (cotas && (op === 'aplicacao' || op === 'resgate')) {
      const quantidade = lerQuantidade(el('quantidade').value);
      const preco = Math.abs(deTexto(el('preco').value));
      const taxas = Math.abs(deTexto(el('taxas').value));
      if (!quantidade) { recadar('Falta a quantidade.'); return; }
      if (!preco) { recadar('Falta o preço de cada.'); return; }
      if (op === 'resgate') {
        const tem = posicao(app, ativo.id).quantidade;
        if (quantidade > tem + 1e-9) { recadar(`Só há ${quantos(tem)} na mão.`); return; }
      }
      const bruto = Math.round(quantidade * preco);
      valor = op === 'aplicacao' ? bruto + taxas : bruto - taxas;
      extra = { quantidade, preco, taxas: taxas || null };
    }
    if (cotas && op === 'avaliacao') {
      const preco = Math.abs(deTexto(el('preco').value));
      if (!preco) { recadar('Falta o preço de hoje.'); return; }
      recadar('');
      await estado.aplicarEvento('ativo.avaliado', { id: ativo.id, data, preco });
      el('preco').value = '';
      await recarregar();
      if (aoSalvar) await aoSalvar();
      return;
    }
    if (!valor || valor < 0) { recadar('Falta o valor.'); return; }
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
        ...extra,
        categoriaId: null,
        dataCompetencia: data,
        dataCaixa: data,
        confirmado: data <= hoje(),
        lancadoPor: ap?.id ?? null,
      });
    }
    for (const campo of ['valor', 'quantidade', 'preco', 'taxas']) el(campo).value = '';
    await recarregar();
    if (aoSalvar) await aoSalvar();
  }

  // ── eventos ─────────────────────────────────────────────────────────────

  janela.querySelector('[data-fechar]').addEventListener('click', () => janela.close());
  el('b-ficha').addEventListener('click', salvarFicha);
  el('nome').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvarFicha(); } });
  el('b-op').addEventListener('click', registrar);
  for (const campo of ['valor', 'quantidade', 'preco', 'taxas']) {
    el(campo).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); registrar(); } });
    el(campo).addEventListener('input', pintarTotal);
  }
  // Ação, FII e cripto se acompanham por cotas; o resto, pelo valor. Só
  // sugere: a pessoa pode trocar.
  el('classe').addEventListener('change', () => {
    el('unidade').value = CLASSES_POR_COTAS.has(el('classe').value) ? 'cotas' : 'valor';
  });
  el('tipos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    op = b.dataset.op;
    recadar('');
    pintar();
    focarPrimeiro();
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
    el('unidade').value = ativo.unidade ?? 'valor';
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

  /** O primeiro campo visível da operação. */
  function focarPrimeiro() {
    for (const campo of ['quantidade', 'preco', 'valor']) {
      if (!el(`campo-${campo}`).hidden) { el(campo).focus(); return; }
    }
  }

  return {
    /** Um ativo novo dentro da conta de investimento. */
    async novo(idDaConta) {
      app = await estado.calcular();
      contaId = idDaConta;
      ativo = null;
      editandoFicha = false;
      el('nome').value = '';
      el('classe').value = 'renda_fixa';
      el('unidade').value = 'valor';
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
      for (const campo of ['valor', 'quantidade', 'preco', 'taxas']) el(campo).value = '';
      el('data').value = hoje();
      recadar('');
      pintar();
      janela.showModal();
      focarPrimeiro();
    },
  };
}
