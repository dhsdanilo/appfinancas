// A bancada: a tela de gerenciar, onde a estrutura do app se constrói.
// design/04-categorias.md §7 · design/03-alimentacao.md §10
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
import * as log from './core/log.js';
import { novoId } from './core/id.js';
import { deTexto } from './core/dinheiro.js';
import { hoje, saldoReal } from './core/lancamentos.js';
import { usos, podeRemover, podeArquivarConta, acharPorNome } from './core/listas.js';
import { dinheiroHTML } from './app/dinheiro-html.js';
import { instalarServiceWorker } from './app/instalar.js';
import { iniciarSincronia } from './app/sincronia-viva.js';
import { AREAS, areaDaConta, AREAS_COM_CATEGORIA } from './app/areas.js';

const $ = (id) => document.getElementById(id);

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
  for (const aba of document.querySelectorAll('[data-aba]')) {
    const atual = aba.dataset.aba === nome;
    aba.setAttribute('aria-selected', String(atual));
    aba.tabIndex = atual ? 0 : -1;
  }
  for (const painel of document.querySelectorAll('[data-painel]')) {
    painel.hidden = painel.dataset.painel !== nome;
  }
  if (location.hash !== `#${nome}`) history.replaceState(null, '', `#${nome}`);
}

for (const aba of document.querySelectorAll('[data-aba]')) {
  aba.addEventListener('click', () => mostrarAba(aba.dataset.aba));
}

// Seta anda entre abas, que é o que o teclado espera de uma tablist.
document.querySelector('.abas').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const abas = [...document.querySelectorAll('[data-aba]')];
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
  pintarContas();
  pintarCategorias();
  pintarEtiquetas();
  pintarDetalhes();
  pintarDonos();
  pintarContadores();
  pintarProximoPasso();
}

/**
 * O que falta pra começar a lançar, dito uma vez e no lugar certo. Não é
 * convite pra configurar coisa opcional (08-telas §2 proíbe isso) — conta e
 * categoria são o mínimo sem o qual a captura não funciona.
 */
function pintarProximoPasso() {
  const temConta = Object.values(app.contas).some((c) => !c.arquivada);
  const temCategoria = Object.values(app.categorias).some((c) => !c.arquivada);

  dizer($('proximo-contas'), temConta && !temCategoria,
    'As contas estão de pé. Falta uma categoria pra poder lançar — <button type="button" class="elo" data-ir="categorias">criar categorias</button>.');

  dizer($('proximo-categorias'), temCategoria && !temConta,
    'As categorias estão de pé. Falta a conta de onde o dinheiro sai — <button type="button" class="elo" data-ir="contas">criar contas</button>.');
}

function dizer(elemento, mostrar, html) {
  elemento.hidden = !mostrar;
  if (mostrar) elemento.innerHTML = html;
}

document.addEventListener('click', (e) => {
  const atalho = e.target.closest('[data-ir]');
  if (atalho) mostrarAba(atalho.dataset.ir);
});

