// Extrato — R1. A base de tudo: o que aconteceu, e o que ainda vai acontecer.
//
// Em abas pela natureza da conta, sub-abas pela conta, e um período que vale
// para todas (design/08-telas §4.1). Saldo de corrente, fatura de cartão,
// investimento e folha são números diferentes: lado a lado, eles se somariam
// na cabeça de quem lê.

import * as estado from './core/estado.js';
import { dinheiroHTML } from './app/dinheiro-html.js';
import { criarFormulario } from './app/formulario.js';
import { criarTransferencia } from './app/transferencia.js';
import { instalarServiceWorker } from './app/instalar.js';
import { iniciarSincronia } from './app/sincronia-viva.js';
import {
  visiveis, porDataDecrescente, estadoDoLancamento, saldoReal, nomeDaCategoria,
  sinalDeSaida, ehTransferencia, dataVista,
} from './core/lancamentos.js';
import { temCiclo } from './core/cartao.js';
import { AREAS as ABAS } from './app/areas.js';
import {
  faturas, resumoDoCartao, saldoPrevisto, ocorrenciasPrevistas,
} from './core/previsto.js';
import {
  hoje, inicioDoMes, fimDoMes, somarMeses, nomeDoMes, diaCurto,
} from './core/datas.js';

const $ = (id) => document.getElementById(id);

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── a vista: aba, conta e período ─────────────────────────────────────────
//
// A vista não reseta ao navegar (08-telas §5): quem estava olhando uma conta
// volta pra ela. Guardada no aparelho, e só como conveniência — se o
// navegador recusar, a tela abre no padrão e funciona igual.

const CHAVE_VISTA = 'extrato.vista';

function lerVista() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_VISTA) ?? 'null');
    if (v && typeof v === 'object') return v;
  } catch {
    // sem armazenamento: vale o padrão
  }
  return {};
}

const vista = {
  aba: 'caixa',
  conta: 'todas',
  modo: 'mes',
  mes: hoje().slice(0, 7),
  de: inicioDoMes(hoje()),
  ate: hoje(),
  ...lerVista(),
};
// O mês volta sempre ao corrente: abrir o app e cair em março passado
// confunde mais do que ajuda.
vista.mes = hoje().slice(0, 7);

function guardarVista() {
  try {
    localStorage.setItem(CHAVE_VISTA, JSON.stringify({
      aba: vista.aba, conta: vista.conta, modo: vista.modo, de: vista.de, ate: vista.ate,
    }));
  } catch {
    // sem armazenamento: a vista só não sobrevive ao recarregar
  }
}

function intervalo() {
  if (vista.modo === 'intervalo' && vista.de && vista.ate) {
    return vista.de <= vista.ate ? { de: vista.de, ate: vista.ate } : { de: vista.ate, ate: vista.de };
  }
  const dia = `${vista.mes}-01`;
  return { de: dia, ate: fimDoMes(dia) };
}

// ── pintura ───────────────────────────────────────────────────────────────

let app = null;
// Os previstos que estão na tela, pelo id: tocar num deles abre exatamente o
// que se viu, sem refazer a conta com outro intervalo.
const previstosNaTela = new Map();

async function pintar() {
  app = await estado.calcular();
  previstosNaTela.clear();

  const abas = ABAS.filter((a) => contasDaAba(a).length);
  // O menu mostra só o que existe (08-telas §2).
  if (abas.length && !abas.some((a) => a.id === vista.aba)) vista.aba = abas[0].id;
  const aba = ABAS.find((a) => a.id === vista.aba) ?? ABAS[0];
  const contas = contasDaAba(aba);
  if (vista.conta !== 'todas' && !contas.some((c) => c.id === vista.conta)) vista.conta = 'todas';

  // A tela inteira veste a cor da área (09-identidade §3) — inclusive o
  // "novo lançamento", que por isso abre nela.
  $('painel').dataset.area = aba.id;
  $('barra-acoes').dataset.area = aba.id;
  pintarAbas(abas);
  pintarSubabas(contas);
  pintarPeriodo();

  const foco = vista.conta === 'todas' ? contas : contas.filter((c) => c.id === vista.conta);
  if (!abas.length) {
    $('resumo').innerHTML = '<p class="vazio">Nenhuma conta. Crie na <a href="bancada.html">bancada</a>.</p>';
    $('lista').innerHTML = '';
    $('totais').textContent = '';
    return;
  }

  if (aba.id === 'cartoes') {
    pintarResumoDeCartoes(foco);
    pintarListaDeCartoes(foco);
  } else {
    if (aba.id === 'caixa') pintarResumoDeCaixa(foco);
    else pintarResumoDeSaldos(aba, foco);
    pintarLista(aba, foco);
  }
  guardarVista();
}

