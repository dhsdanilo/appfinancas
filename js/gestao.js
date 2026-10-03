// A gestão: onde a estrutura do app se constrói — o que era a "bancada".
// design/04-categorias.md §7 · design/03-alimentacao.md §10
//
// Desde 03/10/2026 ela não é uma tela: cada coisa nasce na tela dela. As contas
// de cada área ficam na página da área ("Suas contas", "Seus cartões", "Seus
// empréstimos"…), com o seu botão de criar; categorias, etiquetas e detalhes
// ficam em Configurações. Este módulo serve às duas, conforme o que a página
// tem.
//
// Três regras que vêm do design e governam tudo aqui:
//   1. Nenhuma lista vem de fábrica. O que vem pronto é o mecanismo.
//   2. O uso de cada item fica à vista — sem o número, arquivar vira palpite,
//      e no palpite ninguém arquiva nada e a lista só cresce.
//   3. Nunca um "não pode" seco: toda recusa vem com o caminho que resolve.
//
// Três listas, três abas. Pessoa não tem tela: o dono é um campo de texto da
// conta, e o app cria a pessoa por trás, a partir desse nome — é o que mantém a
// lente Pessoa (D3) e a divisão (R12) possíveis depois sem pedir cadastro
// nenhum agora. O aparelho também se registra sozinho: quem precisa vê-lo é a
// página de verificação.

import * as estado from './core/estado.js';
import { novoId } from './core/id.js';
import { deTexto } from './core/dinheiro.js';
import { hoje, saldoReal } from './core/lancamentos.js';
import { usos, podeRemover, podeArquivarConta, acharPorNome } from './core/listas.js';
import { dinheiroHTML } from './app/dinheiro-html.js';
import { NOVA_CONTA, CICLO, CONTRATO } from './app/marcacao-gestao.js';
import { AREAS, areaDaConta, AREAS_COM_CATEGORIA, opcoesDeConta } from './app/areas.js';
import { salvarContrato, fotografar } from './app/contrato.js';
import { situacao, saldoDevedor } from './core/divida.js';

const $ = (id) => document.getElementById(id);

// ── a área desta página, quando é uma página de área ──────────────────────

const AREA_DA_PAGINA = {
  contas: 'caixa', cartoes: 'cartoes', renda: 'folha', investimentos: 'investimentos', dividas: 'dividas',
};
const AREA_GESTAO = AREA_DA_PAGINA[document.body.dataset.pagina] ?? null;

const TEXTOS = {
  caixa: { novo: 'Nova conta', lista: 'Suas contas', criar: 'Criar conta', titulo: 'nova conta', exemplo: 'Conta do dia a dia' },
  cartoes: { novo: 'Novo cartão', lista: 'Seus cartões', criar: 'Criar cartão', titulo: 'novo cartão', exemplo: 'Cartão do banco' },
  folha: { novo: 'Nova fonte de renda', lista: 'Suas fontes de renda', criar: 'Criar', titulo: 'nova fonte de renda', exemplo: 'Salário, contrato PJ, atendimentos' },
  investimentos: { novo: 'Novo investimento', lista: 'Seus investimentos', criar: 'Criar', titulo: 'novo investimento', exemplo: 'Corretora, poupança' },
  dividas: { novo: 'Novo empréstimo', lista: 'Seus empréstimos', criar: 'Criar empréstimo', titulo: 'novo empréstimo', exemplo: 'Consignado do banco' },
};

if (AREA_GESTAO && $('gestao')) {
  const t = TEXTOS[AREA_GESTAO];
  $('gestao').innerHTML = `<section class="cartao gestao" data-area="${AREA_GESTAO}">
    <h2>${t.lista}</h2>
    <p class="nota">Toque no nome para renomear. Arquivar tira das telas de lançamento sem apagar o passado.</p>
    <p class="aviso" id="aviso" hidden></p>
    <ul class="itens" id="lista-contas"></ul>
  </section>`;
  document.body.insertAdjacentHTML(
    'beforeend',
    NOVA_CONTA + (AREA_GESTAO === 'cartoes' ? CICLO : '') + (AREA_GESTAO === 'dividas' ? CONTRATO : '')
  );
  // O formulário só oferece os tipos desta área; com um tipo só, nem pergunta.
  const tipos = AREAS.find((a) => a.id === AREA_GESTAO).tipos;
  const select = $('f-conta').elements.tipo;
  for (const op of [...select.options]) if (!tipos.includes(op.value)) op.remove();
  select.closest('.campo').hidden = tipos.length < 2;
  $('titulo-nova-conta').textContent = t.titulo;
  $('f-conta').elements.nome.placeholder = t.exemplo;
  // A fonte de renda não guarda saldo: é passagem, e zera a cada holerite (D25).
  if (AREA_GESTAO === 'folha') {
    for (const nome of ['saldo', 'data']) $('f-conta').elements[nome].closest('.campo').hidden = true;
  }
  $('b-criar-conta').textContent = t.criar;
  $('f-conta').insertAdjacentHTML('beforeend', '<p class="aviso erro" id="aviso-nova-conta" hidden></p>');
  // O botão de criar mora na barra da página, ao lado de lançar e transferir.
  document.querySelector('.acoes-topo')?.insertAdjacentHTML(
    'beforeend',
    `<button type="button" id="b-nova-conta">${t.novo}</button>`
  );
}

const SINGULAR = { contas: 'conta', categorias: 'categoria', etiquetas: 'etiqueta', detalhes: 'detalhe' };

/** O nome do evento: "detalhe" é masculino, as outras listas são femininas. */
const evento = (especie, acao) =>
  `${SINGULAR[especie]}.${especie === 'detalhes' ? acao.replace(/a$/, 'o') : acao}`;

