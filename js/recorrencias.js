// Recorrências — cadastradas no andar de cima, uma vez (03 §4, 08-telas §7).
//
// A série é entidade separada do lançamento que ela gera (F4): existe sozinha
// para projetar os meses à frente, inclusive os meses em que ninguém lançou
// nada. Aqui ela se cria do zero, se corrige e se encerra. Marcar "repete" na
// captura continua sendo a porta curta pro mesmo lugar.

import * as estado from './core/estado.js';
import { novoId } from './core/id.js';
import { deTexto, formatar } from './core/dinheiro.js';
import { hoje, diaCurto, fimDoMes, somarMeses } from './core/datas.js';
import { visiveis, nomeDaCategoria } from './core/lancamentos.js';
import { ocorrenciasPrevistas, valorDaSerie, proximoReajuste, ultimoReajuste } from './core/previsto.js';
import { dinheiroHTML } from './app/dinheiro-html.js';
import { opcoesDeConta, areaDaConta, categoriaNaArea } from './app/areas.js';

const $ = (id) => document.getElementById(id);

let app = null;
let editando = null;

const NOME_DO_TIPO = { despesa: '↓ despesa', receita: '↑ receita', transferencia: '→ transferência' };

// ── a lista ───────────────────────────────────────────────────────────────

async function pintar() {
  app = await estado.calcular();
  // A série que a primeira versão do contrato de dívida criava não é mais
  // recorrência: a parcela sai do contrato (design/10 §4.4).
  const deContrato = new Set(Object.values(app.contas).map((c) => c.contrato?.recorrenciaId).filter(Boolean));
  const todas = Object.values(app.recorrencias ?? {}).filter((r) => !r.arquivada && !deContrato.has(r.id));
  const ativas = todas.filter((r) => !r.fim || r.fim >= hoje());
  const encerradas = todas.filter((r) => r.fim && r.fim < hoje());

  if (!todas.length) {
    // A tela vazia ensina pelo exemplo (08-telas §9): é a recorrência que mais
    // acelera o app ficar útil, porque é dela que sai a previsão.
    $('lista-recorrencias').innerHTML =
      '<li class="vazio">Nenhuma ainda. Cadastre as contas que voltam todo mês — aluguel, plano de saúde, energia — e o extrato passa a mostrar o que vem pela frente.</li>';
    return;
  }

  const desde = hoje();
  const proximas = ocorrenciasPrevistas(app, desde, fimDoMes(somarMeses(desde, 12)));
  const proxima = (r) => proximas.find((o) => o.recorrenciaId === r.id);

  const linhaHTML = (r) => {
    const daSerie = visiveis(app).filter((l) => l.recorrenciaId === r.id);
    const { valor, estimado } = valorDaSerie(r, daSerie);
    const conta = app.contas[r.contaId];
    const destino = app.contas[r.contaDestinoId];
    const onde = r.tipo === 'transferencia' ? `${conta?.nome ?? '—'} → ${destino?.nome ?? '—'}` : conta?.nome ?? '—';
    const quando = r.periodicidade === 'anual'
      ? `todo ano, ${diaCurto(r.inicio)}`
      : `todo dia ${r.dia}`;
    const p = proxima(r);
    const estado =
      r.fim && r.fim < hoje()
        ? `encerrada em ${diaCurto(r.fim)}`
        : p ? `próxima ${diaCurto(p.dataCompetencia)}` : 'em dia';
    const explica = (r.tipoValor === 'fixa' ? 'fixa' : r.tipo === 'receita' ? 'estimada pelo piso' : 'estimada pela média')
      + (r.caiSozinha ? ' · cai sozinha' : '');
    // O histórico do valor fica à vista: quando mudou, e quanto era.
    const ultimo = ultimoReajuste(r);
    const agendado = proximoReajuste(r);
    const reajustes = [
      ultimo ? `reajustada em ${nomeCurtoDoMes(ultimo.desde)} · era ${formatar(ultimo.antes)}` : '',
      agendado ? `${formatar(agendado.valor)} a partir de ${nomeCurtoDoMes(agendado.desde)}` : '',
    ].filter(Boolean).join(' · ');
    return `<li class="item" data-id="${escapar(r.id)}" data-area="${areaDaConta(conta)}">
      <button type="button" class="nome" data-acao="editar" title="corrigir">
        <span class="ponto-area" aria-hidden="true"></span>${escapar(r.nome)}</button>
      <span class="meta">${escapar(NOME_DO_TIPO[r.tipo] ?? r.tipo)} · ${escapar(onde)} · ${escapar(quando)} · ${escapar(estado)}${reajustes ? `<br><span class="reajustes">${escapar(reajustes)}</span>` : ''}</span>
      <span class="valor">${valor ? dinheiroHTML(valor, { estimado }) : '—'}</span>
      <span class="uso">${escapar(explica)}</span>
      <span class="acoes-item">
        <button type="button" class="elo" data-acao="editar">corrigir</button>
        ${r.tipoValor === 'fixa' ? '<button type="button" class="elo" data-acao="reajustar">reajustar</button>' : ''}
        ${r.fim && r.fim < hoje()
          ? '<button type="button" class="elo" data-acao="retomar">retomar</button>'
          : '<button type="button" class="elo" data-acao="encerrar">encerrar</button>'}
        ${daSerie.length ? '' : '<button type="button" class="elo" data-acao="apagar">apagar</button>'}
      </span>
    </li>`;
  };

  const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  $('lista-recorrencias').innerHTML =
    ativas.sort(porNome).map(linhaHTML).join('') +
    (encerradas.length
      ? `<li class="divisor">encerradas<span class="quantos">${encerradas.length}</span></li>` +
        encerradas.sort(porNome).map(linhaHTML).join('')
      : '');
}