/**
 * As contas de uma aba. Cartão arquivado continua aparecendo enquanto tiver
 * fatura a pagar: a última fatura do cartão velho ainda é dívida.
 */
function contasDaAba(aba) {
  return Object.values(app.contas)
    .filter((c) => aba.tipos.includes(c.tipo))
    .filter((c) => !c.arquivada || (c.tipo === 'cartao' && (resumoDoCartao(app, c.id)?.divida ?? 0) > 0))
    .sort((a, b) => (a.nome.toLocaleLowerCase('pt-BR') < b.nome.toLocaleLowerCase('pt-BR') ? -1 : 1));
}

function pintarAbas(abas) {
  $('abas').innerHTML = abas
    .map(
      (a) => `<button type="button" role="tab" data-aba="${a.id}" data-area="${a.id}" aria-selected="${a.id === vista.aba}"
        tabindex="${a.id === vista.aba ? 0 : -1}"><span class="ponto-area" aria-hidden="true"></span>${escapar(a.titulo)}</button>`
    )
    .join('');
}

function pintarSubabas(contas) {
  // Com uma conta só, "todas" e ela são a mesma coisa: a sub-aba sairia de
  // enfeite.
  $('subabas').hidden = contas.length < 2;
  $('subabas').innerHTML = [{ id: 'todas', nome: 'Todas' }, ...contas]
    .map(
      (c) => `<button type="button" data-conta="${escapar(c.id)}" aria-pressed="${c.id === vista.conta}">${escapar(c.nome)}</button>`
    )
    .join('');
}

function pintarPeriodo() {
  const porMes = vista.modo === 'mes';
  $('p-antes').hidden = !porMes;
  $('p-depois').hidden = !porMes;
  $('p-rotulo').hidden = !porMes;
  $('p-rotulo').textContent = nomeDoMes(vista.mes);
  $('p-intervalo').hidden = porMes;
  $('p-modo').textContent = porMes ? 'período' : 'mês a mês';
  $('p-modo').setAttribute('aria-expanded', String(!porMes));
  $('p-de').value = vista.de;
  $('p-ate').value = vista.ate;
}

// ── resumos ───────────────────────────────────────────────────────────────

/**
 * Em caixa: o saldo real e, aberto em linhas, o saldo previsto — o número
 * sozinho não é crível (08-telas §6). O previsto é sempre o de hoje até o fim
 * do mês corrente, qualquer que seja o período da lista.
 */
function pintarResumoDeCaixa(contas) {
  const previstos = contas.map((c) => ({ conta: c, p: saldoPrevisto(app, c.id) }));
  const blocos = previstos.map(({ conta, p }) => blocoDeCaixa(conta.nome, p));

  if (previstos.length > 1) {
    const soma = {
      real: previstos.reduce((t, x) => t + x.p.real, 0),
      faturas: [{ cartao: { nome: 'faturas' }, valor: previstos.reduce((t, x) => t + x.p.faturas.reduce((u, f) => u + f.valor, 0), 0) }]
        .filter((f) => f.valor > 0),
      aSair: previstos.reduce((t, x) => t + x.p.aSair, 0),
      ate: previstos[0].p.ate,
      estimado: previstos.some((x) => x.p.estimado),
      previsto: previstos.reduce((t, x) => t + x.p.previsto, 0),
    };
    blocos.unshift(blocoDeCaixa('em caixa', soma, true));
  }
  $('resumo').innerHTML = `<div class="blocos">${blocos.join('')}</div>`;
}