const NOME_DO_TIPO = {
  corrente: 'conta corrente',
  cartao: 'cartão',
  especie: 'espécie',
  investimento: 'investimento',
  divida: 'dívida',
  folha: 'folha',
};

let app = null;
let contagem = null;
let confirmando = null; // "especie:id" esperando o segundo toque do apagar
let fundindo = null; // "especie:id" escolhendo em qual outro fundir

// ── abas ──────────────────────────────────────────────────────────────────

function mostrarAba(nome) {
  if (!$('abas-config')) return;
  for (const aba of $('abas-config').querySelectorAll('[data-aba]')) {
    const atual = aba.dataset.aba === nome;
    aba.setAttribute('aria-selected', String(atual));
    aba.tabIndex = atual ? 0 : -1;
  }
  for (const painel of document.querySelectorAll('[data-painel]')) {
    painel.hidden = painel.dataset.painel !== nome;
  }
  if (location.hash !== `#${nome}`) history.replaceState(null, '', `#${nome}`);
}

for (const aba of $('abas-config')?.querySelectorAll('[data-aba]') ?? []) {
  aba.addEventListener('click', () => mostrarAba(aba.dataset.aba));
}

// Seta anda entre abas, que é o que o teclado espera de uma tablist.
$('abas-config')?.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const abas = [...$('abas-config').querySelectorAll('[data-aba]')];
  const atual = abas.findIndex((a) => a.getAttribute('aria-selected') === 'true');
  const proxima = abas[(atual + (e.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
  mostrarAba(proxima.dataset.aba);
  proxima.focus();
});

// ── pintura ───────────────────────────────────────────────────────────────

async function recarregar() {
  app = await estado.calcular();
  contagem = usos(app);
  pintar();
}

function pintar() {
  pintarPagadoras();
  if ($('lista-contas')) pintarContas();
  if ($('lista-categorias')) pintarCategorias();
  if ($('lista-etiquetas')) pintarEtiquetas();
  if ($('lista-detalhes')) pintarDetalhes();
  if ($('donos')) pintarDonos();
  pintarContadores();
}

function pintarContadores() {
  const quantos = {
    contas: Object.values(app.contas).filter((c) => !c.arquivada).length,
    categorias: Object.values(app.categorias).filter((c) => !c.arquivada).length,
    etiquetas: Object.values(app.etiquetas).filter((t) => !t.arquivada).length,
    detalhes: Object.values(app.detalhes ?? {}).filter((d) => !d.arquivado).length,
  };
  for (const [especie, n] of Object.entries(quantos)) {
    const contador = document.querySelector(`[data-contador="${especie}"]`);
    if (contador) contador.textContent = n || '';
  }
}

function pintarDonos() {
  $('donos').innerHTML = Object.values(app.pessoas)
    .map((p) => `<option value="${escapar(p.nome)}">`)
    .join('');
}

/**
 * Contas em blocos por natureza, com subtotal — é a "faixa" do design virando
 * pixel (09-identidade §7). Uma lista corrida de seis contas não responde
 * "quanto eu tenho em caixa"; três blocos com subtotal respondem sem contar
 * nada na cabeça.
 */
const BLOCOS_DE_CONTA = AREAS.map((a) => ({ ...a, titulo: a.titulo.toLowerCase() }))
  .filter((a) => !AREA_GESTAO || a.id === AREA_GESTAO);

/**
 * O número da conta na lista. Na dívida é o saldo devedor (da foto ou estimado
 * pelo contrato), negativo: é o que se deve.
 */
function valorDaConta(c) {
  if (c.tipo === 'divida') {
    const devedor = saldoDevedor(app, c.id);
    if (devedor != null) return -devedor;
  }
  return saldoReal(app, c.id);
}

function pintarContas() {
  // Na página de uma área, só as contas dela.
  const tiposDaArea = AREA_GESTAO ? AREAS.find((a) => a.id === AREA_GESTAO).tipos : null;
  const contas = Object.values(app.contas).filter((c) => !tiposDaArea || tiposDaArea.includes(c.tipo));
  if (!contas.length) {
    $('lista-contas').innerHTML = vazio(`Nenhuma ainda. Crie no botão "${TEXTOS[AREA_GESTAO]?.novo ?? 'Nova conta'}", lá em cima.`);
    return;
  }

  const desenhar = (c) => {
    const detalhes = [NOME_DO_TIPO[c.tipo] ?? c.tipo];
    if (c.titular && app.pessoas[c.titular]) detalhes.push(app.pessoas[c.titular].nome);
    if (c.tipo === 'cartao') {
      if (c.diaFechamento && c.diaVencimento) {
        detalhes.push(`fecha ${c.diaFechamento} · vence ${c.diaVencimento}`);
      } else {
        // Sem os dois dias o app não sabe a qual fatura a compra pertence, e
        // a compra volta a pesar no dia em que foi feita.
        detalhes.push('sem ciclo');
      }
      const pagadora = app.contas[c.pagaCom];
      if (pagadora) detalhes.push(`paga com ${pagadora.nome}`);
    }
    if (c.tipo === 'divida') {
      const s = situacao(app, c.id);
      if (s) detalhes.push(`${s.parcelasPagas} de ${s.parcelasTotal} parcelas`);
      else detalhes.push('sem contrato');
      const pagadora = app.contas[c.pagaCom];
      if (pagadora) detalhes.push(`paga com ${pagadora.nome}`);
    }
    // A corrente diz quais cartões ela paga: é o vínculo visto do outro lado.
    const pagos = Object.values(app.contas)
      .filter((o) => o.tipo === 'cartao' && o.pagaCom === c.id && !o.arquivada)
      .map((o) => o.nome);
    if (pagos.length) detalhes.push(`paga ${pagos.join(', ')}`);
    return linha({
      especie: 'contas',
      id: c.id,
      nome: c.nome,
      meta: escapar(detalhes.join(' · ')),
      // O saldo de hoje é o número de primeira classe; o inicial é nota de
      // rodapé — e é por isso que o conserto dele mora na ação da linha.
      valor: valorDaConta(c),
      uso: contarUso('contas', c.id),
      arquivada: c.arquivada,
      extras:
        (c.tipo === 'cartao' ? '<button type="button" class="elo" data-acao="ciclo">ciclo</button>' : '') +
        (c.tipo === 'divida'
          ? '<button type="button" class="elo" data-acao="contrato">contrato</button>'
          : '<button type="button" class="elo" data-acao="saldo-inicial">saldo inicial</button>'),
    });
  };

  const ativas = contas.filter((c) => !c.arquivada).sort(porNome);
  const arquivadas = contas.filter((c) => c.arquivada).sort(porNome);

  let html = cabecalhoDeColunas(['conta', 'tipo e dono', AREA_GESTAO === 'dividas' ? 'devedor' : 'saldo', 'uso']);

  for (const bloco of BLOCOS_DE_CONTA) {
    const doBloco = ativas.filter((c) => bloco.tipos.includes(c.tipo));
    if (!doBloco.length) continue;
    // Na página da área o divisor repetiria o título da seção.
    if (!AREA_GESTAO) html += divisor(bloco.titulo, doBloco.length, bloco.id);
    html += doBloco.map(desenhar).join('');
    // Subtotal só quando há o que somar: com uma conta só, ele repetiria a linha.
    if (doBloco.length > 1) {
      const soma = doBloco.reduce((t, c) => t + valorDaConta(c), 0);
      html += subtotal(bloco.titulo, soma);
    }
  }

  if (arquivadas.length) {
    html += divisor('arquivadas', arquivadas.length) + arquivadas.map(desenhar).join('');
  }

  $('lista-contas').innerHTML = html;
}

function pintarCategorias() {
  const categorias = Object.values(app.categorias);
  if (!categorias.length) {
    $('lista-categorias').innerHTML = vazio(
      'Nenhuma ainda. Crie poucas, e crie as que faltarem quando a falta doer.'
    );
    return;
  }

  const bloco = (natureza, titulo) => {
    const lista = categorias.filter((c) => (c.natureza ?? 'despesa') === natureza);
    if (!lista.length) return '';
    return (
      divisor(titulo, lista.length) +
      emBlocos(lista, (c) =>
        linha({
          especie: 'categorias',
          id: c.id,
          nome: c.nome,
          meta: chipsDeArea(c),
          uso: contarUso('categorias', c.id),
          arquivada: c.arquivada,
        })
      )
    );
  };

  $('lista-categorias').innerHTML =
    cabecalhoDeColunas(['categoria', 'aparece em', '', 'uso']) +
    bloco('despesa', 'despesa') +
    bloco('receita', 'receita');
}

const TITULO_DA_AREA = { caixa: 'em caixa', cartoes: 'cartões', folha: 'folha' };

/**
 * Onde a categoria aparece, editável num toque (D26, design/10 §1). Despesa
 * que aparece na folha pode ser obrigatória: IR, previdência.
 */
function chipsDeArea(c) {
  const areas = c.areas ?? ['caixa', 'cartoes'];
  return (
    `<span class="chips-area">` +
    AREAS_COM_CATEGORIA.map(
      (a) =>
        `<button type="button" data-acao="area" data-alvo="${a}" data-area="${a}" aria-pressed="${areas.includes(a)}"><span class="ponto-area" aria-hidden="true"></span>${TITULO_DA_AREA[a]}</button>`
    ).join('') +
    ((c.natureza ?? 'despesa') === 'despesa' && areas.includes('folha')
      ? `<button type="button" class="obrigatoria" data-acao="obrigatoria" aria-pressed="${Boolean(c.obrigatoria)}" title="Fica fora de gasto, como IR e previdência">obrigatória</button>`
      : '') +
    `</span>`
  );
}

async function alternarArea(id, area) {
  const c = app.categorias[id];
  const atuais = c.areas ?? ['caixa', 'cartoes'];
  const novas = atuais.includes(area) ? atuais.filter((a) => a !== area) : [...atuais, area];
  if (!novas.length) {
    // A recusa diz o que resolve.
    return avisar(`${c.nome} precisa aparecer em algum lugar. Para tirá-la de uso, arquive.`);
  }
  const mudancas = { id, areas: AREAS_COM_CATEGORIA.filter((a) => novas.includes(a)) };
  // Saiu da folha, deixa de ser obrigatória: a marca só existe lá.
  if (!novas.includes('folha') && c.obrigatoria) mudancas.obrigatoria = false;
  await estado.aplicarEvento('categoria.alterada', mudancas);
  avisar('');
  await recarregar();
}

function pintarEtiquetas() {
  const etiquetas = Object.values(app.etiquetas);
  $('lista-etiquetas').innerHTML = etiquetas.length
    ? cabecalhoDeColunas(['etiqueta', 'uso']) +
      emBlocos(etiquetas, (t) =>
        linha({
          especie: 'etiquetas',
          id: t.id,
          nome: t.nome,
          uso: contarUso('etiquetas', t.id),
          arquivada: t.arquivada,
          simples: true,
        })
      )
    : vazio('Nenhuma ainda. Elas se aplicam corrigindo um lançamento no extrato.');
}

/**
 * Detalhes: o uso e as categorias onde aparecem — "Mercado X" em Supermercado
 * e em Padaria diz que talvez seja o mesmo lugar com dois nomes.
 */
function pintarDetalhes() {
  const detalhes = Object.values(app.detalhes ?? {}).map((d) => ({ ...d, arquivada: d.arquivado }));
  const onde = new Map();
  for (const l of Object.values(app.lancamentos)) {
    if (l.removido || !l.detalheId || !app.categorias[l.categoriaId]) continue;
    if (!onde.has(l.detalheId)) onde.set(l.detalheId, new Set());
    onde.get(l.detalheId).add(app.categorias[l.categoriaId].nome);
  }
  $('lista-detalhes').innerHTML = detalhes.length
    ? cabecalhoDeColunas(['detalhe', 'categorias', '', 'uso']) +
      emBlocos(detalhes, (d) =>
        linha({
          especie: 'detalhes',
          id: d.id,
          nome: d.nome,
          meta: escapar([...(onde.get(d.id) ?? [])].join(' · ')),
          uso: contarUso('detalhes', d.id),
          arquivada: d.arquivado,
        })
      )
    : vazio('Nenhum ainda. Eles nascem na captura, no bloco "detalhes".');
}

/**
 * Ativas primeiro, arquivadas num bloco próprio no fim. Arquivada misturada no
 * meio é ruído: ela não aparece mais nas telas de lançamento, e quem está
 * organizando a lista quer ver o que está em uso.
 */
function emBlocos(itens, desenhar) {
  const ordenado = [...itens].sort(porNome);
  const ativas = ordenado.filter((i) => !i.arquivada);
  const arquivadas = ordenado.filter((i) => i.arquivada);
  return (
    ativas.map(desenhar).join('') +
    (arquivadas.length
      ? divisor('arquivadas', arquivadas.length) + arquivadas.map(desenhar).join('')
      : '')
  );
}

/** Uma linha da lista: nome editável, o uso à vista e as ações. */
function linha({ especie, id, nome, meta = '', valor = null, uso, arquivada = false, extras = '', simples = false }) {
  const confirmar = confirmando === `${especie}:${id}`;
  const fundir = fundindo === `${especie}:${id}`;
  const destinos = especie === 'contas' ? [] : destinosDeFusao(especie, id);
  const acoes = fundir
    ? `<span class="pergunta">fundir em</span>
       <select class="em-edicao destino-fusao" aria-label="Fundir em qual">${destinos
         .map((d) => `<option value="${escapar(d.id)}">${escapar(d.nome)}</option>`)
         .join('')}</select>
       <button type="button" class="perigo" data-acao="fundir-sim">fundir</button>
       <button type="button" class="elo" data-acao="fundir-nao">não</button>`
    : confirmar
    ? '<span class="pergunta">apagar mesmo?</span>' +
      '<button type="button" class="perigo" data-acao="apagar-sim">apagar</button>' +
      '<button type="button" class="elo" data-acao="apagar-nao">não</button>'
    : extras +
      (destinos.length ? '<button type="button" class="elo" data-acao="fundir">fundir</button>' : '') +
      `<button type="button" class="elo" data-acao="${arquivada ? 'desarquivar' : 'arquivar'}">${arquivada ? 'desarquivar' : 'arquivar'}</button>` +
      '<button type="button" class="elo" data-acao="apagar">apagar</button>';

  // Categoria e etiqueta não têm detalhe nem valor: duas colunas vazias no meio
  // só deixariam um rastro de espaço entre o nome e o uso.
  const meio = simples
    ? ''
    : `<span class="meta">${meta}</span>
    <span class="valor ${valor < 0 ? 'negativo' : ''}">${valor === null ? '' : dinheiroHTML(valor)}</span>`;

  return `<li class="item ${arquivada ? 'arquivada' : ''} ${confirmar || fundir ? 'confirmando' : ''}" data-id="${escapar(id)}">
    <button type="button" class="nome" data-acao="renomear" title="renomear">${escapar(nome)}</button>
    ${meio}
    <span class="uso">${uso}</span>
    <span class="acoes-item">${acoes}</span>
  </li>`;
}

/**
 * Em quem se pode fundir: os outros da mesma lista — e, na categoria, da mesma
 * natureza, porque fundir receita em despesa trocaria o sinal do passado.
 */
function destinosDeFusao(especie, id) {
  const item = app[especie]?.[id];
  if (!item) return [];
  return Object.values(app[especie])
    .filter((o) => o.id !== id)
    .filter((o) => especie !== 'categorias' || (o.natureza ?? 'despesa') === (item.natureza ?? 'despesa'))
    .sort(porNome);
}

/**
 * Fundir move o histórico inteiro para o que fica, e se desfaz (02 §3.15).
 * É a cura do "Mercado" e "Supermercado" criados em aparelhos diferentes.
 */
async function fundirItem(especie, id, item) {
  const para = item.querySelector('.destino-fusao')?.value;
  if (!para) return;
  const nomeDe = app[especie][id].nome;
  const nomePara = app[especie][para].nome;
  const movidos = contagem[especie].get(id) ?? 0;
  const idFusao = novoId('fus');
  await estado.aplicarEvento(evento(especie, 'fundida'), { id: idFusao, de: id, para });
  fundindo = null;
  await recarregar();
  avisarComAcao(
    `"${nomeDe}" agora faz parte de "${nomePara}"${movidos ? ` — ${movidos} lançamento${movidos > 1 ? 's' : ''} foram junto` : ''}.`,
    `<button type="button" class="elo" data-desfazer-fusao="${escapar(idFusao)}">desfazer</button>`
  );
}

function contarUso(especie, id) {
  const n = contagem[especie].get(id) ?? 0;
  if (n === 0) return '<span class="sem-uso">sem uso</span>';
  return `${n} lançamento${n > 1 ? 's' : ''}`;
}

const porNome = (a, b) =>
  a.nome.toLocaleLowerCase('pt-BR') < b.nome.toLocaleLowerCase('pt-BR') ? -1 : 1;

const divisor = (texto, quantos, area = '') =>
  `<li class="divisor"${area ? ` data-area="${area}"` : ''}>${area ? '<span class="ponto-area" aria-hidden="true"></span>' : ''}${escapar(texto)}${quantos ? `<span class="quantos">${quantos}</span>` : ''}</li>`;

/** A última linha do bloco, separada por um fio — 09-identidade §7. */
const subtotal = (titulo, centavos) =>
  `<li class="item subtotal">
    <span class="nome">${escapar(titulo)}</span>
    <span class="meta"></span>
    <span class="valor ${centavos < 0 ? 'negativo' : ''}">${dinheiroHTML(centavos)}</span>
    <span class="uso"></span>
    <span class="acoes-item"></span>
  </li>`;

/** No PC a lista é tabular, e tabela sem cabeçalho faz adivinhar coluna. */
const cabecalhoDeColunas = (titulos) =>
  `<li class="item colunas">${titulos
    .map((t, i) => `<span class="${['nome', 'meta', 'valor', 'uso'][i]}">${escapar(t)}</span>`)
    .join('')}<span class="acoes-item"></span></li>`;
const vazio = (texto) => `<li class="vazio">${escapar(texto)}</li>`;

// ── ações sobre um item ───────────────────────────────────────────────────

function ligarLista(idDaLista, especie) {
  $(idDaLista).addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const item = botao.closest('[data-id]');
    if (!item) return;
    const id = item.dataset.id;

    switch (botao.dataset.acao) {
      case 'renomear': return renomear(especie, id, item);
      case 'arquivar': return arquivar(especie, id, true);
      case 'desarquivar': return arquivar(especie, id, false);
      case 'apagar': return pedirParaApagar(especie, id);
      case 'apagar-sim': return apagar(especie, id);
      case 'apagar-nao': confirmando = null; avisar(''); return pintar();
      case 'saldo-inicial': return corrigirSaldoInicial(id, item);
      case 'area': return alternarArea(id, botao.dataset.alvo);
      case 'obrigatoria':
        await estado.aplicarEvento('categoria.alterada', { id, obrigatoria: !app.categorias[id].obrigatoria });
        return recarregar();
      case 'fundir': fundindo = `${especie}:${id}`; confirmando = null; return pintar();
      case 'fundir-nao': fundindo = null; return pintar();
      case 'fundir-sim': return fundirItem(especie, id, item);
      case 'ciclo': return abrirCiclo(id);
      case 'contrato': return abrirContrato(id);
    }
  });
}