// ── o formulário ──────────────────────────────────────────────────────────

const f = () => $('f-recorrencia').elements;

function tipoEscolhido() {
  return $('f-recorrencia').querySelector('[data-tipo-rec][aria-pressed="true"]')?.dataset.tipoRec ?? 'despesa';
}

function pintarTipo(tipo) {
  for (const b of $('f-recorrencia').querySelectorAll('[data-tipo-rec]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tipoRec === tipo));
  }
  const transf = tipo === 'transferencia';
  $('campo-destino').hidden = !transf;
  $('campo-categoria').hidden = transf;
  const atual = f().categoria.value;
  const conta = app.contas[f().conta.value];
  const categorias = Object.values(app.categorias)
    .filter((c) => !c.arquivada && (c.natureza ?? 'despesa') === tipo && categoriaNaArea(c, conta))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  f().categoria.innerHTML =
    '<option value="">—</option>' +
    categorias.map((c) => `<option value="${escapar(c.id)}">${escapar(c.nome)}</option>`).join('');
  f().categoria.value = categorias.some((c) => c.id === atual) ? atual : '';
  pintarValor();
}

function pintarValor() {
  const fixa = f().tipoValor.value === 'fixa';
  $('rotulo-valor-rec').textContent = fixa ? 'Valor' : 'Primeira estimativa';
  f().valor.placeholder = fixa ? '0,00' : 'opcional';
  $('dica-valor-rec').textContent = fixa
    ? 'Valor travado: plano de saúde, mensalidade, aluguel.'
    : tipoEscolhido() === 'receita'
      ? 'Receita variável é estimada pelo piso — a menor das últimas três. Subestimar a entrada é prudência.'
      : 'Despesa variável é estimada pela média das últimas três cobranças, sempre com ~ na tela.';
  $('dialogo-recorrencia').dataset.area = tipoEscolhido() === 'transferencia' ? 'transferencia' : areaDaConta(app.contas[f().conta.value]);
}

function abrir(r = null) {
  editando = r;
  const contas = Object.values(app.contas).filter((c) => !c.arquivada);
  f().conta.innerHTML = opcoesDeConta(contas, r?.contaId ?? contas[0]?.id);
  f().destino.innerHTML = opcoesDeConta(contas, r?.contaDestinoId, { vazia: true });
  f().nome.value = r?.nome ?? '';
  f().tipoValor.value = r?.tipoValor === 'variavel' ? 'variavel' : 'fixa';
  f().valor.value = r?.valor ? formatar(r.valor, { comPrefixo: false }) : '';
  f().periodicidade.value = r?.periodicidade ?? 'mensal';
  f().dia.value = r?.dia ?? Number(hoje().slice(8, 10));
  f().inicio.value = r?.inicio ?? hoje();
  f().fim.value = r?.fim ?? '';
  f().caiSozinha.checked = Boolean(r?.caiSozinha);
  $('campo-dia').hidden = f().periodicidade.value === 'anual';
  $('titulo-recorrencia').textContent = r ? 'Corrigir recorrência' : 'Nova recorrência';
  $('aviso-recorrencia').hidden = true;
  pintarTipo(r?.tipo ?? 'despesa');
  if (r) f().categoria.value = r.categoriaId ?? '';
  $('dialogo-recorrencia').showModal();
  f().nome.focus();
}

function recusar(texto) {
  $('aviso-recorrencia').textContent = texto;
  $('aviso-recorrencia').hidden = false;
}

async function salvar(e) {
  e.preventDefault();
  const tipo = tipoEscolhido();
  const anual = f().periodicidade.value === 'anual';
  const inicio = f().inicio.value || hoje();
  const dados = {
    nome: f().nome.value.trim(),
    tipo,
    contaId: f().conta.value || null,
    contaDestinoId: tipo === 'transferencia' ? f().destino.value || null : null,
    categoriaId: tipo === 'transferencia' ? null : f().categoria.value || null,
    tipoValor: f().tipoValor.value,
    valor: deTexto(f().valor.value) ? Math.abs(deTexto(f().valor.value)) : null,
    periodicidade: anual ? 'anual' : 'mensal',
    // No anual, o dia e o mês são os do início: "todo ano em 15/01".
    dia: anual ? Number(inicio.slice(8, 10)) : Math.min(31, Math.max(1, Number(f().dia.value) || 1)),
    inicio,
    fim: f().fim.value || null,
    // Anual é o gasto esporádico: a R3 não acusa descontrole no mês do IPVA.
    esporadica: anual,
    caiSozinha: f().caiSozinha.checked,
  };
  // "Cai sozinha" vale do dia em que se liga em diante: não preenche os meses
  // que já passaram (design/13 §1).
  if (dados.caiSozinha && !editando?.caiSozinha) dados.caiSozinhaDesde = hoje();

  // A recusa diz o que falta, sempre.
  if (!dados.contaId) return recusar('Falta a conta.');
  if (tipo === 'transferencia' && (!dados.contaDestinoId || dados.contaDestinoId === dados.contaId)) {
    return recusar('Transferência precisa de duas contas diferentes.');
  }
  if (tipo !== 'transferencia' && !dados.categoriaId) return recusar('Falta a categoria.');
  if (dados.tipoValor === 'fixa' && !dados.valor) return recusar('Recorrência fixa precisa do valor.');
  if (!dados.nome) {
    dados.nome = tipo === 'transferencia'
      ? `${app.contas[dados.contaId].nome} → ${app.contas[dados.contaDestinoId].nome}`
      : nomeDaCategoria(app, dados.categoriaId);
  }

  if (editando) {
    const mudou = Object.fromEntries(
      Object.entries(dados).filter(([k, v]) => (editando[k] ?? null) !== v)
    );
    if (Object.keys(mudou).length) await estado.aplicarEvento('recorrencia.alterada', { id: editando.id, ...mudou });
  } else {
    await estado.aplicarEvento('recorrencia.criada', { id: novoId('rec'), ...dados });
  }
  $('dialogo-recorrencia').close();
  await pintar();
}

// ── eventos ───────────────────────────────────────────────────────────────

$('b-nova-recorrencia').addEventListener('click', () => abrir());
$('f-recorrencia').addEventListener('submit', salvar);
$('b-cancelar-recorrencia').addEventListener('click', () => $('dialogo-recorrencia').close());
$('f-recorrencia').querySelector('.pilulas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tipo-rec]');
  if (b) pintarTipo(b.dataset.tipoRec);
});
f().tipoValor.addEventListener('change', pintarValor);
// Outra conta pode ser outra área, e outras categorias (D26).
f().conta.addEventListener('change', () => pintarTipo(tipoEscolhido()));
f().periodicidade.addEventListener('change', () => {
  $('campo-dia').hidden = f().periodicidade.value === 'anual';
});