function blocoDeCaixa(nome, p, total = false) {
  const linhas = [
    linhaDeResumo('saldo real', dinheiroHTML(p.real), p.real < 0 ? 'negativo' : ''),
    ...p.faturas.map((f) =>
      linhaDeResumo(total ? f.cartao.nome : `fatura ${f.cartao.nome}`, dinheiroHTML(-f.valor), 'abate')
    ),
  ];
  if (p.aSair > 0) {
    linhas.push(
      linhaDeResumo(`recorrentes e agendados até ${diaCurto(p.ate)}`, dinheiroHTML(-p.aSair, { estimado: p.estimado }), 'abate')
    );
  }
  const temPrevisao = p.faturas.length || p.aSair > 0;
  if (temPrevisao) {
    linhas.push(
      linhaDeResumo('saldo previsto', dinheiroHTML(p.previsto, { estimado: p.estimado }),
        `fecho ${p.previsto < 0 ? 'negativo' : ''}`)
    );
  }
  return `<div class="bloco ${total ? 'total' : ''}">
    <p class="nome-bloco"><span class="ponto-area" aria-hidden="true"></span>${escapar(nome)}</p>
    <dl>${linhas.join('')}</dl>
  </div>`;
}

const linhaDeResumo = (rotulo, valorHTML, classe = '') =>
  `<div class="linha-resumo ${classe}"><dt>${escapar(rotulo)}</dt><dd>${valorHTML}</dd></div>`;

/** Cartões: nunca "saldo" — fatura aberta, fatura fechada e limite livre. */
function pintarResumoDeCartoes(cartoes) {
  $('resumo').innerHTML = `<div class="blocos">${cartoes.map(blocoDeCartao).join('')}</div>`;
}

function blocoDeCartao(c) {
  const pagadora = app.contas[c.pagaCom];
  const rodape = pagadora
    ? `paga com ${escapar(pagadora.nome)}`
    : 'sem conta que paga — <a href="bancada.html#contas">defina o “paga com”</a> pra fatura pesar no saldo previsto';

  if (!temCiclo(c)) {
    return `<div class="bloco">
      <p class="nome-bloco">${escapar(c.nome)}</p>
      <p class="aviso-bloco">Sem dia de fechamento e de vencimento, o app não sabe a qual
        fatura cada compra pertence. <a href="bancada.html#contas">Defina o ciclo na bancada</a>.</p>
      <dl>${linhaDeResumo('em aberto', dinheiroHTML(saldoReal(app, c.id)), saldoReal(app, c.id) < 0 ? 'negativo' : '')}</dl>
    </div>`;
  }

  const r = resumoDoCartao(app, c.id);
  const linhas = [];
  if (r.fechada) {
    linhas.push(
      linhaDeResumo(
        r.fechada.atrasada ? `fatura fechada · venceu ${diaCurto(r.fechada.vencimento)}` : `fatura fechada · vence ${diaCurto(r.fechada.vencimento)}`,
        dinheiroHTML(r.fechada.aPagar),
        'negativo'
      )
    );
  }
  linhas.push(
    linhaDeResumo(
      `fatura aberta · fecha ${diaCurto(r.aberta.fechamento)} · vence ${diaCurto(r.aberta.vencimento)}`,
      dinheiroHTML(r.aberta.aPagar)
    )
  );
  if (r.limiteLivre !== null) {
    linhas.push(linhaDeResumo('limite livre', dinheiroHTML(r.limiteLivre), r.limiteLivre < 0 ? 'negativo' : ''));
  }

  const aPagar = r.fechada?.aPagar || r.aberta.aPagar;
  return `<div class="bloco">
    <p class="nome-bloco">${escapar(c.nome)}</p>
    <dl>${linhas.join('')}</dl>
    <div class="pe-bloco">
      <span class="fino">${rodape}</span>
      <button type="button" class="principal" data-pagar="${escapar(c.id)}" data-valor="${aPagar}"
        ${aPagar > 0 ? '' : 'disabled'}>Pagar fatura</button>
    </div>
  </div>`;
}