/** Renomear é livre e vale no passado inteiro: o lançamento aponta pro id. */
function renomear(especie, id, item) {
  const botao = item.querySelector('.nome');
  const antes = nomeDe(especie, id);
  const campo = document.createElement('input');
  campo.type = 'text';
  campo.className = 'em-edicao';
  campo.value = antes;
  botao.replaceWith(campo);
  campo.focus();
  campo.select();

  let fechado = false;
  const terminar = async (salvar) => {
    if (fechado) return;
    fechado = true;
    const novo = campo.value.trim();
    if (!salvar || !novo || novo === antes) return pintar();
    await estado.aplicarEvento(evento(especie, 'alterada'), { id, nome: novo });
    avisar('');
    await recarregar();
  };

  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); terminar(true); }
    if (e.key === 'Escape') { e.preventDefault(); terminar(false); }
  });
  campo.addEventListener('blur', () => terminar(true));
}

async function arquivar(especie, id, guardar) {
  if (especie === 'contas' && guardar) {
    const resposta = podeArquivarConta(app, id);
    if (!resposta.pode) {
      return avisar(
        `${nomeDe(especie, id)} ainda tem ${formatarSimples(resposta.saldo)}. Transfira ou ajuste o saldo antes de arquivar — conta guardada com dinheiro dentro faz o total do app mentir.`
      );
    }
  }
  await estado.aplicarEvento(evento(especie, 'arquivada'), {
    id,
    [especie === 'detalhes' ? 'arquivado' : 'arquivada']: guardar,
  });
  avisar('');
  await recarregar();
}

