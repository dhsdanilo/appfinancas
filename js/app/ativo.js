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
import { CLASSES, CLASSES_POR_COTAS, nomeDaClasse, posicao, contaDoDinheiro, contaDaOperacao } from '../core/investimentos.js';
import { lugarDaConta, envelopesAtivos } from '../core/envelopes.js';
import { provisaoDoCartao } from '../core/cofrinho.js';
import * as cotacoes from '../core/cotacoes.js';
import { ligarDonos, criarJanelasDeEnvelope } from './envelope.js';

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
      <p class="recado" data-ativo="aviso-unidade" hidden>Cuidado: trocar isto muda como as operações que já estão aqui são lidas
        (valor × quantidade e preço), e o valor do ativo pode sumir da tela. Voltar a escolher a forma de antes desfaz.</p>
      <label class="campo-simples"><span class="miudo">vencimento · opcional</span>
        <input type="date" data-ativo="vencimento"></label>

      <!-- Cotação automática: só ativo por cotas. O preço de fechamento entra a cada
           sincronização, como se fosse informado à mão (js/core/cotacoes.js). -->
      <div class="cotacao-ativo" data-ativo="cotacao-bloco" hidden>
        <label class="campo-simples"><span class="miudo">cotação automática</span>
          <select data-ativo="cotacao-fonte">
            <option value="">manual</option>
            <option value="b3">ação, FII ou ETF (B3)</option>
            <option value="tesouro">título do Tesouro Direto</option>
          </select></label>
        <label class="campo-simples" data-ativo="cotacao-campo-b3" hidden><span class="miudo">código</span>
          <input type="text" data-ativo="cotacao-codigo" list="ativo-codigos-b3" autocomplete="off" autocapitalize="characters" placeholder="PETR4">
          <datalist id="ativo-codigos-b3"></datalist></label>
        <label class="campo-simples" data-ativo="cotacao-campo-tesouro" hidden><span class="miudo">título</span>
          <select data-ativo="cotacao-titulo"></select></label>
        <p class="nota" data-ativo="cotacao-pista"></p>
      </div>

      <!-- Como começou: a primeira aplicação (ou compra). Se for de antes de
           a conta do dinheiro entrar no app, não sai de conta nenhuma. -->
      <div class="inicio-ativo" data-ativo="inicio">
        <p class="miudo titulo-linhas">como começou · opcional</p>
        <div class="linha-operacao">
          <label class="campo-simples"><span class="miudo" data-ativo="rotulo-inicio">aplicado em</span>
            <input type="date" data-ativo="inicio-data"></label>
          <label class="campo-simples" data-ativo="inicio-campo-valor"><span class="miudo">valor aplicado</span>
            <input type="text" inputmode="decimal" data-ativo="inicio-valor" autocomplete="off" placeholder="0,00"></label>
          <label class="campo-simples" data-ativo="inicio-campo-quantidade" hidden><span class="miudo">quantidade</span>
            <input type="text" inputmode="decimal" data-ativo="inicio-quantidade" autocomplete="off" placeholder="100"></label>
          <label class="campo-simples" data-ativo="inicio-campo-preco" hidden><span class="miudo">preço de cada</span>
            <input type="text" inputmode="decimal" data-ativo="inicio-preco" autocomplete="off" placeholder="0,00"></label>
        </div>
        <p class="nota" data-ativo="inicio-pista"></p>
      </div>
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
      <p class="sugestao-cofrinho" data-ativo="sugestao" hidden>
        <span data-ativo="texto-sugestao"></span>
        <button type="button" class="elo" data-ativo="b-sugerir">usar</button>
      </p>
      <!-- De quem é o dinheiro que sai: só quando há envelope na origem (design/11 §4). -->
      <div class="donos-saida" data-ativo="donos" hidden></div>
      <p class="recado" data-ativo="recado" hidden></p>
      <div class="acoes"><button type="button" class="principal" data-ativo="b-op">Registrar</button></div>
      <!-- O que chegou sem dono: distribuir agora, ou deixar (design/11 §3.3). -->
      <p class="recado oferta-distribuir" data-ativo="oferta" hidden>
        <span data-ativo="texto-oferta"></span>
        <button type="button" class="elo" data-ativo="b-distribuir">distribuir</button>
      </p>

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
  // A operação sendo corrigida (o id do lançamento), ou null.
  let corrigindo = null;

  const recadar = (t) => { el('recado').textContent = t; el('recado').hidden = !t; };
  const donos = ligarDonos(el('donos'));
  const envelopes = criarJanelasDeEnvelope({ aoSalvar: async () => { if (janela.open) await recarregar(); } });
  // Os donos que a operação sendo corrigida levou.
  let donosDaCorrecao = [];
  const ofertar = (t) => { el('texto-oferta').textContent = t; el('oferta').hidden = !t; };

  /** De onde sai o dinheiro da operação: a conta na aplicação, o ativo no resgate. */
  function lugarDeSaida() {
    if (op === 'aplicacao') {
      const conta = contaDaOperacao(app, app.contas[contaId], el('data').value || hoje());
      return lugarDaConta(app, conta)?.id ?? null;
    }
    return op === 'resgate' ? ativo.id : null;
  }

  function pintar() {
    const conta = app.contas[contaId];
    const dinheiro = app.contas[contaDoDinheiro(conta)];
    if (!ativo || editandoFicha) {
      document.getElementById('titulo-ativo').textContent = ativo ? 'Editar ativo' : 'Novo ativo';
      el('cabeca').textContent = `em ${conta.nome}`;
      el('ficha').hidden = false;
      el('operacoes').hidden = true;
      el('b-ficha').textContent = ativo ? 'Salvar' : 'Criar';
      el('inicio').hidden = Boolean(ativo);
      pintarInicio();
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
    const desde = p.desde
      ? n(`desde ${diaCurto(p.desde)}/${p.desde.slice(0, 4)}`, p.aoAno == null ? `${Math.max(0, Math.round(p.meses))} ${Math.round(p.meses) === 1 ? 'mês' : 'meses'}` : `≈ ${(p.aoAno * 100).toFixed(1).replace('.', ',')}% ao ano`)
      : '';
    if (cotas) el('numeros').insertAdjacentHTML('beforeend', desde);
    if (!cotas) el('numeros').innerHTML = desde +
      n(p.avaliacao ? `valor em ${diaCurto(p.avaliacao.data)}${p.estimado ? ' + movimentos' : ''}` : 'valor (sem informar)', `${p.estimado ? '~' : ''}${formatar(p.valorAtual)}`) +
      n('investido', formatar(p.investido)) +
      n('rendeu', `${p.rendeu >= 0 ? '+' : '−'}${formatar(Math.abs(p.rendeu))}${p.aplicado ? ` · ${(p.pct * 100).toFixed(1).replace('.', ',')}%` : ''}`);

    for (const b of el('tipos').querySelectorAll('[data-op]')) b.setAttribute('aria-pressed', String(b.dataset.op === op));
    const lugar = lugarDeSaida();
    donos.pintar(app, lugar, {
      doMovimento: donosDaCorrecao,
      valores: donos.lugar() === lugar && !el('donos').hidden ? donos.ler() : null,
      dia: el('data').value || hoje(),
    });
    el('rotulo-valor').textContent = op === 'avaliacao' ? 'quanto vale hoje' : 'valor';
    const antesDoApp = op !== 'avaliacao' && !contaDaOperacao(app, conta, el('data').value || hoje());
    el('pista').textContent = antesDoApp
      ? `antes de ${dinheiro.nome} entrar no app: conta para o ativo, mas não mexe em conta nenhuma`
      : op === 'aplicacao' ? `sai de ${dinheiro.nome}`
        : op === 'resgate' ? `volta para ${dinheiro.nome}${cotas ? ' — o preço médio não muda' : ''}`
          : op === 'provento' ? `entra em ${dinheiro.nome} — conta como rendimento, não como receita`
            : cotas ? 'o preço de uma unidade hoje; o valor é quantidade × cotação' : 'o que o banco mostra: o rendimento sai da diferença';
    pintarSugestao();
    el('b-op').textContent = corrigindo
      ? 'Salvar correção'
      : cotas
        ? { aplicacao: 'Comprar', resgate: 'Vender', provento: 'Registrar provento', avaliacao: 'Informar cotação' }[op]
        : { aplicacao: 'Aplicar', resgate: 'Resgatar', provento: 'Registrar provento', avaliacao: 'Informar valor' }[op];
    el('tipos').hidden = Boolean(corrigindo);

    // As operações do ativo, da mais nova para a mais antiga.
    const ops = visiveis(app)
      .filter((l) => l.ativoId === ativo.id)
      .map((l) => ({ id: l.id, data: l.dataCompetencia, tipo: l.tipo, valor: l.valor, quantidade: l.quantidade, preco: l.preco, semConta: !l.contaId }));
    const avs = ativo.avaliacoes.map((a) => ({ id: `av:${a.data}`, data: a.data, tipo: 'avaliacao', valor: a.valor ?? a.preco, preco: a.preco }));
    const todas = [...ops, ...avs].sort((a, b) => (a.data < b.data ? 1 : -1));
    el('lista').innerHTML = todas.length
      ? todas.map((o) => `<li class="linha-holerite operacao ${o.tipo}">
          <span class="quando">${diaCurto(o.data)}</span>
          <span class="nome-linha">${nomes[o.tipo]}${o.quantidade ? ` · ${quantos(o.quantidade)} × ${formatar(o.preco ?? 0)}` : ''}</span>
          <span class="valor-lancado">${o.tipo === 'aplicacao' ? '−' : o.tipo === 'avaliacao' ? '=' : '+'} ${formatar(o.valor)}</span>
          ${o.tipo === 'avaliacao' ? '<span></span>' : `<span class="acoes-op">
            <button type="button" class="elo ${o.semConta ? 'antes-do-app' : ''}" data-alternar-conta="${o.id}" title="${o.semConta ? 'Não mexe em conta nenhuma: foi antes de a conta entrar no app. Tocar faz mexer.' : 'Mexe na conta. Tocar marca como de antes do app.'}">${o.semConta ? 'antes do app' : 'mexe na conta'}</button>
            <button type="button" class="elo" data-corrigir-op="${o.id}">corrigir</button>
            <button type="button" class="elo" data-apagar-op="${o.id}">apagar</button>
          </span>`}
        </li>`).join('')
      : '<li class="vazio">Nenhuma ainda. Comece pela aplicação.</li>';

    el('b-arquivar').textContent = ativo.arquivado ? 'desarquivar' : 'arquivar';
    el('b-excluir').hidden = ops.length > 0;
  }

  /** Aplicar no cofrinho de um cartão: quanto falta para cobrir o limite usado. */
  let sugerido = 0;
  function pintarSugestao() {
    sugerido = 0;
    const cartao = ativo && op === 'aplicacao' && !corrigindo && ativo.unidade !== 'cotas'
      ? Object.values(app.contas).find((c) => c.tipo === 'cartao' && c.cofrinhoAtivoId === ativo.id)
      : null;
    const p = cartao ? provisaoDoCartao(app, cartao.id) : null;
    if (p && p.falta > 0) {
      sugerido = p.falta;
      el('texto-sugestao').textContent = `Faltam ${formatar(p.falta)} para cobrir ${cartao.nome} (${formatar(p.provisionado)} de ${formatar(p.alvo)}).`;
    }
    el('sugestao').hidden = !sugerido;
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
    const dados = { nome, classe: el('classe').value, unidade: el('unidade').value, vencimento: el('vencimento').value || null, cotacao: lerCotacao() };
    if (ativo) {
      await estado.aplicarEvento('ativo.alterado', { id: ativo.id, ...dados });
    } else {
      const inicio = lerInicio(dados.unidade);
      if (inicio.erro) { el('inicio-pista').textContent = inicio.erro; return; }
      const id = novoId('atv');
      await estado.aplicarEvento('ativo.criado', { id, contaId, ...dados });
      ativo = { id };
      if (inicio.valor) {
        const ap = await log.aparelho();
        await estado.aplicarEvento('lancamento.registrado', {
          id: novoId('lan'),
          tipo: 'aplicacao',
          valor: inicio.valor,
          contaId: contaDaOperacao(app, app.contas[contaId], inicio.data),
          ativoId: id,
          ...inicio.extra,
          categoriaId: null,
          dataCompetencia: inicio.data,
          dataCaixa: inicio.data,
          confirmado: inicio.data <= hoje(),
          lancadoPor: ap?.id ?? null,
        });
      }
    }
    editandoFicha = false;
    // Vinculou (ou trocou o papel): já busca o histórico, sem esperar a sincronização.
    if (dados.cotacao) await cotacoes.atualizar({ forcar: true }).catch(() => {});
    await recarregar();
    if (aoSalvar) await aoSalvar();
    focarPrimeiro();
  }

  /** O vínculo escolhido na ficha: { fonte, chave } ou null (manual). */
  function lerCotacao() {
    const fonte = el('cotacao-fonte').value;
    if (fonte === 'b3') {
      const chave = el('cotacao-codigo').value.trim().toUpperCase();
      return chave ? { fonte, chave } : null;
    }
    if (fonte === 'tesouro') {
      const chave = el('cotacao-titulo').value;
      return chave ? { fonte, chave } : null;
    }
    return null;
  }

  /** Trocar "acompanhar" num ativo com operações muda como elas são lidas. */
  function avisarTrocaDeUnidade() {
    const mudou = ativo && el('unidade').value !== (ativo.unidade ?? 'valor');
    const temOperacoes = ativo && visiveis(app).some((l) => l.ativoId === ativo.id);
    el('aviso-unidade').hidden = !(mudou && temOperacoes);
  }

  /** Põe na ficha o vínculo que o ativo tem (ou nenhum) e a pinta. */
  function porCotacaoNaFicha(vinculo) {
    el('cotacao-fonte').value = vinculo?.fonte ?? '';
    el('cotacao-codigo').value = vinculo?.fonte === 'b3' ? vinculo.chave : '';
    // O select do Tesouro enche quando as cotações chegam; o valor espera.
    el('cotacao-titulo').innerHTML = vinculo?.fonte === 'tesouro'
      ? `<option value="${vinculo.chave}">${vinculo.chave.replace('|', ' ')}</option>`
      : '';
    pintarCotacao();
  }

  /** Mostra ou esconde o bloco da cotação e diz o que o vínculo acha. */
  async function pintarCotacao() {
    el('cotacao-bloco').hidden = false;
    const fonte = el('cotacao-fonte').value;
    el('cotacao-campo-b3').hidden = fonte !== 'b3';
    el('cotacao-campo-tesouro').hidden = fonte !== 'tesouro';
    const pista = el('cotacao-pista');
    if (!fonte) {
      pista.textContent = 'Manual: o valor é o que você informar.';
      return;
    }
    const cot = await cotacoes.carregar();
    if (!cot) {
      pista.textContent = 'Sem as cotações agora (sem conexão?). O vínculo vale quando elas chegarem.';
      return;
    }
    if (fonte === 'b3') {
      const lista = el('cotacao-codigo').parentElement.querySelector('datalist');
      if (!lista.children.length) lista.innerHTML = cotacoes.codigosDaB3(cot).map((c) => `<option value="${c}">`).join('');
    } else {
      const sel = el('cotacao-titulo');
      const antes = sel.value;
      sel.innerHTML = '<option value="">escolha o título</option>' +
        cotacoes.titulosDoTesouro(cot).map((t) => `<option value="${t.chave}">${t.nome}</option>`).join('');
      sel.value = antes;
    }
    const v = lerCotacao();
    const ultimo = v ? cotacoes.ultimoPreco(cot, v) : null;
    const porValor = el('unidade').value !== 'cotas';
    pista.textContent = !v
      ? 'Escolha o papel: o preço de fechamento entra a cada sincronização.'
      : ultimo
        ? `${formatar(ultimo.preco)} em ${diaCurto(ultimo.data)}. ${porValor ? 'O valor que você já tem passa a acompanhar a variação do preço a cada sincronização.' : 'O preço entra a cada sincronização.'}`
        : 'Não achei esse papel nas cotações.';
  }

  /** "Como começou": data e valor (ou quantidade e preço). Tudo vazio vale. */
  function lerInicio(unidade) {
    const data = el('inicio-data').value;
    if (unidade === 'cotas') {
      const quantidade = lerQuantidade(el('inicio-quantidade').value);
      const preco = Math.abs(deTexto(el('inicio-preco').value));
      if (!quantidade && !preco) return {};
      if (!quantidade || !preco || !data) return { erro: 'Para registrar como começou: data, quantidade e preço.' };
      return { data, valor: Math.round(quantidade * preco), extra: { quantidade, preco } };
    }
    const valor = Math.abs(deTexto(el('inicio-valor').value));
    if (!valor) return {};
    if (!data) return { erro: 'Falta a data em que foi aplicado.' };
    return { data, valor, extra: {} };
  }

  /** O "como começou" acompanha o jeito de acompanhar, e avisa se é de antes do app. */
  function pintarInicio() {
    const cotas = el('unidade').value === 'cotas';
    el('rotulo-inicio').textContent = cotas ? 'comprado em' : 'aplicado em';
    el('inicio-campo-valor').hidden = cotas;
    el('inicio-campo-quantidade').hidden = !cotas;
    el('inicio-campo-preco').hidden = !cotas;
    const data = el('inicio-data').value;
    const conta = app?.contas[contaId];
    if (!data || !conta) { el('inicio-pista').textContent = 'Já existia antes? Informe quando começou e quanto foi: o app mostra quanto rendeu no período.'; return; }
    const dinheiro = app.contas[contaDoDinheiro(conta)];
    el('inicio-pista').textContent = contaDaOperacao(app, conta, data)
      ? `Sai de ${dinheiro.nome} em ${diaCurto(data)}.`
      : `De antes de ${dinheiro.nome} entrar no app: conta para o ativo, mas não mexe em conta nenhuma.`;
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
      if (op === 'resgate' && !corrigindo) {
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
    const deQuem = op === 'aplicacao' || op === 'resgate' ? donos.ler() : [];
    const recusa = deQuem.length ? donos.conferir(valor) : '';
    if (recusa) { recadar(recusa); return; }
    recadar('');
    ofertar('');
    if (op === 'avaliacao') {
      await estado.aplicarEvento('ativo.avaliado', { id: ativo.id, data, valor });
    } else {
      const conta = app.contas[contaId];
      const ap = await log.aparelho();
      if (corrigindo) {
        // A conta segue a data: corrigida para antes do app, deixa de mexer.
        await estado.aplicarEvento('lancamento.alterado', {
          id: corrigindo,
          valor,
          ...extra,
          contaId: contaDaOperacao(app, conta, data),
          donos: deQuem,
          dataCompetencia: data,
          dataCaixa: data,
          confirmado: data <= hoje(),
        });
        corrigindo = null;
        donosDaCorrecao = [];
        for (const campo of ['valor', 'quantidade', 'preco', 'taxas']) el(campo).value = '';
        await recarregar();
        if (aoSalvar) await aoSalvar();
        return;
      }
      await estado.aplicarEvento('lancamento.registrado', {
        id: novoId('lan'),
        tipo: op,
        valor,
        contaId: contaDaOperacao(app, conta, data),
        ativoId: ativo.id,
        ...extra,
        donos: deQuem,
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
    // Chegou dinheiro sem dono num ativo, e há envelopes: oferece distribuir
    // ali mesmo. Ignorar é deixar sem dono (design/11 §3.3).
    const semDono = valor - deQuem.reduce((t, d) => t + d.valor, 0);
    const inteiro = envelopesAtivos(app).some((v) => (v.inteiros ?? []).includes(ativo.id));
    if (op === 'aplicacao' && data <= hoje() && semDono > 0 && !inteiro && envelopesAtivos(app).length) {
      ofertar(`${formatar(semDono)} chegaram sem dono em ${ativo.nome}.`);
    }
  }

  // ── eventos ─────────────────────────────────────────────────────────────

  janela.querySelector('[data-fechar]').addEventListener('click', () => janela.close());
  el('b-ficha').addEventListener('click', salvarFicha);
  el('nome').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvarFicha(); } });
  el('b-op').addEventListener('click', registrar);
  el('b-sugerir').addEventListener('click', () => {
    if (!sugerido) return;
    el('valor').value = formatar(sugerido, { comPrefixo: false });
    el('sugestao').hidden = true;
  });
  for (const campo of ['valor', 'quantidade', 'preco', 'taxas']) {
    el(campo).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); registrar(); } });
    el(campo).addEventListener('input', pintarTotal);
  }
  // Ação, FII e cripto se acompanham por cotas; o resto, pelo valor. Só
  // sugere: a pessoa pode trocar.
  el('classe').addEventListener('change', () => {
    // Num ativo que já existe, a classe não mexe em como ele é acompanhado:
    // trocar isso muda a leitura das operações (valor × quantidade).
    if (!ativo) el('unidade').value = CLASSES_POR_COTAS.has(el('classe').value) ? 'cotas' : 'valor';
    pintarInicio();
    pintarCotacao();
  });
  el('unidade').addEventListener('change', () => {
    pintarInicio();
    pintarCotacao();
    avisarTrocaDeUnidade();
  });
  el('cotacao-fonte').addEventListener('change', pintarCotacao);
  el('cotacao-codigo').addEventListener('input', pintarCotacao);
  el('cotacao-titulo').addEventListener('change', pintarCotacao);
  el('inicio-data').addEventListener('input', pintarInicio);
  el('data').addEventListener('input', () => { if (ativo && !editandoFicha) pintar(); });
  el('tipos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    op = b.dataset.op;
    corrigindo = null;
    donosDaCorrecao = [];
    recadar('');
    ofertar('');
    pintar();
    focarPrimeiro();
  });
  el('lista').addEventListener('click', async (e) => {
    const alternar = e.target.closest('[data-alternar-conta]');
    if (alternar) {
      const l = app.lancamentos[alternar.dataset.alternarConta];
      if (!l) return;
      const conta = app.contas[contaId];
      await estado.aplicarEvento('lancamento.alterado', { id: l.id, contaId: l.contaId ? null : contaDoDinheiro(conta) });
      await recarregar();
      if (aoSalvar) await aoSalvar();
      return;
    }
    const corrigir = e.target.closest('[data-corrigir-op]');
    if (corrigir) {
      const l = app.lancamentos[corrigir.dataset.corrigirOp];
      if (!l) return;
      corrigindo = l.id;
      op = l.tipo;
      donosDaCorrecao = l.donos ?? [];
      el('donos').hidden = true;
      ofertar('');
      el('data').value = l.dataCompetencia;
      el('valor').value = formatar(l.valor, { comPrefixo: false });
      el('quantidade').value = l.quantidade ? String(l.quantidade).replace('.', ',') : '';
      el('preco').value = l.preco ? formatar(l.preco, { comPrefixo: false }) : '';
      el('taxas').value = l.taxas ? formatar(l.taxas, { comPrefixo: false }) : '';
      recadar('');
      pintar();
      el('data').focus();
      return;
    }
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
  el('b-distribuir').addEventListener('click', async () => {
    ofertar('');
    await envelopes.abrirDistribuir(ativo.id);
  });
  el('b-editar').addEventListener('click', () => {
    editandoFicha = true;
    el('nome').value = ativo.nome;
    el('classe').value = ativo.classe;
    el('unidade').value = ativo.unidade ?? 'valor';
    el('vencimento').value = ativo.vencimento ?? '';
    porCotacaoNaFicha(ativo.cotacao);
    avisarTrocaDeUnidade();
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
      for (const campo of ['inicio-data', 'inicio-valor', 'inicio-quantidade', 'inicio-preco']) el(campo).value = '';
      el('data').value = hoje();
      corrigindo = null;
      el('vencimento').value = '';
      porCotacaoNaFicha(null);
      el('aviso-unidade').hidden = true;
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
      corrigindo = null;
      donosDaCorrecao = [];
      el('donos').hidden = true;
      ofertar('');
      for (const campo of ['valor', 'quantidade', 'preco', 'taxas']) el(campo).value = '';
      el('data').value = hoje();
      recadar('');
      pintar();
      janela.showModal();
      focarPrimeiro();
    },
  };
}