/** Investimentos, dívidas e folha: o saldo, e na folha o aviso do zero (D25). */
function pintarResumoDeSaldos(aba, contas) {
  const blocos = contas.map((c) => {
    const saldo = saldoReal(app, c.id);
    const aviso =
      aba.id === 'folha' && saldo !== 0
        ? '<p class="aviso-bloco">Depois do holerite completo, a folha volta a zero. Diferente de zero é desconto esquecido.</p>'
        : '';
    return `<div class="bloco">
      <p class="nome-bloco">${escapar(c.nome)}</p>
      <dl>${linhaDeResumo(aba.id === 'dividas' ? 'saldo devedor' : 'saldo', dinheiroHTML(saldo), saldo < 0 ? 'negativo' : '')}</dl>
      ${aviso}
    </div>`;
  });
  if (contas.length > 1 && aba.id !== 'folha') {
    const soma = contas.reduce((t, c) => t + saldoReal(app, c.id), 0);
    blocos.unshift(`<div class="bloco total">
      <p class="nome-bloco">${escapar(aba.titulo.toLowerCase())}</p>
      <dl>${linhaDeResumo('total', dinheiroHTML(soma), soma < 0 ? 'negativo' : '')}</dl>
    </div>`);
  }
  $('resumo').innerHTML = `<div class="blocos">${blocos.join('')}</div>`;
}

// ── a lista: caixa, investimentos, dívidas, folha ─────────────────────────

/**
 * O que caiu no período nas contas em foco, mais o que ainda vai cair:
 * as ocorrências de recorrência que ninguém lançou e, em caixa, a fatura a
 * pagar na conta que a paga (08-telas §4.1).
 */
function pintarLista(aba, contas) {
  const ids = new Set(contas.map((c) => c.id));
  const { de, ate } = intervalo();
  const noPeriodo = (dia) => dia >= de && dia <= ate;

  const linhas = visiveis(app).filter(
    (l) => (ids.has(l.contaId) || ids.has(l.contaDestinoId)) && noPeriodo(l.dataCaixa)
  );

  for (const o of ocorrenciasPrevistas(app, de, ate)) {
    if ((ids.has(o.contaId) || ids.has(o.contaDestinoId)) && noPeriodo(o.dataCaixa)) linhas.push(o);
  }

  if (aba.id === 'caixa') {
    for (const cartao of Object.values(app.contas)) {
      if (cartao.tipo !== 'cartao' || !ids.has(cartao.pagaCom)) continue;
      for (const f of faturas(app, cartao.id) ?? []) {
        if (f.aPagar <= 0 || !noPeriodo(f.vencimento)) continue;
        linhas.push({
          id: `fatura:${cartao.id}:${f.fechamento}`,
          fatura: f,
          cartaoId: cartao.id,
          tipo: 'pagamento_fatura',
          valor: f.aPagar,
          contaId: cartao.pagaCom,
          contaDestinoId: cartao.id,
          dataCaixa: f.vencimento,
          confirmado: false,
        });
      }
    }
  }

  linhas.sort(porDataDecrescente);

  // Com uma conta em foco, cada linha realizada leva o saldo depois dela — é
  // o extrato que o banco mostra, e o jeito de achar onde a conta divergiu.
  const saldoApos = contas.length === 1 && aba.id !== 'dividas' ? saldosCorridos(contas[0]) : null;

  $('lista').innerHTML = linhas.length
    ? linhas.map((l) => linhaHTML(l, ids, saldoApos)).join('')
    : `<li class="vazio">Nada ${vista.modo === 'mes' ? `em ${nomeDoMes(vista.mes)}` : 'neste período'}.</li>`;
  pintarTotais(linhas, ids);
}

function saldosCorridos(conta) {
  const mapa = new Map();
  let saldo = conta.saldoInicial ?? 0;
  const daConta = visiveis(app)
    .filter((l) => l.confirmado && (l.contaId === conta.id || l.contaDestinoId === conta.id))
    .sort((a, b) => -porDataDecrescente(a, b));
  for (const l of daConta) {
    if (l.contaId === conta.id) saldo -= sinalDeSaida(l);
    if (l.contaDestinoId === conta.id) saldo += l.valor;
    mapa.set(l.id, saldo);
  }
  return mapa;
}