function pedirParaApagar(especie, id) {
  const resposta = podeRemover(app, especie, id);
  const nome = nomeDe(especie, id);

  if (!resposta.pode) {
    // A recusa nunca vem sozinha: ao lado dela está o botão que resolve.
    confirmando = null;
    pintar();
    return avisar(
      especie === 'contas'
        ? `${nome} tem ${resposta.usos} lançamento${resposta.usos > 1 ? 's' : ''}. Conta com passado não se apaga — arquive: ela sai das telas de lançamento e o extrato dela continua existindo.`
        : `${nome} tem ${resposta.usos} lançamento${resposta.usos > 1 ? 's' : ''}. Arquive em vez de apagar — sai das telas de lançamento e continua somando nos relatórios do passado — ou, se for repetido de outro, funda nele.`
    );
  }

  confirmando = `${especie}:${id}`;
  const conta = especie === 'contas' ? app.contas[id] : null;
  avisar(
    conta && conta.saldoInicial
      ? `Apagar ${nome} leva junto o saldo inicial de ${formatarSimples(conta.saldoInicial)}. Ela nunca foi usada, então nada fica órfão.`
      : ''
  );
  pintar();
}

async function apagar(especie, id) {
  await estado.aplicarEvento(evento(especie, 'removida'), { id });
  confirmando = null;
  avisar('');
  await recarregar();
}

