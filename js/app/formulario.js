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
  hoje, nasceConfirmado, nomeDaCategoria, correcao, detalhesDaCategoria, dataVista, estornado,
} from '../core/lancamentos.js';
import { somarDias, somarMeses } from '../core/datas.js';
import { temCiclo, cicloDaCompra } from '../core/cartao.js';
import { MARCACAO_CAMPO_VALOR, ligarCampoValor } from './campo-valor.js';
import { ligarZonaDePerigo } from './zona-perigo.js';
import { areaDaConta, opcoesDeConta, categoriaNaArea, areasParaConta } from './areas.js';

// As peças do formulário. O térreo (captura rápida do celular) começa pelo
// valor, com o teclado já aberto — três toques (03-alimentacao §1). O "Novo
// lançamento" do app começa pelo que se pensa primeiro: tipo, categoria,
// descrição e só então o valor (pedido dele, 03/10/2026).
const P = {
  valor: `
  ${MARCACAO_CAMPO_VALOR}
`,
  contexto: `
  <div class="contexto">
    <div class="pilulas" role="group" aria-label="Tipo de lançamento">
      <button type="button" data-tipo="despesa" aria-pressed="true">↓ despesa</button>
      <button type="button" data-tipo="receita" aria-pressed="false">↑ receita</button>
    </div>
    <div class="quando">
      <button type="button" class="passo" data-papel="dia-menos" aria-label="Um dia antes">−</button>
      <button type="button" class="elo" data-papel="data" aria-label="Escolher a data no calendário">hoje</button>
      <button type="button" class="passo" data-papel="dia-mais" aria-label="Um dia depois">+</button>
      <input type="date" class="data-exata" data-papel="data-exata" aria-label="Data do lançamento" tabindex="-1">
    </div>
  </div>

`,
  fatura: `
  <!-- No cartão: em qual fatura a compra cai, e um passo para a vizinha
       quando o banco a processou noutra. -->
  <div class="linha-fatura" data-papel="linha-fatura" hidden>
    <span class="miudo">fatura</span>
    <button type="button" class="passo" data-papel="fatura-antes" aria-label="Fatura anterior">‹</button>
    <span data-papel="fatura-rotulo"></span>
    <button type="button" class="passo" data-papel="fatura-depois" aria-label="Fatura seguinte">›</button>
  </div>

`,
  recado: `
  <p class="recado" data-papel="recado" hidden></p>

`,
  atalhos: `
  <div class="atalhos-captura" data-papel="atalhos" role="group" aria-label="Atalhos" hidden></div>

`,
  categorias: `
  <div class="categorias" data-papel="categorias" role="group" aria-label="Categoria"></div>

  <div class="mais-categorias">
    <button type="button" class="elo" data-papel="b-todas-cat" aria-expanded="false">+ todas</button>
  </div>
  <div class="todas-categorias" data-papel="todas-categorias" hidden>
    <div class="chips" data-papel="lista-todas-cat" role="group" aria-label="Todas as categorias"></div>
    <input type="text" class="nova-etiqueta" data-papel="nova-categoria" autocomplete="off"
           placeholder="criar categoria" aria-label="Criar categoria nova">
  </div>

`,
  conta: `
  <div class="linha-conta">
    <label class="escolha-conta" data-papel="escolha-conta">
      <span class="miudo"><span class="ponto-area" aria-hidden="true"></span>conta</span>
      <select data-papel="conta" aria-label="Conta do lançamento"></select>
    </label>
    <button type="button" class="elo" data-papel="b-refino" aria-expanded="false">detalhes</button>
  </div>

`,
  descricao: `
  <div class="detalhes" data-papel="detalhes">
    <span class="rotulo-etiquetas">descrição</span>
    <div class="chips" data-papel="chips-detalhe" role="group" aria-label="Descrição"></div>
    <input type="text" class="nova-etiqueta" data-papel="novo-detalhe" autocomplete="off"
       aria-label="Descrição">
  </div>

`,
  refinoComDescricao: `
  <div class="refino" data-papel="refino" hidden>
    <div class="detalhes" data-papel="detalhes">
      <span class="rotulo-etiquetas">descrição</span>
      <div class="chips" data-papel="chips-detalhe" role="group" aria-label="Descrição"></div>
      <input type="text" class="nova-etiqueta" data-papel="novo-detalhe" autocomplete="off"
             aria-label="Descrição">
    </div>

    <div class="etiquetas" data-papel="etiquetas">
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

    <div class="linha-refino" data-papel="linha-parcelas">
      <span class="rotulo-etiquetas">parcelas</span>
      <input type="number" class="parcelas" data-papel="parcelas" min="1" max="99" value="1"
             aria-label="Número de parcelas">
      <span class="conta-parcela" data-papel="conta-parcela"></span>
    </div>

    <div class="linha-refino" data-papel="linha-repete">
      <span class="rotulo-etiquetas">repete</span>
      <div class="pilulas" role="group" aria-label="Recorrência">
        <button type="button" data-repete="nao" aria-pressed="true">não</button>
        <button type="button" data-repete="fixa" aria-pressed="false">fixa</button>
        <button type="button" data-repete="estimada" aria-pressed="false">estimada</button>
      </div>
      <span class="pista-repete" data-papel="pista-repete"></span>
    </div>

    <div class="linha-refino">
      <span class="rotulo-etiquetas">obs</span>
      <input type="text" class="observacao" data-papel="observacao" autocomplete="off"
             placeholder="o que mais importa lembrar" aria-label="Observação">
    </div>
  </div>

`,
  refino: `
  <div class="refino" data-papel="refino" hidden>
    <div class="etiquetas" data-papel="etiquetas">
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

    <div class="linha-refino" data-papel="linha-parcelas">
      <span class="rotulo-etiquetas">parcelas</span>
      <input type="number" class="parcelas" data-papel="parcelas" min="1" max="99" value="1"
             aria-label="Número de parcelas">
      <span class="conta-parcela" data-papel="conta-parcela"></span>
    </div>

    <div class="linha-refino" data-papel="linha-repete">
      <span class="rotulo-etiquetas">repete</span>
      <div class="pilulas" role="group" aria-label="Recorrência">
        <button type="button" data-repete="nao" aria-pressed="true">não</button>
        <button type="button" data-repete="fixa" aria-pressed="false">fixa</button>
        <button type="button" data-repete="estimada" aria-pressed="false">estimada</button>
      </div>
      <span class="pista-repete" data-papel="pista-repete"></span>
    </div>

    <div class="linha-refino">
      <span class="rotulo-etiquetas">obs</span>
      <input type="text" class="observacao" data-papel="observacao" autocomplete="off"
             placeholder="o que mais importa lembrar" aria-label="Observação">
    </div>
  </div>

`,
  final: `
  <p class="desfazer" data-papel="desfazer" hidden></p>

  <label class="reajuste" data-papel="linha-reajuste" hidden>
    <input type="checkbox" data-papel="reajuste"> este valor vale daqui pra frente (reajuste)
  </label>

  <p class="devolucao" data-papel="devolucao" hidden></p>

  <div class="acoes" data-papel="acoes"></div>

  <p class="zona-perigo" data-papel="perigo" hidden></p>
`,
};

