// O formulário de captura, em um lugar só.
//
// Ele aparece de duas formas (design/03-alimentacao.md §1):
//   celular — o térreo, tela inteira, é onde o app abre (D11)
//   PC      — um diálogo por cima da tela atual, com "salvar e nova"
//
// Duas formas, um comportamento. Se fossem dois arquivos, divergiriam no
// terceiro ajuste.
//
// E é ele também que CORRIGE um lançamento que já existe (§9): mesmo formulário,
// outro título, outras ações. Editar é o mesmo ato de lançar, feito depois — e é
// só no modo correção que aparecem as etiquetas, porque etiquetar é refino, não
// captura (§2): ninguém pensa em "de qual objeto é isso" na fila do mercado.

import { valorLancavel, formatar } from '../core/dinheiro.js';
import { novoId } from '../core/id.js';
import * as log from '../core/log.js';
import * as estado from '../core/estado.js';
import {
  hoje, nasceConfirmado, nomeDaCategoria, correcao, detalhesDaCategoria,
} from '../core/lancamentos.js';
import { MARCACAO_CAMPO_VALOR, ligarCampoValor } from './campo-valor.js';
import { ligarZonaDePerigo } from './zona-perigo.js';

const MARCACAO = `
  ${MARCACAO_CAMPO_VALOR}

  <div class="contexto">
    <div class="pilulas" role="group" aria-label="Tipo de lançamento">
      <button type="button" data-tipo="despesa" aria-pressed="true">despesa</button>
      <button type="button" data-tipo="receita" aria-pressed="false">receita</button>
    </div>
    <div class="quando">
      <button type="button" class="passo" data-papel="dia-menos" aria-label="Um dia antes">−</button>
      <button type="button" class="elo" data-papel="data" aria-label="Escolher a data no calendário">hoje</button>
      <button type="button" class="passo" data-papel="dia-mais" aria-label="Um dia depois">+</button>
      <input type="date" class="data-exata" data-papel="data-exata" aria-label="Data do lançamento" tabindex="-1">
    </div>
  </div>

  <p class="recado" data-papel="recado" hidden></p>

  <div class="categorias" data-papel="categorias" role="group" aria-label="Categoria"></div>

  <div class="linha-conta">
    <label class="escolha-conta">
      <span class="miudo">conta</span>
      <select data-papel="conta" aria-label="Conta do lançamento"></select>
    </label>
    <button type="button" class="elo" data-papel="b-detalhe">+ detalhe</button>
  </div>

  <div class="detalhes" data-papel="detalhes" hidden>
    <span class="rotulo-etiquetas">detalhe</span>
    <div class="chips" data-papel="chips-detalhe" role="group" aria-label="Detalhe"></div>
    <input type="text" class="nova-etiqueta" data-papel="novo-detalhe" autocomplete="off"
           placeholder="qual?" aria-label="Qual, dentro desta categoria">
  </div>

  <div class="etiquetas" data-papel="etiquetas" hidden>
    <span class="rotulo-etiquetas">etiquetas</span>
    <div class="chips" data-papel="chips" role="group" aria-label="Etiquetas aplicadas"></div>
    <div class="busca">
      <input type="text" class="nova-etiqueta" data-papel="nova-etiqueta" autocomplete="off"
             placeholder="digite para achar ou criar" aria-label="Procurar ou criar etiqueta"
             role="combobox" aria-expanded="false" aria-autocomplete="list">
      <ul class="sugestoes" data-papel="sugestoes" role="listbox" hidden></ul>
    </div>
    <button type="button" class="elo" data-papel="b-todas">ver todas</button>
    <div class="chips todas" data-papel="todas" role="group" aria-label="Todas as etiquetas" hidden></div>
  </div>

  <p class="desfazer" data-papel="desfazer" hidden></p>

  <div class="acoes" data-papel="acoes"></div>

  <p class="zona-perigo" data-papel="perigo" hidden></p>
`;

