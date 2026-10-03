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
import { hoje, nasceConfirmado, nomeDaCategoria, correcao } from '../core/lancamentos.js';
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
    <button type="button" class="elo" data-papel="conta">conta</button>
    <button type="button" class="elo" data-papel="detalhe">+ detalhe</button>
  </div>

  <div class="etiquetas" data-papel="etiquetas" hidden>
    <span class="rotulo-etiquetas">etiquetas</span>
    <div class="chips" data-papel="chips" role="group" aria-label="Etiquetas"></div>
    <input type="text" class="nova-etiqueta" data-papel="nova-etiqueta" autocomplete="off"
           placeholder="+ etiqueta" aria-label="Acrescentar etiqueta">
    <datalist data-papel="sugestoes"></datalist>
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
export async function criarFormulario({ raiz, acoes, aoSalvar, aoFechar }) {
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

  const contasUtilizaveis = () =>
    Object.values(app.contas).filter(
      (c) => !c.arquivada && ['corrente', 'cartao', 'especie'].includes(c.tipo)
    );

  function pintarConta() {
    const conta = app.contas[contaId];
    el('conta').textContent = conta ? `conta: ${conta.nome}` : 'escolher conta';
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
    el('etiquetas').hidden = !editando;
    if (!editando) return;

    const todas = Object.values(app.etiquetas ?? {})
      .filter((t) => !t.arquivada || etiquetas.includes(t.id))
      .sort((a, b) => (a.nome < b.nome ? -1 : 1));

    el('chips').innerHTML = todas.length
      ? todas
          .map(
            (t) =>
              `<button type="button" data-etiqueta="${escapar(t.id)}" aria-pressed="${etiquetas.includes(t.id)}">${escapar(t.nome)}</button>`
          )
          .join('')
      : '<span class="vazio">Nenhuma etiqueta ainda — digite abaixo para criar.</span>';

    el('sugestoes').innerHTML = todas.map((t) => `<option value="${escapar(t.nome)}">`).join('');
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
    if (!etiquetas.includes(etiqueta.id)) etiquetas.push(etiqueta.id);
    pintarEtiquetas();
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

  el('nova-etiqueta').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    // Enter aqui é "acrescenta a etiqueta", nunca "salva o lançamento".
    e.preventDefault();
    e.stopPropagation();
    const campo = el('nova-etiqueta');
    const texto = campo.value;
    campo.value = '';
    await acrescentarEtiqueta(texto);
  });

  el('conta').addEventListener('click', () => {
    const contas = contasUtilizaveis();
    if (contas.length < 2) return;
    const i = contas.findIndex((c) => c.id === contaId);
    contaId = contas[(i + 1) % contas.length].id;
    pintarConta();
    pintarData();
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