/**
 * O saldo inicial não se corrige pela porta do renomear: ele move todo saldo
 * calculado dali pra frente, então tem evento próprio (04-categorias §5).
 */
function corrigirSaldoInicial(id, item) {
  const conta = app.contas[id];
  // No cartão o marco zero é o que já estava na fatura aberta: digita-se o
  // valor da fatura, positivo, e ele entra como dívida (02 §3.2).
  const cartao = conta.tipo === 'cartao';
  const mostrado = cartao ? -(conta.saldoInicial ?? 0) : conta.saldoInicial ?? 0;
  const alvo = item.querySelector('.meta');
  alvo.innerHTML = `<input type="text" class="em-edicao" inputmode="decimal"
      value="${formatarSimples(mostrado).replace('R$ ', '')}"
      aria-label="${cartao ? 'Já na fatura aberta quando o cartão entrou no app' : 'Saldo inicial da conta'}">`;
  const campo = alvo.querySelector('input');
  campo.focus();
  campo.select();

  let fechado = false;
  const terminar = async (salvar) => {
    if (fechado) return;
    fechado = true;
    const digitado = deTexto(campo.value);
    const novo = cartao ? -Math.abs(digitado) : digitado;
    if (!salvar || novo === (conta.saldoInicial ?? 0)) return pintar();
    await estado.aplicarEvento('conta.saldoInicialCorrigido', { id, saldoInicial: novo });
    avisar(
      cartao
        ? `${conta.nome} entrou no app com ${formatarSimples(-novo)} na fatura aberta.`
        : `Saldo inicial de ${conta.nome} agora é ${formatarSimples(novo)} — todo saldo dali pra frente mudou junto.`
    );
    await recarregar();
  };

  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); terminar(true); }
    if (e.key === 'Escape') { e.preventDefault(); terminar(false); }
  });
  campo.addEventListener('blur', () => terminar(true));
}