/**
 * O quanto entrou e saiu das contas em foco. Transferência entre duas delas
 * não é nem uma coisa nem outra — dinheiro trocando de bolso dentro do foco.
 * O que ainda não aconteceu fica numa soma à parte, sempre rotulada.
 */
function pintarTotais(linhas, ids) {
  let entrou = 0;
  let saiu = 0;
  let previsto = 0;
  let estimado = false;
  for (const l of linhas) {
    const d = direcao(l, ids);
    if (!d) continue;
    const valor = d === 'entra' ? l.valor : -l.valor;
    if (l.confirmado) {
      if (valor > 0) entrou += valor; else saiu -= valor;
    } else {
      previsto += valor;
      if (l.estimado) estimado = true;
    }
  }
  const partes = [];
  if (entrou) partes.push(`entrou ${dinheiroHTML(entrou)}`);
  if (saiu) partes.push(`saiu ${dinheiroHTML(saiu)}`);
  if (previsto) partes.push(`previsto ${dinheiroHTML(previsto, { estimado, sinal: previsto > 0 ? '+' : '' })}`);
  $('totais').innerHTML = partes.join(' · ');
}

/** 'entra', 'sai' ou null (movimento interno do foco). */
function direcao(l, ids) {
  const deDentro = ids.has(l.contaId);
  const praDentro = ids.has(l.contaDestinoId);
  if (deDentro && praDentro) return null;
  if (praDentro) return 'entra';
  if (!deDentro) return null;
  return sinalDeSaida(l) > 0 ? 'sai' : 'entra';
}

// ── a lista: cartões ──────────────────────────────────────────────────────

/**
 * No cartão o mês é o da fatura — "fatura de novembro" é a que vence em
 * novembro, como o banco chama (08-telas §4.1). As compras vêm agrupadas pela
 * fatura, na data da compra. No período escolhido, valem as compras feitas
 * dentro dele.
 */
function pintarListaDeCartoes(cartoes) {
  const { de, ate } = intervalo();
  const noPeriodo = (dia) => dia >= de && dia <= ate;
  // A fatura que vence neste mês junta compras de até dois meses antes.
  const previstas = ocorrenciasPrevistas(app, somarMeses(de, -2), ate);
  const html = [];
  let total = 0;
  let pago = 0;

  for (const c of cartoes) {
    const pagamentos = visiveis(app).filter((l) => l.contaDestinoId === c.id && noPeriodo(l.dataCaixa));
    pago += pagamentos.reduce((t, l) => t + l.valor, 0);

    if (!temCiclo(c) || vista.modo === 'intervalo') {
      const compras = [
        ...visiveis(app).filter((l) => l.contaId === c.id && noPeriodo(dataVista(l))),
        ...previstas.filter((o) => o.contaId === c.id && noPeriodo(o.dataCompetencia)),
      ];
      total += compras.reduce((t, l) => t + sinalDeSaida(l), 0);
      if (!compras.length && !pagamentos.length) continue;
      html.push(`<li class="grupo">${escapar(c.nome)}</li>`);
      html.push(...ordenarPelaCompra([...compras, ...pagamentos]).map((l) => linhaHTML(l, new Set([c.id]))));
      continue;
    }

    for (const f of faturas(app, c.id)) {
      if (f.vencimento.slice(0, 7) !== vista.mes) continue;
      const projetadas = previstas.filter((o) => o.contaId === c.id && o.cicloFatura === f.fechamento);
      total += f.total + projetadas.reduce((t, o) => t + sinalDeSaida(o), 0);
      const situacao =
        f.situacao === 'aberta' ? 'aberta' : f.situacao === 'futura' ? 'por vir' : f.aPagar > 0 ? 'fechada' : 'paga';
      html.push(`<li class="grupo">
        <span>${escapar(c.nome)} · fatura de ${escapar(nomeDoMes(vista.mes).split(' ')[0])}
          <span class="fino">fecha ${diaCurto(f.fechamento)} · vence ${diaCurto(f.vencimento)} · ${situacao}</span></span>
        <span class="valor-grupo">${dinheiroHTML(f.total)}${f.pago && f.aPagar ? ` <span class="fino">falta ${dinheiroHTML(f.aPagar)}</span>` : ''}</span>
      </li>`);
      const itens = ordenarPelaCompra([...f.itens, ...projetadas, ...pagamentos]);
      html.push(
        ...(itens.length
          ? itens.map((l) => linhaHTML(l, new Set([c.id])))
          : ['<li class="vazio">Nenhuma compra nesta fatura.</li>'])
      );
    }
  }

  $('lista').innerHTML = html.length
    ? html.join('')
    : `<li class="vazio">Nenhuma fatura ${vista.modo === 'mes' ? `vence em ${nomeDoMes(vista.mes)}` : 'neste período'}.</li>`;

  const partes = [];
  if (total) partes.push(`compras ${dinheiroHTML(total)}`);
  if (pago) partes.push(`pago ${dinheiroHTML(pago)}`);
  $('totais').innerHTML = partes.join(' · ');
}