$('lista-recorrencias').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acao]');
  const id = e.target.closest('[data-id]')?.dataset.id;
  if (!b || !id) return;
  const r = app.recorrencias[id];
  if (!r) return;
  switch (b.dataset.acao) {
    case 'editar':
      return abrir(r);
    case 'reajustar':
      return abrirReajuste(r);
    case 'encerrar':
      // Encerrar não apaga nada: os lançamentos que ela gerou continuam, e
      // a projeção para daqui pra frente.
      await estado.aplicarEvento('recorrencia.alterada', { id, fim: hoje() });
      break;
    case 'retomar':
      await estado.aplicarEvento('recorrencia.alterada', { id, fim: null });
      break;
    case 'apagar':
      await estado.aplicarEvento('recorrencia.removida', { id });
      break;
  }
  await pintar();
});

// ── reajuste (design/10 §7) ───────────────────────────────────────────────

let reajustando = null;

const nomeCurtoDoMes = (dia) => `${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

function abrirReajuste(r) {
  reajustando = r;
  const desde = hoje();
  const proxima = ocorrenciasPrevistas(app, desde, fimDoMes(somarMeses(desde, 12))).find((o) => o.recorrenciaId === r.id);
  $('titulo-reajuste').textContent = r.nome;
  $('f-reajuste').elements.valor.value = '';
  // O padrão é a próxima ocorrência: o reajuste que se informa hoje vale da
  // próxima conta em diante.
  $('f-reajuste').elements.desde.value = proxima?.dataCompetencia ?? desde;
  const valores = r.valores?.length ? r.valores : [{ desde: r.inicio, valor: r.valor }];
  $('historico-reajuste').innerHTML = valores
    .map((v) => `<li>${escapar(formatar(v.valor))} <span class="fino">desde ${escapar(nomeCurtoDoMes(v.desde))}</span></li>`)
    .join('');
  $('aviso-reajuste').hidden = true;
  $('dialogo-reajuste').showModal();
  $('f-reajuste').elements.valor.focus();
}

$('f-reajuste').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valor = Math.abs(deTexto($('f-reajuste').elements.valor.value));
  const desde = $('f-reajuste').elements.desde.value;
  if (!valor || !desde) {
    $('aviso-reajuste').textContent = !valor ? 'Falta o valor novo.' : 'Falta a data a partir da qual vale.';
    $('aviso-reajuste').hidden = false;
    return;
  }
  await estado.aplicarEvento('recorrencia.reajustada', { id: reajustando.id, desde, valor });
  $('dialogo-reajuste').close();
  reajustando = null;
  await pintar();
});
$('b-cancelar-reajuste').addEventListener('click', () => $('dialogo-reajuste').close());

estado.aoAplicar(() => pintar());
document.addEventListener('app:tela', (e) => {
  if (e.detail.tela === 'planejamento') pintar();
});
await pintar();

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