// ── criar ─────────────────────────────────────────────────────────────────

$('f-categoria')?.addEventListener('submit', (e) =>
  criar(e, 'categorias', (nome, campos) => [
    'categoria.criada',
    {
      id: novoId('cat'), nome, pai: null, natureza: campos.natureza.value,
      areas: areasDaNova(),
      obrigatoria: campos.natureza.value === 'despesa' && areasDaNova().includes('folha') && campos.obrigatoria.checked,
    },
  ])
);

$('f-etiqueta')?.addEventListener('submit', (e) =>
  criar(e, 'etiquetas', (nome) => ['etiqueta.criada', { id: novoId('etq'), nome }])
);

$('f-detalhe')?.addEventListener('submit', (e) =>
  criar(e, 'detalhes', (nome) => ['detalhe.criado', { id: novoId('det'), nome }])
);

$('f-conta')?.addEventListener('submit', (e) =>
  criar(e, 'contas', async (nome, campos) => {
    const tipo = campos.tipo.value;
    const dados = {
      id: novoId('cta'),
      nome,
      tipo,
      titular: await pessoaChamada(campos.dono.value),
      // No cartão o número digitado é o que já está na fatura aberta, e ele
      // entra como dívida (02 §3.2).
      saldoInicial: tipo === 'cartao' ? -Math.abs(deTexto(campos.saldo.value)) : deTexto(campos.saldo.value),
      dataInicial: campos.data.value || hoje(),
    };
    if (tipo === 'divida') {
      // O saldo da dívida é o que se deve: vira a primeira foto, não saldo
      // inicial (design/10 §4.2).
      const devedor = Math.abs(deTexto(campos.saldo.value));
      dados.saldoInicial = 0;
      if (devedor) dados.foto = { data: dados.dataInicial, valor: devedor };
      const contrato = lerContrato(campos);
      if (contrato.erro) {
        avisar(contrato.erro);
        return [null, null];
      }
      if (contrato.valor) {
        return ['conta.criada', dados, async () => {
          app = await estado.calcular();
          await salvarContrato(app, dados.id, contrato.valor, campos.pagaComDivida.value || null);
        }];
      }
    }
    if (tipo === 'cartao') {
      dados.limite = deTexto(campos.limite.value) || null;
      dados.diaFechamento = Number(campos.fechamento.value) || null;
      dados.diaVencimento = Number(campos.vencimento.value) || null;
      dados.pagaCom = campos.pagaCom.value || null;
    }
    return ['conta.criada', dados];
  })
);

/**
 * O dono é texto na tela e pessoa no modelo. Digitou um nome que já existe,
 * reusa; nome novo, cria. "Maria" e "maria" são a mesma pessoa — duas
 * quebrariam a lente Pessoa (D3) sem ninguém perceber.
 */
async function pessoaChamada(texto) {
  const nome = String(texto).trim();
  if (!nome) return null;
  const existente = acharPorNome(app.pessoas, nome);
  if (existente) return existente.id;

  const id = novoId('pes');
  await estado.aplicarEvento('pessoa.criada', { id, nome });
  app = await estado.calcular();
  return id;
}

/**
 * Criar é sempre o mesmo ato: nome não vazio, nome que ainda não existe, e um
 * evento. O nome repetido é barrado na entrada porque "Mercado" e "mercado"
 * convivendo é exatamente o que apodrece relatório depois.
 */
async function criar(e, especie, montar) {
  e.preventDefault();
  const campos = e.target.elements;
  const nome = campos.nome.value.trim();
  if (!nome) return avisar('Falta o nome.');
  if (acharPorNome(app[especie], nome)) {
    return avisar(`Já existe "${nome}" aqui. Renomeie a que existe, se for o caso.`);
  }

  // A gravação é assíncrona, e um segundo Enter antes dela terminar criaria o
  // mesmo item duas vezes — a lista não pode depender da velocidade do dedo.
  const botao = e.target.querySelector('[type="submit"]');
  botao.disabled = true;
  try {
    const [tipo, dados, depois] = await montar(nome, campos);
    if (dados === null) return;
    await estado.aplicarEvento(tipo, dados);
    if (depois) await depois();

    // O que foi escolhido fica: quem cadastra três receitas seguidas não quer
    // reescolher "receita" três vezes, e a data da conta é a mesma na leva toda.
    const natureza = campos.natureza?.value;
    e.target.reset();
    if (especie === 'contas') {
      campos.data.value = hoje();
      mostrarCamposDeCartao();
      // Criada a conta, a janela fecha: a lista embaixo já mostra ela.
      if ($('dialogo-nova-conta')?.open) $('dialogo-nova-conta').close();
    }
    if (natureza) pintarPilulas(natureza);
    avisar('');
    await recarregar();
  } finally {
    botao.disabled = false;
  }
  campos.nome.focus();
}