/**
 * @param {object} opcoes
 * @param {HTMLElement} opcoes.raiz      onde o formulário é montado
 * @param {Array}  opcoes.acoes          [{ id, rotulo, principal, fecha }]
 * @param {Function} [opcoes.aoSalvar]   chamado depois de cada mudança gravada
 * @param {Function} [opcoes.aoFechar]   chamado quando uma ação pede pra fechar
 */
export async function criarFormulario({ raiz, acoes, aoSalvar, aoFechar, comEtiquetas = false }) {
  raiz.innerHTML = MARCACAO;
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);

  // O datalist só funciona por id, e há dois formulários na mesma página — então
  // o id nasce aqui, único por instância, em vez de vir escrito na marcação.
  const idSugestoes = `etiquetas-${Math.random().toString(36).slice(2, 8)}`;
  el('sugestoes').id = idSugestoes;
  el('nova-etiqueta').setAttribute('list', idSugestoes);

  let app = null;
  let categoriaId = null;
  let contaId = null;
  let tipo = 'despesa';
  let data = hoje();
  let etiquetas = [];
  let detalheId = null;
  let detalheAberto = false;
  let todasAbertas = false;
  let realcada = 0;
  let ultimo = null;
  let sumir = null;
  // O lançamento que está sendo corrigido, ou null — é só isso que separa as
  // duas vidas deste formulário.
  let editando = null;

  // ── valor ───────────────────────────────────────────────────────────────

  const valor = ligarCampoValor(raiz, {
    aoMudar: () => {
      for (const b of raiz.querySelectorAll('[data-acao]')) b.disabled = !pronto();
    },
    aoConfirmar: async (e) => {
      if (!pronto()) { valor.desfocar(); return; }
      // Na correção não existe "e abre a próxima": Enter salva e fecha.
      const fecha = Boolean(editando) || e.ctrlKey || e.metaKey;
      const salvou = await salvar();
      if (salvou && fecha && aoFechar) aoFechar();
    },
  });

  const pronto = () => valorLancavel(valor.centavos()) && categoriaId && contaId;

  // ── listas ──────────────────────────────────────────────────────────────

  /**
   * As mais usadas por VOCÊ, aprendidas e não configuradas (04-categorias §4).
   * Sem histórico, valem as criadas mais recentemente: a tela não pode nascer
   * vazia justo quando o app precisa provar que serve.
   */
  function maisUsadas(limite = 8) {
    const usos = new Map();
    for (const l of Object.values(app.lancamentos)) {
      if (l.removido || !l.categoriaId) continue;
      usos.set(l.categoriaId, (usos.get(l.categoriaId) || 0) + 1);
    }
    const ehGrupo = (c) => Object.values(app.categorias).some((o) => o.pai === c.id);
    return Object.values(app.categorias)
      .filter((c) => !c.arquivada && c.natureza === tipo && !ehGrupo(c))
      .sort((a, b) => (usos.get(b.id) || 0) - (usos.get(a.id) || 0) || (a.nome < b.nome ? -1 : 1))
      .slice(0, limite);
  }

  function pintarCategorias() {
    const lista = maisUsadas();
    // A categoria de um lançamento antigo pode não estar mais entre as mais
    // usadas, e ela precisa aparecer marcada: edição que não mostra o que está
    // lá parece ter perdido o dado.
    if (categoriaId && app.categorias[categoriaId] && !lista.some((c) => c.id === categoriaId)) {
      lista.push(app.categorias[categoriaId]);
    }
    el('categorias').innerHTML = lista.length
      ? lista
          .map(
            (c) =>
              `<button type="button" data-id="${c.id}" aria-pressed="${c.id === categoriaId}">${escapar(c.nome)}</button>`
          )
          .join('')
      : `<p class="vazio">Nenhuma categoria de ${tipo}. Crie na <a href="bancada.html">bancada</a>.</p>`;
  }

  /**
   * Todas as contas que não estão arquivadas. Folha, dívida e investimento
   * entram porque a vida passa por elas — e enquanto o mecanismo próprio do
   * holerite (D25) não existe, é por aqui que o desconto da folha é lançado.
   * Esconder conta que o dono criou é decidir por ele.
   */
  const contasUtilizaveis = () => Object.values(app.contas).filter((c) => !c.arquivada);

  function pintarConta() {
    const contas = contasUtilizaveis();
    el('conta').innerHTML = contas.length
      ? contas
          .map(
            (c) =>
              `<option value="${escapar(c.id)}"${c.id === contaId ? ' selected' : ''}>${escapar(c.nome)}</option>`
          )
          .join('')
      : '<option value="">nenhuma conta</option>';
  }

  /**
   * Um dia pra trás, um dia pra frente, ou o calendário. Quem lança a pilha de
   * notas da semana anda de um em um; quem conserta um lançamento de duas
   * semanas atrás escolhe o dia. Os dois caminhos no mesmo controle.
   */
  function pintarData() {
    el('data').textContent = rotuloDoDia(data);
    el('data-exata').value = data;

    // O marco zero da conta é o saldo que você conferiu: lançamento antes dele
    // mexeria num saldo que não é seu (04-categorias §5).
    const piso = pisoDaConta();
    el('data-exata').min = piso ?? '';
    el('dia-menos').disabled = Boolean(piso) && data <= piso;
  }

  function rotuloDoDia(dia) {
    if (dia === hoje()) return 'hoje';
    if (dia === somarDias(hoje(), -1)) return 'ontem';
    if (dia === somarDias(hoje(), 1)) return 'amanhã';
    const [ano, mes, d] = dia.split('-');
    return ano === hoje().slice(0, 4) ? `${d}/${mes}` : `${d}/${mes}/${ano}`;
  }

  const pisoDaConta = () => app.contas[contaId]?.dataInicial ?? null;

  function somarDias(dia, quantos) {
    const d = new Date(dia + 'T12:00:00');
    d.setDate(d.getDate() + quantos);
    return d.toISOString().slice(0, 10);
  }

  function irPara(novoDia) {
    const piso = pisoDaConta();
    if (piso && novoDia < piso) {
      const conta = app.contas[contaId];
      return recadar(
        `${conta.nome} começou em ${rotuloDoDia(piso)}: antes disso o saldo não é seu.`
      );
    }
    data = novoDia;
    recadar('');
    pintarData();
  }

  function recadar(texto) {
    el('recado').textContent = texto;
    el('recado').hidden = !texto;
  }

  function pintarTipo() {
    for (const b of raiz.querySelectorAll('[data-tipo]')) {
      b.setAttribute('aria-pressed', String(b.dataset.tipo === tipo));
    }
  }

  // ── etiquetas (só no refino) ────────────────────────────────────────────
  //
  // A etiqueta responde "de quem/do que é" e atravessa categorias: combustível
  // e seguro são categorias diferentes e os dois são do carro (04 §3). Por isso
  // ela é múltipla, opcional, e não aparece na captura.

  function pintarEtiquetas() {
    // No térreo, não: etiquetar é refino, e ninguém pensa em "de qual objeto é
    // isso" na fila do mercado (03-alimentacao §2). No PC, onde se lança
    // sentado, a etiqueta cabe já na captura.
    const mostrar = Boolean(editando) || comEtiquetas;
    el('etiquetas').hidden = !mostrar;
    if (!mostrar) return;

    // Só as APLICADAS ficam à vista, com o × de tirar. A lista inteira cresce
    // pra dezenas com o uso; mostrá-la sempre seria uma parede de fichas.
    el('chips').innerHTML = etiquetas
      .map((id) => app.etiquetas[id])
      .filter(Boolean)
      .map(
        (t) =>
          `<button type="button" data-etiqueta="${escapar(t.id)}" aria-pressed="true">${escapar(t.nome)}<span class="tirar" aria-hidden="true">×</span></button>`
      )
      .join('');

    el('b-todas').textContent = todasAbertas ? 'esconder' : 'ver todas';
    el('todas').hidden = !todasAbertas;
    if (todasAbertas) {
      const todas = Object.values(app.etiquetas ?? {})
        .filter((t) => !t.arquivada || etiquetas.includes(t.id))
        .sort((a, b) => (a.nome.toLocaleLowerCase('pt-BR') < b.nome.toLocaleLowerCase('pt-BR') ? -1 : 1));
      el('todas').innerHTML = todas.length
        ? todas
            .map(
              (t) =>
                `<button type="button" data-etiqueta="${escapar(t.id)}" aria-pressed="${etiquetas.includes(t.id)}">${escapar(t.nome)}</button>`
            )
            .join('')
        : '<span class="vazio">nenhuma etiqueta ainda</span>';
    }
  }

  /**
   * A busca: digitou, o app oferece o que já existe. Começo da palavra primeiro,
   * depois o meio — é a ordem em que a cabeça procura.
   */
  function sugerir() {
    const texto = el('nova-etiqueta').value.trim();
    const chave = texto.toLocaleLowerCase('pt-BR');
    const lista = el('sugestoes');

    if (!chave) {
      lista.hidden = true;
      lista.innerHTML = '';
      el('nova-etiqueta').setAttribute('aria-expanded', 'false');
      return;
    }

    const candidatas = Object.values(app.etiquetas ?? {})
      .filter((t) => !t.arquivada && !etiquetas.includes(t.id))
      .map((t) => ({ t, onde: t.nome.toLocaleLowerCase('pt-BR').indexOf(chave) }))
      .filter((x) => x.onde >= 0)
      .sort((a, b) => a.onde - b.onde || (a.t.nome < b.t.nome ? -1 : 1))
      .slice(0, 6)
      .map((x) => x.t);

    const exata = candidatas.some((t) => t.nome.toLocaleLowerCase('pt-BR') === chave);
    const jaAplicada = etiquetas.some(
      (id) => app.etiquetas[id]?.nome.toLocaleLowerCase('pt-BR') === chave
    );

    realcada = Math.min(realcada, candidatas.length);
    lista.innerHTML =
      candidatas
        .map(
          (t, i) =>
            `<li role="option" aria-selected="${i === realcada}" class="${i === realcada ? 'realcada' : ''}" data-etiqueta="${escapar(t.id)}">${escapar(t.nome)}</li>`
        )
        .join('') +
      (exata || jaAplicada
        ? ''
        : `<li role="option" aria-selected="${realcada === candidatas.length}" class="criar ${realcada === candidatas.length ? 'realcada' : ''}" data-criar="1">criar “${escapar(texto)}”</li>`);

    lista.hidden = !lista.innerHTML;
    el('nova-etiqueta').setAttribute('aria-expanded', String(!lista.hidden));
  }

  function fecharSugestoes() {
    el('sugestoes').hidden = true;
    el('sugestoes').innerHTML = '';
    realcada = 0;
    el('nova-etiqueta').setAttribute('aria-expanded', 'false');
  }

  function aplicarEtiqueta(id) {
    if (!etiquetas.includes(id)) etiquetas.push(id);
    el('nova-etiqueta').value = '';
    fecharSugestoes();
    pintarEtiquetas();
  }

  /** Digitar um nome novo cria a etiqueta e já aplica (03-alimentacao §10). */
  async function acrescentarEtiqueta(texto) {
    const nome = texto.trim();
    if (!nome) return;
    const chave = nome.toLocaleLowerCase('pt-BR');
    let etiqueta = Object.values(app.etiquetas ?? {}).find(
      (t) => t.nome.toLocaleLowerCase('pt-BR') === chave
    );
    if (!etiqueta) {
      const id = novoId('etq');
      await estado.aplicarEvento('etiqueta.criada', { id, nome });
      app = await estado.calcular();
      etiqueta = app.etiquetas[id];
    }
    aplicarEtiqueta(etiqueta.id);
  }

  // ── detalhe ─────────────────────────────────────────────────────────────
  //
  // O que distingue um lançamento dos outros da MESMA categoria: em
  // supermercado é o mercado; em manutenção, o serviço. A lista vem escopada
  // pela categoria e ordenada pelo mais usado (E3) — depois de duas semanas,
  // é um toque na primeira opção.

  function pintarDetalhes() {
    el('detalhes').hidden = !detalheAberto;
    el('b-detalhe').textContent = nomeDoDetalhe() ?? '+ detalhe';
    if (!detalheAberto) return;

    const sugeridos = detalhesDaCategoria(app, categoriaId);
    if (detalheId && app.detalhes[detalheId] && !sugeridos.some((d) => d.id === detalheId)) {
      sugeridos.unshift(app.detalhes[detalheId]);
    }

    el('chips-detalhe').innerHTML = sugeridos.length
      ? sugeridos
          .map(
            (d) =>
              `<button type="button" data-detalhe="${escapar(d.id)}" aria-pressed="${d.id === detalheId}">${escapar(d.nome)}</button>`
          )
          .join('')
      : '<span class="vazio">digite o primeiro ao lado</span>';
  }

  const nomeDoDetalhe = () => (detalheId ? app.detalhes[detalheId]?.nome : null);

  /** Nome novo cria o detalhe e já aplica (03-alimentacao §10). */
  async function escolherDetalhe(texto) {
    const nome = texto.trim();
    if (!nome) return;
    const chave = nome.toLocaleLowerCase('pt-BR');
    let detalhe = Object.values(app.detalhes ?? {}).find(
      (d) => d.nome.toLocaleLowerCase('pt-BR') === chave
    );
    if (!detalhe) {
      const id = novoId('det');
      await estado.aplicarEvento('detalhe.criado', { id, nome });
      app = await estado.calcular();
      detalhe = app.detalhes[id];
    }
    detalheId = detalhe.id;
    pintarDetalhes();
  }

  // ── apagar ──────────────────────────────────────────────────────────────

  const perigo = ligarZonaDePerigo(el('perigo'), {
    descricao: () =>
      `${formatar(editando.valor)} · ${nomeDaCategoria(app, editando.categoriaId) || editando.tipo}`,
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

  /**
   * Corrigir grava um evento NOVO com só o que mudou — nada reescreve o
   * passado (design/02 §2). Quem e quando vêm de graça no próprio evento.
   */
  async function salvarCorrecao() {
    const mudancas = correcao(editando, {
      valor: valor.centavos(),
      tipo,
      categoriaId,
      contaId,
      detalheId,
      etiquetas: [...etiquetas],
      dataCaixa: data,
    });

    // Abriu, olhou e fechou: não existe evento "salvou igual".
    if (Object.keys(mudancas).length === 0) return true;

    await estado.aplicarEvento('lancamento.alterado', { id: editando.id, ...mudancas });
    await recarregar();
    editando = app.lancamentos[editando.id] ?? editando;
    if (aoSalvar) await aoSalvar();
    return true;
  }

  async function registrar() {
    const ap = await log.aparelho();
    const id = novoId('lan');
    const resumo = `${formatar(valor.centavos())} · ${nomeDaCategoria(app, categoriaId)}`;

    await estado.aplicarEvento('lancamento.registrado', {
      id,
      tipo,
      valor: valor.centavos(),
      dataCompetencia: data,
      dataCaixa: data,
      contaId,
      categoriaId,
      detalheId,
      etiquetas: [...etiquetas],
      // Não é escolha de ninguém: vem da origem e da data (D2).
      confirmado: nasceConfirmado({ manual: true, dataCaixa: data }),
      lancadoPor: ap?.id ?? null,
    });

    ultimo = { id, resumo };
    await recarregar();

    // "Salvar e nova" preserva tudo e zera só o valor: é o que torna cinco
    // compras do mesmo mercado cinco digitações em vez de cinco formulários.
    valor.limpar();
    mostrarDesfazer();
    if (aoSalvar) await aoSalvar();
    return true;
  }

  function mostrarDesfazer() {
    const faixa = el('desfazer');
    faixa.innerHTML = `<span>salvo · ${escapar(ultimo.resumo)}</span><button type="button" data-papel="b-desfazer">desfazer</button>`;
    faixa.hidden = false;
    faixa.querySelector('[data-papel="b-desfazer"]').addEventListener('click', async () => {
      await estado.aplicarEvento('lancamento.removido', { id: ultimo.id });
      faixa.hidden = true;
      await recarregar();
      if (aoSalvar) await aoSalvar();
    });
    clearTimeout(sumir);
    sumir = setTimeout(() => { faixa.hidden = true; }, 8000);
  }

  // ── ações ───────────────────────────────────────────────────────────────

  el('acoes').innerHTML = acoes
    .map(
      (a) =>
        `<button type="button" data-acao="${a.id}" class="${a.principal ? 'principal' : ''}" disabled>${escapar(a.rotulo)}</button>`
    )
    .join('');

  el('acoes').addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const acao = acoes.find((a) => a.id === botao.dataset.acao);
    const salvou = await salvar();
    if (salvou && acao.fecha && aoFechar) aoFechar();
    if (!acao.fecha) valor.focar();
  });

  // ── eventos ─────────────────────────────────────────────────────────────

  el('categorias').addEventListener('click', (e) => {
    const botao = e.target.closest('button[data-id]');
    if (!botao) return;
    categoriaId = botao.dataset.id === categoriaId ? null : botao.dataset.id;
    for (const b of el('categorias').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.id === categoriaId));
    }
    // O detalhe é escopado pela categoria: trocar de categoria recomeça a lista.
    detalheId = null;
    pintarDetalhes();
    // Tocar na categoria fecha o teclado do celular — e é esse toque que revela
    // o botão de lançar, sem precisar de um passo só pra dispensar.
    valor.desfocar();
    valor.pintar();
  });

  el('chips').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-etiqueta]');
    if (!botao) return;
    const id = botao.dataset.etiqueta;
    etiquetas = etiquetas.includes(id) ? etiquetas.filter((t) => t !== id) : [...etiquetas, id];
    pintarEtiquetas();
  });

  el('nova-etiqueta').addEventListener('input', () => {
    realcada = 0;
    sugerir();
  });

  el('nova-etiqueta').addEventListener('keydown', async (e) => {
    const itens = [...el('sugestoes').querySelectorAll('li')];

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!itens.length) return;
      e.preventDefault();
      realcada = (realcada + (e.key === 'ArrowDown' ? 1 : itens.length - 1)) % itens.length;
      sugerir();
      return;
    }
    if (e.key === 'Escape' && !el('sugestoes').hidden) {
      e.preventDefault();
      e.stopPropagation();
      fecharSugestoes();
      return;
    }
    if (e.key !== 'Enter') return;

    // Enter aqui resolve a etiqueta, nunca salva o lançamento.
    e.preventDefault();
    e.stopPropagation();
    const escolhida = itens[realcada];
    if (escolhida?.dataset.etiqueta) return aplicarEtiqueta(escolhida.dataset.etiqueta);

    const campo = el('nova-etiqueta');
    const texto = campo.value;
    campo.value = '';
    await acrescentarEtiqueta(texto);
  });

  el('sugestoes').addEventListener('mousedown', async (e) => {
    // mousedown, não click: o blur do campo fecharia a lista antes do clique.
    const item = e.target.closest('li');
    if (!item) return;
    e.preventDefault();
    if (item.dataset.etiqueta) return aplicarEtiqueta(item.dataset.etiqueta);
    const campo = el('nova-etiqueta');
    const texto = campo.value;
    campo.value = '';
    await acrescentarEtiqueta(texto);
  });

  el('nova-etiqueta').addEventListener('blur', () => setTimeout(fecharSugestoes, 120));

  el('b-todas').addEventListener('click', () => {
    todasAbertas = !todasAbertas;
    pintarEtiquetas();
  });

  el('todas').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-etiqueta]');
    if (!botao) return;
    const id = botao.dataset.etiqueta;
    etiquetas = etiquetas.includes(id) ? etiquetas.filter((t) => t !== id) : [...etiquetas, id];
    pintarEtiquetas();
  });

  el('conta').addEventListener('change', () => {
    contaId = el('conta').value || null;
    // Cada conta tem o seu marco zero: trocar de conta pode mudar o piso da data.
    pintarData();
  });

  el('b-detalhe').addEventListener('click', () => {
    detalheAberto = !detalheAberto;
    pintarDetalhes();
    if (detalheAberto) el('novo-detalhe').focus();
  });

  el('chips-detalhe').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-detalhe]');
    if (!botao) return;
    detalheId = botao.dataset.detalhe === detalheId ? null : botao.dataset.detalhe;
    pintarDetalhes();
  });

  el('novo-detalhe').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    // Enter aqui acrescenta o detalhe, nunca salva o lançamento.
    e.preventDefault();
    e.stopPropagation();
    const campo = el('novo-detalhe');
    const texto = campo.value;
    campo.value = '';
    await escolherDetalhe(texto);
  });

  el('dia-menos').addEventListener('click', () => irPara(somarDias(data, -1)));
  el('dia-mais').addEventListener('click', () => irPara(somarDias(data, 1)));

  el('data').addEventListener('click', () => {
    const campo = el('data-exata');
    // showPicker abre o calendário do próprio aparelho — no celular é o seletor
    // nativo, que é melhor que qualquer coisa que eu desenhasse.
    if (typeof campo.showPicker === 'function') {
      try {
        campo.showPicker();
        return;
      } catch {
        // alguns navegadores recusam fora de gesto direto; cai no caminho abaixo
      }
    }
    campo.focus();
    campo.click();
  });

  el('data-exata').addEventListener('change', () => {
    if (!el('data-exata').value) return pintarData();
    irPara(el('data-exata').value);
  });

  raiz.querySelector('.pilulas').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-tipo]');
    if (!botao) return;
    tipo = botao.dataset.tipo;
    pintarTipo();
    categoriaId = null;
    pintarCategorias();
    valor.pintar();
  });

  // ── partida ─────────────────────────────────────────────────────────────

  async function recarregar() {
    app = await estado.calcular();
    if (!contaId || !app.contas[contaId]) contaId = contasUtilizaveis()[0]?.id ?? null;
    if (categoriaId && !app.categorias[categoriaId]) categoriaId = null;
    etiquetas = etiquetas.filter((t) => app.etiquetas?.[t]);
    pintarCategorias();
    pintarConta();
    pintarData();
    pintarTipo();
    pintarDetalhes();
    pintarEtiquetas();
    perigo.mostrar(Boolean(editando));
    valor.pintar();
  }

  await recarregar();

  return {
    recarregar,
    focar: () => valor.focar(),

    /**
     * Entra em modo correção com um lançamento que já existe (design/03 §9).
     * Só no andar de cima: o térreo não edita nem apaga (D11).
     */
    async carregar(l) {
      editando = l;
      tipo = l.tipo;
      data = l.dataCaixa;
      contaId = l.contaId;
      categoriaId = l.categoriaId;
      detalheId = l.detalheId ?? null;
      detalheAberto = Boolean(detalheId);
      etiquetas = [...(l.etiquetas ?? [])];
      valor.definir(l.valor);
      el('desfazer').hidden = true;
      el('nova-etiqueta').value = '';
      await recarregar();
    },

    /** Zera tudo: usado ao reabrir o diálogo depois de fechado. */
    limpar: () => {
      editando = null;
      etiquetas = [];
      valor.limpar();
      el('desfazer').hidden = true;
      pintarData();
      pintarEtiquetas();
      perigo.mostrar(false);
    },
  };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