function pintarContadores() {
  const quantos = {
    contas: Object.values(app.contas).filter((c) => !c.arquivada).length,
    categorias: Object.values(app.categorias).filter((c) => !c.arquivada).length,
    etiquetas: Object.values(app.etiquetas).filter((t) => !t.arquivada).length,
    detalhes: Object.values(app.detalhes ?? {}).filter((d) => !d.arquivado).length,
  };
  for (const [especie, n] of Object.entries(quantos)) {
    document.querySelector(`[data-contador="${especie}"]`).textContent = n || '';
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
const BLOCOS_DE_CONTA = AREAS.map((a) => ({ ...a, titulo: a.titulo.toLowerCase() }));

function pintarContas() {
  const contas = Object.values(app.contas);
  if (!contas.length) {
    $('lista-contas').innerHTML = vazio('Nenhuma conta ainda. Comece pelas que você olha toda semana.');
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
      valor: saldoReal(app, c.id),
      uso: contarUso('contas', c.id),
      arquivada: c.arquivada,
      extras:
        (c.tipo === 'cartao' ? '<button type="button" class="elo" data-acao="ciclo">ciclo</button>' : '') +
        '<button type="button" class="elo" data-acao="saldo-inicial">saldo inicial</button>',
    });
  };

  const ativas = contas.filter((c) => !c.arquivada).sort(porNome);
  const arquivadas = contas.filter((c) => c.arquivada).sort(porNome);

  let html = cabecalhoDeColunas(['conta', 'tipo e dono', 'saldo', 'uso']);

  for (const bloco of BLOCOS_DE_CONTA) {
    const doBloco = ativas.filter((c) => bloco.tipos.includes(c.tipo));
    if (!doBloco.length) continue;
    html += divisor(bloco.titulo, doBloco.length, bloco.id);
    html += doBloco.map(desenhar).join('');
    // Subtotal só quando há o que somar: com uma conta só, ele repetiria a linha.
    if (doBloco.length > 1) {
      const soma = doBloco.reduce((t, c) => t + saldoReal(app, c.id), 0);
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

$('f-categoria').addEventListener('submit', (e) =>
  criar(e, 'categorias', (nome, campos) => [
    'categoria.criada',
    {
      id: novoId('cat'), nome, pai: null, natureza: campos.natureza.value,
      areas: areasDaNova(),
      obrigatoria: campos.natureza.value === 'despesa' && areasDaNova().includes('folha') && campos.obrigatoria.checked,
    },
  ])
);

$('f-etiqueta').addEventListener('submit', (e) =>
  criar(e, 'etiquetas', (nome) => ['etiqueta.criada', { id: novoId('etq'), nome }])
);

$('f-detalhe').addEventListener('submit', (e) =>
  criar(e, 'detalhes', (nome) => ['detalhe.criado', { id: novoId('det'), nome }])
);

$('f-conta').addEventListener('submit', (e) =>
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
    const [tipo, dados] = await montar(nome, campos);
    await estado.aplicarEvento(tipo, dados);

    // O que foi escolhido fica: quem cadastra três receitas seguidas não quer
    // reescolher "receita" três vezes, e a data da conta é a mesma na leva toda.
    const natureza = campos.natureza?.value;
    e.target.reset();
    if (especie === 'contas') {
      campos.data.value = hoje();
      mostrarCamposDeCartao();
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
  // O "criar conta" veste a cor da área do tipo escolhido (09-identidade §3).
  $('f-conta').dataset.area = areaDaConta({ tipo });
  $('campos-cartao').hidden = !cartao;
  $('rotulo-saldo').textContent = cartao ? 'Já na fatura aberta' : 'Saldo de hoje';
  // A dica fala do campo que está na tela: no cartão, não existe "saldo".
  $('dica-conta').innerHTML = cartao
    ? '<strong>O valor é o que já está na fatura aberta hoje</strong>: as compras de antes de o cartão entrar no app. Dali pra frente, cada compra lançada cai na fatura certa sozinha.'
    : DICA_DO_SALDO;
}

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
}

const DICA_DO_SALDO = $('dica-conta').innerHTML;

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

$('dialogo-ciclo').addEventListener('close', async () => {
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

$('f-conta').elements.tipo.addEventListener('change', mostrarCamposDeCartao);

/** As áreas escolhidas no formulário de criar. */
const areasDaNova = () =>
  [...document.querySelectorAll('[data-area-nova][aria-pressed="true"]')].map((b) => b.dataset.areaNova);

function pintarObrigatoriaNova() {
  const despesa = $('f-categoria').elements.natureza.value === 'despesa';
  $('obrigatoria-nova').hidden = !(despesa && areasDaNova().includes('folha'));
}

$('areas-nova').addEventListener('click', (e) => {
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

$('f-categoria').querySelector('.pilulas').addEventListener('click', (e) => {
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

function avisar(mensagem) {
  const el = $('aviso');
  el.textContent = mensagem;
  el.hidden = !mensagem;
}

/** Aviso com o botão que desfaz, ao lado da frase. */
function avisarComAcao(mensagem, botaoHTML) {
  const el = $('aviso');
  el.innerHTML = `${escapar(mensagem)} ${botaoHTML}`;
  el.hidden = false;
}

$('aviso').addEventListener('click', async (e) => {
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
  ligarLista(lista, especie);
}

/**
 * O aparelho se registra sozinho: o id dele vai em cada evento, e pedir isso
 * numa tela de cadastro é burocracia — ninguém abre um app de finanças pra dar
 * nome ao computador. Renomear fica na página de verificação, e o pareamento
 * de verdade é da sincronização (Fase 4).
 */
async function garantirAparelho() {
  if (await log.aparelho()) return;
  const toque = navigator.maxTouchPoints > 1;
  await log.registrarAparelho(toque ? 'Celular' : 'PC');
}

mostrarAba(location.hash.slice(1) || 'contas');
$('f-conta').elements.data.value = hoje();
mostrarCamposDeCartao();
await garantirAparelho();
await recarregar();

instalarServiceWorker();
await iniciarSincronia({ raiz: $('nuvem') });