function mostrarCamposDeCartao() {
  const tipo = $('f-conta').elements.tipo.value;
  const cartao = tipo === 'cartao';
  $('campos-divida').hidden = tipo !== 'divida';
  if (tipo === 'divida') $('rotulo-saldo').textContent = 'Saldo devedor hoje';
  // O "criar conta" veste a cor da área do tipo escolhido (09-identidade §3).
  $('f-conta').dataset.area = areaDaConta({ tipo });
  $('campos-cartao').hidden = !cartao;
  if (tipo !== 'divida') $('rotulo-saldo').textContent = cartao ? 'Já na fatura aberta' : 'Saldo de hoje';
  // A dica fala do campo que está na tela: no cartão, não existe "saldo".
  $('dica-conta').innerHTML = cartao
    ? '<strong>O valor é o que já está na fatura aberta hoje</strong>: as compras de antes de o cartão entrar no app. Dali pra frente, cada compra lançada cai na fatura certa sozinha.'
    : tipo === 'divida'
      ? '<strong>O saldo devedor é o que o banco mostra hoje</strong>, se você souber — é a foto que manda. Sem ele, o app estima pelo contrato.'
      : tipo === 'folha'
        ? '<strong>Uma fonte de renda por origem</strong>: o salário, o contrato PJ, os atendimentos. O holerite de cada uma se lança na tela de Renda.'
        : DICA_DO_SALDO;
}

/**
 * Lê os campos do contrato. Nenhum preenchido: dívida sem contrato (vale, a
 * D22 continua funcionando só com fotos). Algum preenchido: os essenciais
 * passam a ser obrigatórios, e a recusa diz qual falta.
 */
function lerContrato(campos) {
  const parcelas = Number(campos.parcelas.value) || 0;
  const valorParcela = Math.abs(deTexto(campos.valorParcela.value));
  const valorTomado = Math.abs(deTexto(campos.tomado.value));
  const primeira = campos.primeira.value;
  const taxaTexto = campos.taxa.value.trim();
  const algum = parcelas || valorParcela || valorTomado || primeira || taxaTexto;
  if (!algum) return { valor: null };
  if (!valorTomado) return { erro: 'Falta o valor tomado do empréstimo.' };
  if (!parcelas) return { erro: 'Falta o número de parcelas.' };
  if (!valorParcela) return { erro: 'Falta o valor da parcela.' };
  if (!primeira) return { erro: 'Falta a data da primeira parcela.' };
  return {
    valor: {
      valorTomado,
      data: campos.dataContrato.value || primeira,
      parcelas,
      valorParcela,
      primeira,
      // "1,82" % ao mês → 0,0182. Vazio: o app usa a observada ou a implícita.
      taxa: taxaTexto ? Math.abs(deTexto(taxaTexto)) / 10000 : null,
    },
  };
}

// ── o contrato de uma dívida que já existe ────────────────────────────────

let contratoDe = null;

function abrirContrato(id) {
  const c = app.contas[id];
  contratoDe = id;
  const f = $('f-contrato').elements;
  const ct = c.contrato ?? {};
  $('titulo-contrato').textContent = c.nome;
  f.tomado.value = ct.valorTomado ? formatarSimples(ct.valorTomado).replace('R$ ', '') : '';
  f.dataContrato.value = ct.data ?? '';
  f.parcelas.value = ct.parcelas ?? '';
  f.valorParcela.value = ct.valorParcela ? formatarSimples(ct.valorParcela).replace('R$ ', '') : '';
  f.primeira.value = ct.primeira ?? '';
  f.taxa.value = ct.taxa != null ? String((ct.taxa * 100).toFixed(2)).replace('.', ',') : '';
  f.foto.value = '';
  pintarPagadoras();
  f.pagaComDivida.value = c.pagaCom ?? '';
  $('aviso-contrato').hidden = true;
  $('dialogo-contrato').showModal();
  f.tomado.focus();
}

$('f-contrato')?.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'salvar') return;
  e.preventDefault();
  const id = contratoDe;
  const f = $('f-contrato').elements;
  const contrato = lerContrato(f);
  if (contrato.erro || !contrato.valor) {
    $('aviso-contrato').textContent = contrato.erro ?? 'Preencha o contrato.';
    $('aviso-contrato').hidden = false;
    return;
  }
  await salvarContrato(app, id, contrato.valor, f.pagaComDivida.value || null);
  const foto = Math.abs(deTexto(f.foto.value));
  if (foto) await fotografar(id, foto);
  $('dialogo-contrato').close();
  contratoDe = null;
  avisar('');
  await recarregar();
});

/** Quem pode pagar a fatura: as contas de caixa — corrente e espécie. */
function pintarPagadoras() {
  const pagadoras = Object.values(app.contas)
    .filter((c) => !c.arquivada && (c.tipo === 'corrente' || c.tipo === 'especie'))
    .sort(porNome);
  const opcoes =
    '<option value="">—</option>' +
    pagadoras.map((c) => `<option value="${escapar(c.id)}">${escapar(c.nome)}</option>`).join('');
  for (const select of document.querySelectorAll('[data-papel="paga-com"]')) {
    const antes = select.value;
    select.innerHTML = opcoes;
    select.value = antes;
  }
  // A parcela de uma dívida pode sair da corrente, do cartão ou da folha
  // (consignado) — design/10 §4.1.
  const quemPagaDivida = Object.values(app.contas).filter(
    (c) => !c.arquivada && ['corrente', 'especie', 'cartao', 'folha'].includes(c.tipo)
  );
  for (const select of document.querySelectorAll('[data-papel="paga-divida"]')) {
    const antes = select.value;
    select.innerHTML = opcoesDeConta(quemPagaDivida, antes, { vazia: true });
    select.value = antes;
  }
}