const ordenarPelaCompra = (lista) =>
  lista.sort((a, b) => {
    const da = dataVista(a);
    const db = dataVista(b);
    if (da !== db) return da < db ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

// ── uma linha ─────────────────────────────────────────────────────────────

/**
 * Tipo tem código próprio: marca, cor e sinal (09-identidade §3). A marca vem
 * antes da cor — é ela que carrega o sentido em preto e branco.
 *
 * Uma ação da vida real é UMA linha (08-telas §4): a transferência aparece
 * como origem → destino, nunca como despesa numa conta e receita na outra.
 */
function linhaHTML(l, ids, saldoApos = null) {
  const est = l.projetado || l.fatura ? (l.dataCaixa < hoje() ? 'vencido' : 'previsto') : estadoDoLancamento(l);
  const conta = app.contas[l.contaId];
  const transferencia = ehTransferencia(l);
  const entrada = !transferencia && sinalDeSaida(l) < 0;

  const tom = transferencia ? 'transferencia' : entrada ? 'receita' : 'despesa';
  const marca = transferencia ? '→' : entrada ? '↑' : '↓';
  const nomeDoTom = l.tipo === 'pagamento_fatura' ? 'Pagamento de fatura' : transferencia ? 'Transferência' : entrada ? 'Receita' : 'Despesa';

  // Na transferência o sinal diz se o dinheiro saiu ou entrou no foco.
  const d = direcao(l, ids);
  const sinal = transferencia ? (d === 'entra' ? '+' : d === 'sai' ? '−' : '') : entrada ? '+' : '−';

  const destino = app.contas[l.contaDestinoId];
  const detalhe = l.detalheId ? app.detalhes?.[l.detalheId]?.nome : null;
  let oque;
  let onde;
  if (l.fatura) {
    oque = `Fatura ${destino?.nome ?? ''}`;
    onde = `${conta?.nome ?? '—'} · fecha ${diaCurto(l.fatura.fechamento)}`;
  } else if (transferencia) {
    oque = nomeDoTom;
    onde = `${conta?.nome ?? '—'} → ${destino?.nome ?? '—'}`;
  } else {
    oque = [nomeDaCategoria(app, l.categoriaId) || l.tipo, detalhe].filter(Boolean).join(' · ');
    onde = conta?.nome ?? '—';
  }
  const rotuloEstado = est === 'realizado' ? '' : ` · ${l.projetado ? 'previsto' : est}`;

  const parcela = l.parcela ? `<span class="parcela">${l.parcela.numero}/${l.parcela.total}</span>` : '';
  const etiquetas = (l.etiquetas ?? [])
    .map((t) => app.etiquetas?.[t]?.nome)
    .filter(Boolean)
    .map((e) => `<span class="etiqueta">${escapar(e)}</span>`)
    .join('');
  const dia = dataVista(l);
  const saldo = saldoApos?.has(l.id)
    ? `<span class="saldo-apos ${saldoApos.get(l.id) < 0 ? 'negativo' : ''}">${dinheiroHTML(saldoApos.get(l.id))}</span>`
    : '<span class="saldo-apos"></span>';

  if (l.projetado) previstosNaTela.set(l.id, l);
  const alvo = l.fatura
    ? `data-pagar="${escapar(l.cartaoId)}" data-valor="${l.valor}"`
    : l.projetado
      ? `data-previsto="${escapar(l.id)}"`
      : `data-lanc="${escapar(l.id)}"`;
  const acao = l.fatura ? 'Pagar' : l.projetado ? 'Lançar' : 'Corrigir';

  return `<li><button type="button" class="linha ${tom} ${est === 'realizado' ? '' : est} ${saldoApos ? 'com-saldo' : ''}"
      ${alvo} aria-label="${acao} ${escapar(nomeDoTom.toLowerCase())} de ${escapar(diaCurto(dia))}">
    <span class="marca" title="${nomeDoTom}" aria-hidden="true">${marca}</span>
    <span class="quando">${escapar(diaCurto(dia))}</span>
    <span class="oque">
      <span class="cat">${escapar(oque)}${parcela}${etiquetas}</span>
      <span class="onde">${escapar(onde)}${rotuloEstado}</span>
    </span>
    <span class="quanto ${tom}">${dinheiroHTML(l.valor, { sinal, estimado: Boolean(l.estimado) })}</span>
    ${saldoApos ? saldo : ''}
  </button></li>`;
}

// ── os diálogos ───────────────────────────────────────────────────────────

const dialogo = $('dialogo');

const formulario = await criarFormulario({
  raiz: $('formulario'),
  // No PC se lança sentado: a etiqueta cabe já na captura. No celular, não.
  comEtiquetas: true,
  acoes: [
    { id: 'nova', rotulo: 'Salvar e nova', principal: true, fecha: false },
    { id: 'fechar', rotulo: 'Salvar e fechar', fecha: true },
  ],
  aoSalvar: pintar,
  aoFechar: () => dialogo.close(),
});

// Corrigir e apagar são do andar de cima, nunca do térreo (D11) — então vivem
// aqui, no extrato, e não na captura. O formulário é o mesmo (design/03 §9).
const dialogoEdicao = $('dialogo-edicao');

const edicao = await criarFormulario({
  raiz: $('formulario-edicao'),
  acoes: [{ id: 'salvar', rotulo: 'Salvar', principal: true, fecha: true }],
  aoSalvar: pintar,
  aoFechar: () => dialogoEdicao.close(),
});

// Transferir é outro formulário, porque é outra pergunta: de onde sai, pra onde
// vai e quanto — sem categoria (design/03 §3.1). Pagar fatura é ele também,
// com destino num cartão (§6.2).
const dialogoTransferencia = $('dialogo-transferencia');

const transferencia = await criarTransferencia({
  raiz: $('formulario-transferencia'),
  aoSalvar: pintar,
  aoFechar: () => dialogoTransferencia.close(),
  aoMudarTitulo: (titulo) => { $('titulo-transferencia').textContent = titulo; },
});

async function pagarFatura(cartaoId, centavos) {
  await transferencia.pagarFatura({
    cartaoId,
    origemId: app.contas[cartaoId]?.pagaCom ?? null,
    centavos,
  });
  dialogoTransferencia.showModal();
  transferencia.focar();
}

document.addEventListener('click', async (e) => {
  const pagar = e.target.closest('[data-pagar]');
  if (pagar) {
    await pagarFatura(pagar.dataset.pagar, Number(pagar.dataset.valor) || 0);
    return;
  }

  const previsto = e.target.closest('[data-previsto]');
  if (previsto) {
    // A ocorrência abre a captura já preenchida; lançar amarra à série e o
    // previsto some (03-alimentacao §4).
    const o = previstosNaTela.get(previsto.dataset.previsto);
    if (!o) return;
    formulario.limpar();
    await formulario.preencher(o);
    dialogo.showModal();
    formulario.focar();
    return;
  }

  const linha = e.target.closest('[data-lanc]');
  if (!linha) return;
  const l = app.lancamentos[linha.dataset.lanc];
  if (!l || l.removido) return;

  // Cada tipo volta pro formulário que sabe falar dele.
  if (ehTransferencia(l)) {
    await transferencia.carregar(l);
    dialogoTransferencia.showModal();
    return;
  }
  await edicao.carregar(l);
  dialogoEdicao.showModal();
});

function abrirTransferencia() {
  transferencia.limpar();
  transferencia.recarregar();
  dialogoTransferencia.showModal();
  transferencia.focar();
}

$('b-transferir').addEventListener('click', abrirTransferencia);
$('b-fechar-edicao').addEventListener('click', () => dialogoEdicao.close());
$('b-fechar-transferencia').addEventListener('click', () => dialogoTransferencia.close());

async function abrir() {
  formulario.limpar();
  await formulario.usarConta(contaDaVista());
  dialogo.showModal();
  formulario.focar();
}

/**
 * A conta em que o "novo lançamento" abre: a da sub-aba, se houver uma em
 * foco; em "Todas", a mais usada da área. Trocar continua livre na captura.
 */
function contaDaVista() {
  if (!app) return null;
  if (vista.conta !== 'todas' && app.contas[vista.conta]) return vista.conta;
  const aba = ABAS.find((a) => a.id === vista.aba);
  const contas = aba ? contasDaAba(aba).filter((c) => !c.arquivada) : [];
  if (!contas.length) return null;
  const usos = new Map();
  for (const l of visiveis(app)) usos.set(l.contaId, (usos.get(l.contaId) ?? 0) + 1);
  return [...contas].sort((a, b) => (usos.get(b.id) ?? 0) - (usos.get(a.id) ?? 0))[0].id;
}

$('b-novo').addEventListener('click', abrir);
$('b-fechar').addEventListener('click', () => dialogo.close());

// ── abas, sub-abas e período ──────────────────────────────────────────────

$('abas').addEventListener('click', (e) => {
  const aba = e.target.closest('[data-aba]');
  if (!aba) return;
  vista.aba = aba.dataset.aba;
  vista.conta = 'todas';
  pintar();
});

// Seta anda entre abas, que é o que o teclado espera de uma tablist.
$('abas').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const abas = [...$('abas').querySelectorAll('[data-aba]')];
  const atual = abas.findIndex((a) => a.dataset.aba === vista.aba);
  const proxima = abas[(atual + (e.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
  vista.aba = proxima.dataset.aba;
  vista.conta = 'todas';
  pintar().then(() => $('abas').querySelector(`[data-aba="${vista.aba}"]`)?.focus());
});

$('subabas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-conta]');
  if (!b) return;
  vista.conta = b.dataset.conta;
  pintar();
});

function andarMes(quantos) {
  vista.mes = somarMeses(`${vista.mes}-01`, quantos).slice(0, 7);
  pintar();
}

$('p-antes').addEventListener('click', () => andarMes(-1));
$('p-depois').addEventListener('click', () => andarMes(1));

$('p-modo').addEventListener('click', () => {
  if (vista.modo === 'mes') {
    vista.modo = 'intervalo';
    // O intervalo nasce igual ao mês que estava na tela: trocar de modo não
    // pode trocar o que se vê.
    vista.de = `${vista.mes}-01`;
    vista.ate = fimDoMes(vista.de);
  } else {
    vista.modo = 'mes';
  }
  pintar();
});

for (const campo of ['p-de', 'p-ate']) {
  $(campo).addEventListener('change', () => {
    if (!$(campo).value) return;
    vista[campo === 'p-de' ? 'de' : 'ate'] = $(campo).value;
    pintar();
  });
}

// Atalho global: lançar sem tirar a mão do teclado é o ponto do PC.
document.addEventListener('keydown', (e) => {
  if (dialogo.open || dialogoEdicao.open || dialogoTransferencia.open) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // O alvo pode ser o próprio document (que não tem `matches`), então a
  // verificação precisa ser à prova disso antes de perguntar o que ele é.
  const alvo = e.target;
  if (alvo instanceof Element && alvo.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); abrir(); }
  if (e.key === 't' || e.key === 'T') { e.preventDefault(); abrirTransferencia(); }
});

await pintar();
instalarServiceWorker();

// Sincroniza ao abrir e a cada alteração, em segundo plano (design/06 §3).
await iniciarSincronia({ raiz: $('nuvem') });
estado.aoAplicar(() => pintar());