const rotuloDeCampo = (texto) => `  <p class="rotulo-campo">${texto}</p>\n`;

const MARCACAO = P.valor + P.contexto + P.fatura + P.recado + P.atalhos + P.categorias + P.conta + P.refinoComDescricao + P.final;

const MARCACAO_DO_APP =
  P.contexto + P.recado +
  rotuloDeCampo('categoria') + P.categorias +
  rotuloDeCampo('descrição <span class="fino">· opcional</span>') + P.descricao +
  rotuloDeCampo('valor') + P.valor +
  P.conta + P.fatura + P.refino + P.atalhos + P.final;

/**
 * @param {object} opcoes
 * @param {HTMLElement} opcoes.raiz      onde o formulário é montado
 * @param {Array}  opcoes.acoes          [{ id, rotulo, principal, fecha }]
 * @param {Function} [opcoes.aoSalvar]   chamado depois de cada mudança gravada
 * @param {Function} [opcoes.aoFechar]   chamado quando uma ação pede pra fechar
 */
export async function criarFormulario({
  raiz, acoes, aoSalvar, aoFechar, comEtiquetas = false, lembrarConta = false, aoDevolver = null,
  ordemDoApp = false,
}) {
  raiz.innerHTML = ordemDoApp ? MARCACAO_DO_APP : MARCACAO;
  raiz.classList.toggle('formulario-app', ordemDoApp);
  if (ordemDoApp) raiz.querySelector('[data-papel="nova-categoria"]').placeholder = 'buscar ou criar categoria';
  const dedo = matchMedia('(pointer: coarse)').matches;
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
  let todasAbertas = false;
  let realcada = 0;
  let repete = 'nao';
  // No cartão: quantas faturas a compra anda da que a data dela daria.
  let faturaDesloca = 0;
  // Na correção: como o lançamento estava quando abriu ('nao', 'fixa' ou
  // 'estimada'). Mudou, salvar mexe na série (cria, encerra ou troca o tipo).
  let repeteAntes = 'nao';
  // Dedo ou mouse — é o contexto que muda a pressa, não a marca do aparelho.
  // No PC o refino nasce aberto; no celular, a um toque (03-alimentacao §1).
  // No app o "mais" nasce fechado: tipo, categoria, descrição, valor e conta
  // já estão à vista, e o resto é exceção.
  let refinoAberto = ordemDoApp ? false : !dedo;
  let ultimo = null;
  let sumir = null;
  // O lançamento que está sendo corrigido, ou null — é só isso que separa as
  // duas vidas deste formulário.
  let editando = null;
  // A série de que este lançamento é a ocorrência do mês, quando ele nasceu
  // de um previsto do extrato. Lançado, o previsto some (03-alimentacao §4).
  let daSerie = null;
  // A ocorrência que abriu o formulário, se foi um previsto: é dela que sai a
  // estimativa original guardada ao lançar (02 §3.6, R18).
  let previstoDe = null;
  // Escolheu a conta à mão? Então o app não troca por cima (03 §1: a conta
  // lembrada por categoria é sugestão, nunca teima).
  let contaTocada = false;
  let todasCategorias = false;
  const aparelho = (await log.aparelho())?.id ?? null;

  // ── valor ───────────────────────────────────────────────────────────────

  const valor = ligarCampoValor(raiz, {
    aoMudar: () => {
      for (const b of raiz.querySelectorAll('[data-acao]')) b.disabled = !pronto();
      if (app) pintarParcelas();
      pintarReajuste();
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
    // No app, as que você mais usou POR ÚLTIMO: os 40 lançamentos mais
    // recentes, para a lista acompanhar a fase em que você está.
    const todos = Object.values(app.lancamentos).filter((l) => !l.removido && l.categoriaId);
    for (const l of ordemDoApp ? todos.slice(-40) : todos) {
      usos.set(l.categoriaId, (usos.get(l.categoriaId) || 0) + 1);
    }
    const ehGrupo = (c) => Object.values(app.categorias).some((o) => o.pai === c.id);
    return categoriasDaVez(ehGrupo)
      .sort((a, b) => (usos.get(b.id) || 0) - (usos.get(a.id) || 0) || (a.nome < b.nome ? -1 : 1))
      .slice(0, limite);
  }

  /**
   * As categorias que cabem aqui: do tipo escolhido e da área da conta (D26).
   * Lançando na corrente, IR não existe; lançando na folha, Supermercado não.
   */
  function categoriasDaVez(ehGrupo = () => false) {
    const conta = app.contas[contaId];
    return Object.values(app.categorias).filter(
      (c) => !c.arquivada && c.natureza === tipo && !ehGrupo(c) && categoriaNaArea(c, conta)
    );
  }

  /** "+ todas": a lista inteira do tipo, e criar uma nova ali mesmo (03 §10). */
  function pintarTodasCategorias() {
    el('b-todas-cat').textContent = todasCategorias ? 'menos' : '+ todas';
    el('b-todas-cat').setAttribute('aria-expanded', String(todasCategorias));
    el('todas-categorias').hidden = !todasCategorias;
    if (!todasCategorias) return;
    const ehGrupo = (c) => Object.values(app.categorias).some((o) => o.pai === c.id);
    const todas = categoriasDaVez(ehGrupo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (ordemDoApp) return pintarListaDoApp(todas);
    el('lista-todas-cat').innerHTML = todas.length
      ? todas
          .map(
            (c) =>
              `<button type="button" data-id="${escapar(c.id)}" aria-pressed="${c.id === categoriaId}">${escapar(c.nome)}</button>`
          )
          .join('')
      : '<span class="vazio">nenhuma ainda</span>';
  }

  /**
   * "outras ▾" no app: a lista inteira, filtrada pelo que se digita, e no fim
   * "+ criar" — com o que foi digitado, ou para começar a digitar.
   */
  function pintarListaDoApp(todas) {
    // "saude" acha "Saúde": sem acento e sem caixa.
    const chave = (t) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();
    const busca = chave(el('nova-categoria').value);
    const achadas = busca ? todas.filter((c) => chave(c.nome).includes(busca)) : todas;
    const exata = todas.some((c) => chave(c.nome) === busca);
    const criar = busca && !exata
      ? `<button type="button" class="criar-categoria" data-criar-categoria>+ criar “${escapar(el('nova-categoria').value.trim())}”</button>`
      : busca ? '' : '<button type="button" class="criar-categoria" data-criar-categoria>+ criar categoria</button>';
    el('lista-todas-cat').innerHTML =
      achadas
        .map((c) => `<button type="button" data-id="${escapar(c.id)}" aria-pressed="${c.id === categoriaId}">${escapar(c.nome)}</button>`)
        .join('') + criar;
  }

  async function criarCategoria(texto) {
    const nome = texto.trim();
    if (!nome) return;
    const chave = nome.toLocaleLowerCase('pt-BR');
    let existente = Object.values(app.categorias).find(
      (c) => c.nome.trim().toLocaleLowerCase('pt-BR') === chave && c.natureza === tipo
    );
    if (existente?.arquivada) {
      // Nome de uma arquivada: volta a ela em vez de criar a gêmea.
      await estado.aplicarEvento('categoria.arquivada', { id: existente.id, arquivada: false });
    }
    if (!existente) {
      const id = novoId('cat');
      await estado.aplicarEvento('categoria.criada', {
        id, nome, pai: null, natureza: tipo,
        // Criada lançando na folha, é da folha; no resto, do dia a dia (D26).
        areas: areasParaConta(app.contas[contaId]),
      });
      existente = { id };
    }
    categoriaId = existente.id;
    detalheId = null;
    await recarregar();
    valor.pintar();
  }

  function nomeDaArea() {
    const area = areaDaConta(app.contas[contaId]);
    return { caixa: 'em caixa', cartoes: 'nos cartões', folha: 'na folha', investimentos: 'em investimentos', dividas: 'em dívidas' }[area] ?? '';
  }

  function pintarCategorias() {
    pintarTodasCategorias();
    const lista = maisUsadas(ordemDoApp ? 3 : 8);
    // A categoria de um lançamento antigo pode não estar mais entre as mais
    // usadas, e ela precisa aparecer marcada: edição que não mostra o que está
    // lá parece ter perdido o dado.
    if (categoriaId && app.categorias[categoriaId] && !lista.some((c) => c.id === categoriaId)) {
      lista.push(app.categorias[categoriaId]);
    }
    const outras = ordemDoApp
      ? `<button type="button" class="outras-categorias" data-outras aria-expanded="${todasCategorias}">${todasCategorias ? 'fechar ▴' : 'outras ▾'}</button>`
      : '';
    el('categorias').innerHTML = lista.length
      ? lista
          .map(
            (c) =>
              `<button type="button" data-id="${c.id}" aria-pressed="${c.id === categoriaId}">${escapar(c.nome)}</button>`
          )
          .join('') + outras
      : ordemDoApp
        ? `<span class="vazio">Nenhuma categoria de ${tipo} ${nomeDaArea()} ainda.</span>${outras}`
        : `<p class="vazio">Nenhuma categoria de ${tipo} ${nomeDaArea()}. Crie em "+ todas" ou em <a href="app.html#/configuracoes/categorias">Configurações</a>.</p>`;
  }

  /**
   * Todas as contas que não estão arquivadas. Folha, dívida e investimento
   * entram porque a vida passa por elas — e enquanto o mecanismo próprio do
   * holerite (D25) não existe, é por aqui que o desconto da folha é lançado.
   * Esconder conta que o dono criou é decidir por ele.
   */
  const contasUtilizaveis = () => Object.values(app.contas).filter((c) => !c.arquivada);

  /** A conta mais usada: o caso dominante, sem pedir configuração. */
  function contaPadrao() {
    const usos = new Map();
    for (const l of Object.values(app.lancamentos)) {
      if (!l.removido) usos.set(l.contaId, (usos.get(l.contaId) ?? 0) + 1);
    }
    return contasUtilizaveis().sort((a, b) => (usos.get(b.id) ?? 0) - (usos.get(a.id) ?? 0))[0]?.id ?? null;
  }

  /** A última conta usada nesta categoria (03 §1: "o app lembra"). */
  function contaDaCategoria(id) {
    const daCategoria = Object.values(app.lancamentos).filter(
      (l) => !l.removido && l.categoriaId === id && app.contas[l.contaId] && !app.contas[l.contaId].arquivada
    );
    return daCategoria.length ? daCategoria[daCategoria.length - 1].contaId : null;
  }

  // ── atalhos: repetir último e favoritos (03 §1) ─────────────────────────
  //
  // Os dois são aprendidos, não configurados: nada a cadastrar, nada
  // convidando a ser configurado (08-telas §2).

  /** O último lançamento feito neste aparelho, se for repetível. */
  function ultimoDaqui() {
    const meus = Object.values(app.lancamentos).filter(
      (l) =>
        !l.removido && l.lancadoPor === aparelho && !l.parcela && !l.recorrenciaId &&
        (l.tipo === 'despesa' || l.tipo === 'receita') && app.categorias[l.categoriaId]
    );
    return meus[meus.length - 1] ?? null;
  }

  /**
   * As combinações que se repetem: categoria + detalhe + conta, usadas três
   * vezes ou mais nos últimos quatro meses. Só falta o valor.
   */
  function favoritos() {
    const desde = somarDias(hoje(), -120);
    const cont = new Map();
    for (const l of Object.values(app.lancamentos)) {
      if (l.removido || !l.detalheId || l.parcela || l.dataCompetencia < desde) continue;
      if (l.tipo !== 'despesa' && l.tipo !== 'receita') continue;
      if (!app.categorias[l.categoriaId] || !app.detalhes?.[l.detalheId] || !app.contas[l.contaId]) continue;
      const chave = [l.tipo, l.categoriaId, l.detalheId, l.contaId].join('|');
      cont.set(chave, (cont.get(chave) ?? 0) + 1);
    }
    return [...cont.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([chave]) => {
        const [t, categoria, detalhe, conta] = chave.split('|');
        return { tipo: t, categoriaId: categoria, detalheId: detalhe, contaId: conta };
      });
  }

  function pintarAtalhos() {
    // No app o "repetir último" e os favoritos saem (pedido dele): a lista de
    // categorias já começa pelas que você usou por último.
    const mostrar = !ordemDoApp && !editando && !daSerie;
    const ultimo = mostrar ? ultimoDaqui() : null;
    const favs = mostrar ? favoritos() : [];
    el('atalhos').hidden = !ultimo && !favs.length;
    if (el('atalhos').hidden) return;
    const variasContas = contasUtilizaveis().length > 1;
    el('atalhos').innerHTML =
      (ultimo
        ? `<button type="button" data-atalho="repetir" title="Repetir o último lançamento">↻ ${escapar(formatar(ultimo.valor))} · ${escapar(nomeDaCategoria(app, ultimo.categoriaId))}</button>`
        : '') +
      favs
        .map(
          (f, i) =>
            `<button type="button" data-atalho="fav" data-i="${i}">★ ${escapar(nomeDaCategoria(app, f.categoriaId))} · ${escapar(app.detalhes[f.detalheId].nome)}${variasContas ? ` <span class="fino">${escapar(app.contas[f.contaId].nome)}</span>` : ''}</button>`
        )
        .join('');
    atalhosNaTela = { ultimo, favs };
  }
  let atalhosNaTela = { ultimo: null, favs: [] };

  async function usarAtalho(qual, i) {
    const a = qual === 'repetir' ? atalhosNaTela.ultimo : atalhosNaTela.favs[i];
    if (!a) return;
    tipo = a.tipo;
    categoriaId = a.categoriaId;
    detalheId = a.detalheId ?? null;
    contaId = a.contaId;
    contaTocada = true;
    await recarregar();
    if (qual === 'repetir') {
      // Mesmo valor: falta só o Lançar.
      valor.definir(a.valor);
      valor.desfocar();
    } else {
      valor.focar();
    }
    valor.pintar();
  }

  function pintarConta() {
    const contas = contasUtilizaveis();
    el('conta').innerHTML = contas.length
      ? opcoesDeConta(contas, contaId)
      : '<option value="">nenhuma conta</option>';
    pintarArea();
  }

  /**
   * A conta escolhida veste a cor da área dela, e o formulário inteiro junto
   * — valor e botão de salvar (09-identidade §3).
   */
  function pintarArea() {
    const area = areaDaConta(app.contas[contaId]);
    el('escolha-conta').dataset.area = area;
    // A janela em volta (o diálogo do PC) veste a mesma área.
    for (const alvo of [raiz, raiz.closest('dialog')]) {
      if (!alvo) continue;
      if (area) alvo.dataset.area = area;
      else delete alvo.dataset.area;
    }
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
    pintarFatura();
  }

  /** "fatura · vence 05/11", com ‹ › para a vizinha — só em cartão com ciclo. */
  function pintarFatura() {
    const conta = app?.contas[contaId];
    const tem = temCiclo(conta);
    el('linha-fatura').hidden = !tem;
    if (!tem) return;
    const { vencimento } = cicloDaCompra(conta, data, faturaDesloca);
    const movida = faturaDesloca
      ? ` · movida ${Math.abs(faturaDesloca) > 1 ? `${Math.abs(faturaDesloca)} faturas` : ''} ${faturaDesloca > 0 ? 'pra frente' : 'pra trás'}`.replace('  ', ' ')
      : '';
    el('fatura-rotulo').textContent = `vence ${vencimento.slice(8, 10)}/${vencimento.slice(5, 7)}${movida}`;
    el('linha-fatura').classList.toggle('movida', Boolean(faturaDesloca));
  }

  function rotuloDoDia(dia) {
    if (dia === hoje()) return 'hoje';
    if (dia === somarDias(hoje(), -1)) return 'ontem';
    if (dia === somarDias(hoje(), 1)) return 'amanhã';
    const [ano, mes, d] = dia.split('-');
    return ano === hoje().slice(0, 4) ? `${d}/${mes}` : `${d}/${mes}/${ano}`;
  }

  /**
   * O dia antes do qual não se lança nesta conta. No cartão não há: o "já na
   * fatura aberta" do cadastro cobre só a fatura que estava aberta, e as
   * compras da fatura anterior — fechada, ainda por pagar — precisam entrar
   * pela data delas (pedido dele, 03/10/2026).
   */
  const pisoDaConta = () => {
    const conta = app.contas[contaId];
    if (!conta || conta.tipo === 'cartao') return null;
    return conta.dataInicial ?? null;
  };

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
    pintarRefino();
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

  function pintarRefino() {
    el('refino').hidden = !refinoAberto;
    el('b-refino').setAttribute('aria-expanded', String(refinoAberto));
    el('b-refino').textContent = ordemDoApp
      ? (refinoAberto ? 'menos ▴' : `mais ▾${resumoDoRefino() !== 'detalhes' ? ` · ${resumoDoRefino()}` : ''}`)
      : refinoAberto ? 'detalhes' : resumoDoRefino();
    if (ordemDoApp) pintarDetalhes();
    if (!refinoAberto) return;

    if (!ordemDoApp) pintarDetalhes();
    pintarEtiquetas();
    pintarParcelas();
    pintarRepete();
  }

  /** Fechado, o botão conta o que tem dentro — senão ninguém abre. */
  function resumoDoRefino() {
    const partes = [];
    if (nomeDoDetalhe() && !ordemDoApp) partes.push(nomeDoDetalhe());
    if (etiquetas.length) partes.push(`${etiquetas.length} etiqueta${etiquetas.length > 1 ? 's' : ''}`);
    if (parcelas() > 1) partes.push(`${parcelas()}×`);
    if (repete !== 'nao') partes.push(repete);
    return partes.length ? partes.join(' · ') : 'detalhes';
  }

  const parcelas = () => Math.max(1, Math.min(99, Number(el('parcelas').value) || 1));

  function pintarParcelas() {
    // O valor digitado é o da PARCELA, como a loja anuncia e o cartão cobra
    // (03-alimentacao §6.1). O total é o app que faz.
    const quantas = parcelas();
    el('linha-parcelas').hidden = Boolean(editando);
    el('conta-parcela').textContent =
      quantas > 1 && valor.centavos() > 0
        ? `${quantas}× de ${formatar(valor.centavos())} = ${formatar(valor.centavos() * quantas)}`
        : '';
  }

  function pintarRepete() {
    // Parcela de compra não repete: parcelamento já é outra série.
    el('linha-repete').hidden = Boolean(daSerie) || Boolean(editando?.parcela);
    for (const b of raiz.querySelectorAll('[data-repete]')) {
      b.setAttribute('aria-pressed', String(b.dataset.repete === repete));
    }
    el('pista-repete').textContent =
      editando && repeteAntes !== 'nao' && repete === 'nao'
        ? outrosDaSerie().length ? 'a série para depois deste; os meses já lançados ficam' : 'deixa de repetir: vira lançamento único'
        : editando && repeteAntes === 'nao' && repete !== 'nao'
          ? `${repete === 'fixa' ? 'todo mês, mesmo valor' : 'todo mês, média das últimas 3'} — a partir deste`
          : repete === 'fixa'
            ? 'todo mês, mesmo valor'
            : repete === 'estimada'
              ? 'todo mês, média das últimas 3'
              : '';
  }

  /** A série do lançamento em correção, se ela ainda projeta daqui pra frente. */
  function serieViva(l) {
    const r = l?.recorrenciaId ? app?.recorrencias?.[l.recorrenciaId] : null;
    if (!r || r.arquivada) return null;
    if (r.fim && r.fim < l.dataCompetencia) return null;
    return r;
  }

  /** Os outros lançamentos da mesma série, além do que está em correção. */
  function outrosDaSerie() {
    if (!editando?.recorrenciaId) return [];
    return Object.values(app.lancamentos).filter(
      (l) => !l.removido && l.recorrenciaId === editando.recorrenciaId && l.id !== editando.id
    );
  }

  /**
   * Mudou o "repete" na correção (pedido dele, 03/10/2026):
   *   não → fixa/estimada: nasce a série a partir deste lançamento, e ele é o primeiro.
   *   fixa/estimada → não: sozinho na série, ela some e ele vira único; com
   *     outros meses lançados, a série termina neste — o passado fica.
   *   fixa ↔ estimada: a série troca de tipo.
   * Devolve true se mexeu em alguma coisa.
   */
  async function aplicarMudancaDeRepete() {
    if (!editando || editando.parcela || repete === repeteAntes) return false;
    const l = editando;
    if (repeteAntes === 'nao') {
      const id = await garantirRecorrencia();
      await estado.aplicarEvento('lancamento.alterado', { id: l.id, recorrenciaId: id });
    } else if (repete === 'nao') {
      if (outrosDaSerie().length) {
        await estado.aplicarEvento('recorrencia.alterada', { id: l.recorrenciaId, fim: l.dataCompetencia });
      } else {
        const serie = l.recorrenciaId;
        await estado.aplicarEvento('lancamento.alterado', { id: l.id, recorrenciaId: null });
        await estado.aplicarEvento('recorrencia.removida', { id: serie });
      }
    } else {
      await estado.aplicarEvento('recorrencia.alterada', {
        id: l.recorrenciaId,
        tipoValor: repete === 'fixa' ? 'fixa' : 'variavel',
        valor: repete === 'fixa' ? valor.centavos() : null,
      });
    }
    repeteAntes = repete;
    return true;
  }

  function pintarDetalhes() {

    const sugeridos = detalhesDaCategoria(app, categoriaId);
    el('detalhes').hidden = false;
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
      : '';
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
    pintarRefino();
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
    // A descrição escrita e não confirmada com Enter vale do mesmo jeito:
    // salvar sem ela perdia o que estava escrito na tela.
    const escrita = el('novo-detalhe').value.trim();
    if (escrita) {
      el('novo-detalhe').value = '';
      await escolherDetalhe(escrita);
    }
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
      observacao: el('observacao').value.trim(),
      faturaDesloca: app.contas[contaId]?.tipo === 'cartao' ? faturaDesloca : 0,
      dataCaixa: data,
    });

    const mexeuNaSerie = await aplicarMudancaDeRepete();

    // Abriu, olhou e fechou: não existe evento "salvou igual".
    if (Object.keys(mudancas).length === 0) {
      if (mexeuNaSerie) {
        await recarregar();
        editando = app.lancamentos[editando.id] ?? editando;
        if (aoSalvar) await aoSalvar();
      }
      return true;
    }

    await estado.aplicarEvento('lancamento.alterado', { id: editando.id, ...mudancas });
    await propagarParaAsIrmas(mudancas);
    await recarregar();
    editando = app.lancamentos[editando.id] ?? editando;
    if (aoSalvar) await aoSalvar();
    return true;
  }

  /**
   * Numa compra parcelada, o que é da COMPRA vale para todas as parcelas —
   * elas são a mesma compra, paga em pedaços. O que é da parcela (valor dela,
   * data dela, conta que pagou) fica só nela (03-alimentacao §6.1).
   *
   * Sem perguntar "aplicar a todas?": o app sabe qual campo é de quem, e a
   * pergunta apareceria também nas vezes em que a resposta é óbvia.
   */
  async function propagarParaAsIrmas(mudancas) {
    if (!editando.parcela?.compraId) return;

    const DA_COMPRA = ['tipo', 'categoriaId', 'detalheId', 'etiquetas', 'observacao', 'faturaDesloca'];
    const comuns = Object.fromEntries(
      Object.entries(mudancas).filter(([campo]) => DA_COMPRA.includes(campo))
    );
    if (!Object.keys(comuns).length) return;

    const irmas = Object.values(app.lancamentos).filter(
      (l) =>
        !l.removido &&
        l.id !== editando.id &&
        l.parcela?.compraId === editando.parcela.compraId
    );
    for (const irma of irmas) {
      await estado.aplicarEvento('lancamento.alterado', { id: irma.id, ...comuns });
    }
  }

  async function registrar() {
    const ap = await log.aparelho();
    const quantas = parcelas();
    // A compra é o conjunto das parcelas, amarradas pelo mesmo id — não existe
    // linha-mãe com o total, que seria a forma mais fácil de contar o mesmo
    // dinheiro duas vezes (03-alimentacao §6.1).
    const compraId = quantas > 1 ? novoId('cmp') : null;
    const recorrenciaId = daSerie ?? (await garantirRecorrencia());
    // No cartão a parcela é realizada desde a compra (D4): o que vem depois é
    // o pagamento, não o gasto. Na corrente, parcela futura é compromisso.
    const noCartao = app.contas[contaId]?.tipo === 'cartao';

    const comum = {
      tipo,
      valor: valor.centavos(),
      contaId,
      categoriaId,
      detalheId,
      etiquetas: [...etiquetas],
      observacao: el('observacao').value.trim(),
      recorrenciaId,
      lancadoPor: ap?.id ?? null,
      // A compra inteira anda junto: cada parcela, uma fatura a mais.
      faturaDesloca: noCartao ? faturaDesloca : 0,
      ...procedencia(),
    };

    const ids = [];
    for (let i = 0; i < quantas; i += 1) {
      // Cada parcela tem competência no SEU mês: é assim que o mês fecha com o
      // que a pessoa sente, e é o que impede um pico falso na R2 (§6.1).
      const dia = somarMeses(data, i);
      const id = novoId('lan');
      ids.push(id);
      await estado.aplicarEvento('lancamento.registrado', {
        id,
        ...comum,
        dataCompetencia: dia,
        dataCaixa: dia,
        // Não é escolha de ninguém: vem da origem e da data (D2).
        confirmado: nasceConfirmado({ manual: true, dataCaixa: noCartao ? data : dia }),
        parcela: compraId ? { compraId, numero: i + 1, total: quantas } : null,
      });
    }

    const quanto = formatar(valor.centavos());
    ultimo = {
      ids,
      resumo:
        (quantas > 1 ? `${quantas}× de ${quanto}` : quanto) +
        ` · ${nomeDaCategoria(app, categoriaId)}`,
    };
    if (previstoDe && el('reajuste').checked && recorrenciaId) {
      await estado.aplicarEvento('recorrencia.reajustada', {
        id: recorrenciaId, desde: previstoDe.dataCompetencia, valor: valor.centavos(),
      });
    }
    el('reajuste').checked = false;
    daSerie = null;
    previstoDe = null;
    // "Salvar e nova" guarda o que vale para a pilha de notas — tipo, conta e
    // data — e limpa o que era deste lançamento: descrição, etiquetas,
    // observação, parcelas, repete (pedido dele, 03/10/2026). No app, também
    // a categoria: a próxima nota raramente é da mesma.
    detalheId = null;
    etiquetas = [];
    el('observacao').value = '';
    el('parcelas').value = '1';
    repete = 'nao';
    faturaDesloca = 0;
    if (ordemDoApp) categoriaId = null;
    await recarregar();
    valor.limpar();
    mostrarDesfazer();
    if (aoSalvar) await aoSalvar();
    return true;
  }

  /**
   * De onde saiu o valor (02 §3.6): lançado de um previsto estimado, guarda a
   * estimativa original — sem isso a R18 (acurácia da previsão) não existe.
   */
  function procedencia() {
    if (!previstoDe) return {};
    const igual = valor.centavos() === previstoDe.valor;
    return {
      origemValor: igual ? previstoDe.origemValor ?? 'digitado' : 'digitado',
      valorEstimadoOriginal: previstoDe.estimado ? previstoDe.valor : null,
    };
  }

  /**
   * Marcar "repete" na captura cria a série, que é entidade separada (F4) —
   * ela precisa existir sozinha pra projetar os meses à frente, inclusive os
   * meses em que ninguém lançou nada (03-alimentacao §4).
   */
  async function garantirRecorrencia() {
    if (repete === 'nao') return null;
    const id = novoId('rec');
    await estado.aplicarEvento('recorrencia.criada', {
      id,
      nome: [nomeDaCategoria(app, categoriaId), nomeDoDetalhe()].filter(Boolean).join(' · ') || tipo,
      tipo,
      contaId,
      categoriaId,
      detalheId,
      etiquetas: [...etiquetas],
      tipoValor: repete === 'fixa' ? 'fixa' : 'variavel',
      valor: repete === 'fixa' ? valor.centavos() : null,
      periodicidade: 'mensal',
      dia: Number(data.slice(8, 10)),
      inicio: data,
    });
    app = await estado.calcular();
    return id;
  }

  function mostrarDesfazer() {
    const faixa = el('desfazer');
    faixa.innerHTML = `<span>salvo · ${escapar(ultimo.resumo)}</span><button type="button" data-papel="b-desfazer">desfazer</button>`;
    faixa.hidden = false;
    faixa.querySelector('[data-papel="b-desfazer"]').addEventListener('click', async () => {
      // Desfazer uma compra em 10× desfaz as dez: foi um ato só.
      for (const id of ultimo.ids) await estado.aplicarEvento('lancamento.removido', { id });
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

  function escolherCategoria(id) {
    categoriaId = id === categoriaId ? null : id;
    // O detalhe é escopado pela categoria: trocar de categoria recomeça a lista.
    detalheId = null;
    // No térreo, a conta segue a última usada nesta categoria — a não ser que
    // a pessoa tenha escolhido a conta à mão (03 §1).
    if (lembrarConta && !editando && !contaTocada && categoriaId) {
      const lembrada = contaDaCategoria(categoriaId);
      if (lembrada && lembrada !== contaId) {
        contaId = lembrada;
        pintarConta();
        pintarData();
      }
    }
  }

  el('categorias').addEventListener('click', (e) => {
    if (e.target.closest('[data-outras]')) {
      todasCategorias = !todasCategorias;
      el('nova-categoria').value = '';
      pintarCategorias();
      if (todasCategorias && !dedo) el('nova-categoria').focus();
      return;
    }
    const botao = e.target.closest('button[data-id]');
    if (!botao) return;
    escolherCategoria(botao.dataset.id);
    for (const b of el('categorias').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.id === categoriaId));
    }
    pintarTodasCategorias();
    pintarRefino();
    // Tocar na categoria fecha o teclado do celular — e é esse toque que revela
    // o botão de lançar, sem precisar de um passo só pra dispensar. No app, no
    // PC, o próximo passo é o valor: o foco vai para ele.
    if (ordemDoApp && !dedo) valor.focar(); else valor.desfocar();
    valor.pintar();
  });

  el('chips').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-etiqueta]');
    if (!botao) return;
    const id = botao.dataset.etiqueta;
    etiquetas = etiquetas.includes(id) ? etiquetas.filter((t) => t !== id) : [...etiquetas, id];
    pintarRefino();
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
    pintarRefino();
  });

  el('todas').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-etiqueta]');
    if (!botao) return;
    const id = botao.dataset.etiqueta;
    etiquetas = etiquetas.includes(id) ? etiquetas.filter((t) => t !== id) : [...etiquetas, id];
    pintarRefino();
  });

  el('conta').addEventListener('change', () => {
    contaId = el('conta').value || null;
    contaTocada = true;
    pintarArea();
    // Outra área, outras categorias (D26). A escolhida que não cabe aqui sai —
    // a não ser na correção, onde sumir com o dado pareceria perda.
    const escolhida = app.categorias[categoriaId];
    if (escolhida && !editando && !categoriaNaArea(escolhida, app.contas[contaId])) {
      categoriaId = null;
      detalheId = null;
      pintarRefino();
    }
    pintarCategorias();
    valor.pintar();
    // Cada conta tem o seu marco zero: trocar de conta pode mudar o piso da data.
    pintarData();
  });

  el('b-refino').addEventListener('click', () => {
    refinoAberto = !refinoAberto;
    pintarRefino();
    if (refinoAberto) el('novo-detalhe').focus();
  });

  el('parcelas').addEventListener('input', pintarParcelas);

  el('fatura-antes').addEventListener('click', () => { faturaDesloca -= 1; pintarFatura(); });
  el('fatura-depois').addEventListener('click', () => { faturaDesloca += 1; pintarFatura(); });

  raiz.querySelector('[data-papel="linha-repete"] .pilulas').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-repete]');
    if (!botao) return;
    repete = botao.dataset.repete;
    pintarRepete();
  });

  el('chips-detalhe').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-detalhe]');
    if (!botao) return;
    detalheId = botao.dataset.detalhe === detalheId ? null : botao.dataset.detalhe;
    pintarRefino();
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
    if (!contaId || !app.contas[contaId] || app.contas[contaId].arquivada) contaId = contaPadrao();
    if (categoriaId && !app.categorias[categoriaId]) categoriaId = null;
    etiquetas = etiquetas.filter((t) => app.etiquetas?.[t]);
    pintarCategorias();
    pintarConta();
    pintarData();
    pintarTipo();
    pintarRefino();
    perigo.mostrar(Boolean(editando));
    pintarAtalhos();
    pintarDevolucao();
    valor.pintar();
  }

  /**
   * Devolver é partir da compra (03 §3.3): só na correção de uma despesa, e
   * mostrando quanto já voltou.
   */
  /**
   * Lançando a ocorrência de uma conta FIXA com valor diferente, pergunta se é
   * reajuste: sim, o valor novo vale daqui pra frente; não, só este mês
   * (design/10 §7).
   */
  function pintarReajuste() {
    const serie = previstoDe ? app?.recorrencias?.[previstoDe.recorrenciaId] : null;
    const mostrar = Boolean(serie) && serie.tipoValor === 'fixa' && valor.centavos() > 0 && valor.centavos() !== previstoDe.valor;
    el('linha-reajuste').hidden = !mostrar;
    if (!mostrar) el('reajuste').checked = false;
  }

  function pintarDevolucao() {
    const pode = Boolean(editando) && editando.tipo === 'despesa' && Boolean(aoDevolver);
    el('devolucao').hidden = !pode;
    if (!pode) return;
    const ja = estornado(app, editando.id);
    el('devolucao').innerHTML =
      (ja ? `<span>devolvido ${escapar(formatar(ja))} de ${escapar(formatar(editando.valor))}</span>` : '') +
      (ja < editando.valor
        ? '<button type="button" class="elo" data-papel="b-devolver">registrar devolução</button>'
        : '');
  }

  el('devolucao').addEventListener('click', (e) => {
    if (e.target.closest('[data-papel="b-devolver"]') && aoDevolver) aoDevolver(editando);
  });

  el('atalhos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-atalho]');
    if (b) usarAtalho(b.dataset.atalho, Number(b.dataset.i));
  });

  el('b-todas-cat').addEventListener('click', () => {
    todasCategorias = !todasCategorias;
    pintarTodasCategorias();
    if (todasCategorias) el('nova-categoria').focus();
  });

  el('lista-todas-cat').addEventListener('click', async (e) => {
    if (e.target.closest('[data-criar-categoria]')) {
      const texto = el('nova-categoria').value;
      if (!texto.trim()) { el('nova-categoria').focus(); return; }
      el('nova-categoria').value = '';
      todasCategorias = false;
      await criarCategoria(texto);
      if (ordemDoApp && !dedo) valor.focar();
      return;
    }
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    escolherCategoria(b.dataset.id);
    if (ordemDoApp) {
      todasCategorias = false;
      el('nova-categoria').value = '';
    }
    pintarCategorias();
    pintarRefino();
    if (ordemDoApp && !dedo) valor.focar(); else valor.desfocar();
    valor.pintar();
  });

  // No app, o campo da lista filtra enquanto se digita.
  el('nova-categoria').addEventListener('input', () => {
    if (ordemDoApp) pintarTodasCategorias();
  });

  el('nova-categoria').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    // Enter aqui cria a categoria, nunca salva o lançamento.
    e.preventDefault();
    e.stopPropagation();
    const campo = el('nova-categoria');
    const texto = campo.value;
    if (ordemDoApp) {
      // Enter escolhe a primeira achada; sem nenhuma, cria.
      const primeira = el('lista-todas-cat').querySelector('button[data-id]');
      campo.value = '';
      todasCategorias = false;
      if (primeira && texto.trim()) {
        escolherCategoria(primeira.dataset.id);
        pintarCategorias();
        pintarRefino();
      } else {
        await criarCategoria(texto);
      }
      if (!dedo) valor.focar();
      valor.pintar();
      return;
    }
    campo.value = '';
    await criarCategoria(texto);
  });

  await recarregar();

  return {
    recarregar,
    focar: () => { if (!(ordemDoApp && dedo)) valor.focar(); },

    /**
     * Entra em modo correção com um lançamento que já existe (design/03 §9).
     * Só no andar de cima: o térreo não edita nem apaga (D11).
     */
    async carregar(l) {
      editando = l;
      faturaDesloca = l.faturaDesloca ?? 0;
      daSerie = null;
      tipo = l.tipo;
      // No cartão, a data que se corrige é a da compra (03-alimentacao §6.2).
      data = dataVista(l);
      contaId = l.contaId;
      categoriaId = l.categoriaId;
      detalheId = l.detalheId ?? null;
      el('observacao').value = l.observacao ?? '';
      // Na correção o refino abre sozinho: é pra isso que se abriu o lançamento.
      refinoAberto = true;
      etiquetas = [...(l.etiquetas ?? [])];
      valor.definir(l.valor);
      el('desfazer').hidden = true;
      el('nova-etiqueta').value = '';
      // O "repete" mostra como o lançamento está: dentro de uma série viva,
      // fixa ou estimada; fora, não.
      app = await estado.calcular();
      const serie = serieViva(l);
      repeteAntes = serie ? (serie.tipoValor === 'fixa' ? 'fixa' : 'estimada') : 'nao';
      repete = repeteAntes;
      await recarregar();
    },

    /**
     * Abre na conta da área em que a pessoa está: o botão que veste a cor do
     * cartão tem que lançar no cartão (08-telas §4.1).
     */
    async usarConta(id) {
      if (!id) return;
      contaId = id;
      contaTocada = true;
      await recarregar();
    },

    /**
     * Começa um lançamento novo a partir de um previsto do extrato: a
     * ocorrência de uma recorrência que ninguém lançou ainda. Vem tudo
     * preenchido — inclusive o valor, que é o fixo ou a média — e lançar
     * amarra o lançamento à série, o que faz o previsto sumir.
     */
    async preencher(o) {
      editando = null;
      daSerie = o.recorrenciaId;
      previstoDe = o;
      contaTocada = true;
      tipo = o.tipo;
      data = o.dataCompetencia;
      contaId = o.contaId;
      categoriaId = o.categoriaId;
      detalheId = o.detalheId ?? null;
      etiquetas = [...(o.etiquetas ?? [])];
      repete = 'nao';
      repeteAntes = 'nao';
      faturaDesloca = 0;
      el('parcelas').value = '1';
      el('observacao').value = '';
      valor.definir(o.valor);
      el('desfazer').hidden = true;
      await recarregar();
    },

    /** Zera tudo: usado ao reabrir o diálogo depois de fechado. */
    limpar: () => {
      editando = null;
      daSerie = null;
      previstoDe = null;
      contaTocada = false;
      todasCategorias = false;
      etiquetas = [];
      detalheId = null;
      repete = 'nao';
      repeteAntes = 'nao';
      faturaDesloca = 0;
      todasAbertas = false;
      el('parcelas').value = '1';
      el('observacao').value = '';
      valor.limpar();
      el('desfazer').hidden = true;
      pintarData();
      pintarRefino();
      perigo.mostrar(false);
    },
  };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