const DICA_DO_SALDO = $('dica-conta')?.innerHTML ?? '';

// ── o ciclo de um cartão que já existe ────────────────────────────────────

let cicloDe = null;

function abrirCiclo(id) {
  const c = app.contas[id];
  cicloDe = id;
  const f = $('f-ciclo').elements;
  $('titulo-ciclo').textContent = c.nome;
  f.fechamento.value = c.diaFechamento ?? '';
  f.vencimento.value = c.diaVencimento ?? '';
  f.limite.value = c.limite ? formatarSimples(c.limite).replace('R$ ', '') : '';
  pintarPagadoras();
  f.pagaCom.value = c.pagaCom ?? '';
  $('dialogo-ciclo').showModal();
  f.fechamento.focus();
}

$('dialogo-ciclo')?.addEventListener('close', async () => {
  const id = cicloDe;
  cicloDe = null;
  if (!id || $('dialogo-ciclo').returnValue !== 'salvar') return;

  const c = app.contas[id];
  const f = $('f-ciclo').elements;
  const novo = {
    diaFechamento: Number(f.fechamento.value) || null,
    diaVencimento: Number(f.vencimento.value) || null,
    limite: deTexto(f.limite.value) || null,
    pagaCom: f.pagaCom.value || null,
  };
  // Só o que mudou: "salvou igual" não é evento.
  const mudou = Object.fromEntries(Object.entries(novo).filter(([k, v]) => (c[k] ?? null) !== v));
  if (!Object.keys(mudou).length) return;
  await estado.aplicarEvento('conta.alterada', { id, ...mudou });
  avisar('');
  await recarregar();
});

$('f-conta')?.elements.tipo.addEventListener('change', mostrarCamposDeCartao);

// "Nova conta", "Novo cartão", "Novo empréstimo"… — a janela de criar da área.
$('b-nova-conta')?.addEventListener('click', () => {
  $('f-conta').reset();
  $('f-conta').elements.data.value = hoje();
  avisar('');
  mostrarCamposDeCartao();
  pintarPagadoras();
  $('dialogo-nova-conta').showModal();
  $('f-conta').elements.nome.focus();
});
$('b-cancelar-conta')?.addEventListener('click', () => $('dialogo-nova-conta').close());

/** As áreas escolhidas no formulário de criar. */
const areasDaNova = () =>
  [...document.querySelectorAll('[data-area-nova][aria-pressed="true"]')].map((b) => b.dataset.areaNova);

function pintarObrigatoriaNova() {
  const despesa = $('f-categoria').elements.natureza.value === 'despesa';
  $('obrigatoria-nova').hidden = !(despesa && areasDaNova().includes('folha'));
}

$('areas-nova')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-area-nova]');
  if (!b) return;
  const ligado = b.getAttribute('aria-pressed') === 'true';
  // Pelo menos uma: categoria que não aparece em lugar nenhum não serve.
  if (ligado && areasDaNova().length === 1) return;
  b.setAttribute('aria-pressed', String(!ligado));
  pintarObrigatoriaNova();
});

// Natureza em pílulas, como na captura — select para duas opções é pesado, e
// as duas telas falando a mesma língua valem mais que a economia de código.
function pintarPilulas(natureza) {
  $('f-categoria').elements.natureza.value = natureza;
  for (const b of $('f-categoria').querySelectorAll('[data-natureza]')) {
    b.setAttribute('aria-pressed', String(b.dataset.natureza === natureza));
  }
  pintarObrigatoriaNova();
}

$('f-categoria')?.querySelector('.pilulas').addEventListener('click', (e) => {
  const botao = e.target.closest('[data-natureza]');
  if (botao) pintarPilulas(botao.dataset.natureza);
});

// ── utilidades ────────────────────────────────────────────────────────────

function nomeDe(especie, id) {
  return app[especie][id]?.nome ?? '';
}

/** Texto puro, para as frases de aviso — a versão com centavos menores é HTML. */
function formatarSimples(centavos) {
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const reais = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '−' : ''}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}

/** O aviso vai para onde se está olhando: a janela de criar, se aberta. */
function avisar(mensagem) {
  const el = $('dialogo-nova-conta')?.open ? $('aviso-nova-conta') : $('aviso');
  if (!el) return;
  el.textContent = mensagem;
  el.hidden = !mensagem;
}

/** Aviso com o botão que desfaz, ao lado da frase. */
function avisarComAcao(mensagem, botaoHTML) {
  const el = $('aviso');
  el.innerHTML = `${escapar(mensagem)} ${botaoHTML}`;
  el.hidden = false;
}

$('aviso')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-desfazer-fusao]');
  if (!b) return;
  await estado.aplicarEvento('fusao.desfeita', { id: b.dataset.desfazerFusao });
  avisar('Fusão desfeita: os dois voltaram, cada um com o seu histórico.');
  await recarregar();
});

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── partida ───────────────────────────────────────────────────────────────

for (const [lista, especie] of [
  ['lista-contas', 'contas'],
  ['lista-categorias', 'categorias'],
  ['lista-etiquetas', 'etiquetas'],
  ['lista-detalhes', 'detalhes'],
]) {
  if ($(lista)) ligarLista(lista, especie);
}

mostrarAba(location.hash.slice(1) || 'categorias');
if ($('f-conta')) {
  $('f-conta').elements.data.value = hoje();
  mostrarCamposDeCartao();
}
await recarregar();
// O que muda em outra parte da página (um lançamento, um contrato) muda o uso
// e os saldos daqui.
estado.aoAplicar(() => recarregar());
