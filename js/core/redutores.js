// Redutores: como cada evento muda o estado.
//
// O estado NÃO é armazenado — é calculado lendo os eventos em ordem
// (design/02-modelo-de-dados.md §2). Cada redutor recebe o rascunho do estado e
// o altera no lugar; a ordem de aplicação é garantida por quem chama.
//
// Cobertos: pessoa, conta, categoria, lançamento, recorrência, ativo e
// envelope (com as alocações: o aporte e o resgate do envelope).

import { datarNoCartao, temCiclo } from './cartao.js';

/** As áreas de uma categoria nova, quando ninguém disse outra coisa. */
export const AREAS_PADRAO = ['caixa', 'cartoes'];

/**
 * Versão da FORMA do estado derivado — diferente da versão do formato dos
 * eventos (formato.js).
 *
 * Os eventos no disco podem continuar idênticos enquanto o estado calculado
 * ganha um campo novo: foi o que aconteceu ao acrescentar `categorias` e
 * `lancamentos`. Sem este número, o estado consolidado gravado com a forma
 * antiga continuaria sendo aceito, e o código novo quebraria num campo que não
 * existe lá dentro.
 *
 * **Suba este número sempre que mexer em `estadoVazio()` ou na forma que um
 * redutor produz.** O cache é descartável: subir aqui custa um recálculo.
 */
export const VERSAO_ESTADO = 24;

export function estadoVazio() {
  return {
    pessoas: {},
    contas: {},
    categorias: {},
    etiquetas: {},
    detalhes: {},
    recorrencias: {},
    // Os ativos das contas de investimento: o CDB, o Tesouro, a ação
    // (design/10 §3). O que eles valem sai das operações e das avaliações.
    ativos: {},
    lancamentos: {},
    // Dinheiro com destino declarado (design/11). De quem é cada pedaço sai
    // das alocações — o aporte e o resgate do envelope — e dos `donos` de cada
    // movimento entre lugares.
    envelopes: {},
    alocacoes: {},
    // O que o texto do banco vira (design/13 §2), e as linhas de extrato que
    // se mandou ignorar ("conta|número do banco"), para não voltarem.
    regras: {},
    importIgnorados: {},
    // As seleções salvas do Explorar (design/14, D32): categorias, etiquetas,
    // descrições e contas com um nome. Só leitura de lançamento, nunca escrita.
    selecoes: {},
    // Fusões feitas, com o que foi movido — é o que permite desfazer (02 §3.15).
    fusoes: {},
    // Tipos de evento que este app não conhece. Não é erro fatal (um aparelho
    // mais novo pode ter emitido algo), mas precisa ficar VISÍVEL — dado
    // financeiro ignorado em silêncio é a pior falha possível.
    desconhecidos: {},
  };
}

export const redutores = {
  // ── pessoa ──────────────────────────────────────────────────────────────

  'pessoa.criada'(e, d) {
    e.pessoas[d.id] = {
      id: d.id,
      nome: d.nome,
      contaPadrao: d.contaPadrao ?? null,
    };
  },

  'pessoa.alterada'(e, d) {
    const p = e.pessoas[d.id];
    if (!p) return;
    if (d.nome !== undefined) p.nome = d.nome;
    if (d.contaPadrao !== undefined) p.contaPadrao = d.contaPadrao;
  },

  // ── conta ───────────────────────────────────────────────────────────────

  'conta.criada'(e, d) {
    e.contas[d.id] = {
      id: d.id,
      nome: d.nome,
      tipo: d.tipo, // corrente · cartao · especie · investimento · divida · folha
      titular: d.titular ?? null,
      saldoInicial: d.saldoInicial ?? 0,
      dataInicial: d.dataInicial ?? null,
      arquivada: false,
      // A última conferência com o banco ou a carteira (02 §3.12). A R16 cobra
      // quando passa de um mês.
      conferidaEm: null,
      ultimaConferencia: null,
      // Só em cartão (D13)
      limite: d.limite ?? null,
      diaFechamento: d.diaFechamento ?? null,
      diaVencimento: d.diaVencimento ?? null,
      // A conta que paga a fatura: é o que faz a fatura pesar no saldo
      // previsto dela (03-alimentacao §6.2).
      pagaCom: d.pagaCom ?? null,
      // Só em folha: para onde vai o líquido do holerite (design/10 §2).
      liquidoPara: d.liquidoPara ?? null,
      // Só em dívida: o contrato (design/10 §4) e as fotos do saldo devedor
      // que o banco informa (02 §3.11). A foto manda; o contrato estima entre
      // uma e outra.
      contrato: d.contrato ?? null,
      fotos: d.foto ? [d.foto] : [],
      // As amortizações feitas, com o resultado escolhido no dia, e as
      // parcelas que não foram debitadas (design/10 §4.4).
      amortizacoes: [],
      parcelasPuladas: [],
      parcelasCorrigidas: {},
      // Só em investimento: onde fica o dinheiro dela (design/10 §3.6). Nulo
      // é a própria corretora, com caixa parado; o id de uma corrente é o
      // banco — aplicar sai dela, resgatar volta para ela.
      caixaEm: d.caixaEm ?? null,
      // Só em investimento (D16)
      risco: d.risco ?? null,
      liquidez: d.liquidez ?? null,
    };
  },

  'conta.alterada'(e, d, evento) {
    const c = e.contas[d.id];
    if (!c) return;
    const cicloAntes = temCiclo(c) ? `${c.diaFechamento}/${c.diaVencimento}` : null;
    for (const campo of [
      'nome',
      'titular',
      'limite',
      'diaFechamento',
      'diaVencimento',
      'pagaCom',
      'liquidoPara',
      'contrato',
      'caixaEm',
      // O cofrinho que guarda, de antemão, o que o cartão deve (design/11 §9).
      'cofrinhoId',
      'cofrinhoAtivoId',
      'risco',
      'liquidez',
      // O número da conta no arquivo do banco: a segunda importação já sabe qual é.
      'importId',
    ]) {
      if (d[campo] !== undefined) c[campo] = d[campo];
    }
    // tipo, saldoInicial e dataInicial não mudam por aqui de propósito:
    // mexem em saldo histórico e precisam de evento próprio, deliberado.

    const cicloDepois = temCiclo(c) ? `${c.diaFechamento}/${c.diaVencimento}` : null;
    if (cicloDepois === cicloAntes) return;
    // Mudou o ciclo: refaz só as faturas que ainda não tinham fechado no dia
    // da mudança. Fatura fechada é passado — o banco também não a refaz
    // (03-alimentacao §6.2). Lançamento que nunca teve ciclo entra agora.
    const dia = evento?.t ? evento.t.slice(0, 10) : '';
    for (const l of Object.values(e.lancamentos)) {
      if (l.contaId !== c.id) continue;
      if (l.cicloFatura && l.cicloFatura <= dia) continue;
      datarNoCartao(l, c);
    }
  },

  'conta.saldoInicialCorrigido'(e, d) {
    // Evento próprio, e deliberado, porque mexe em saldo histórico: corrigir o
    // marco zero muda todo saldo calculado dali pra frente. O design avisa que
    // este é o campo que todo mundo erra (04-categorias §5) — então ele tem
    // conserto, mas não pela porta do "renomear".
    const c = e.contas[d.id];
    if (!c) return;
    if (d.saldoInicial !== undefined) c.saldoInicial = d.saldoInicial;
    if (d.dataInicial !== undefined) c.dataInicial = d.dataInicial;
  },

  'conta.arquivada'(e, d) {
    const c = e.contas[d.id];
    if (c) c.arquivada = d.arquivada !== false;
  },

  'conta.fotografada'(e, d, evento) {
    // A foto do saldo: o número que o banco mostra, com a data. Uma por dia —
    // a mais nova do dia substitui a anterior. O `lc` diz o que veio antes no
    // mesmo dia: a foto tirada antes de amortizar não apaga a amortização.
    const c = e.contas[d.id];
    if (!c) return;
    c.fotos = [...(c.fotos ?? []).filter((f) => f.data !== d.data), { data: d.data, valor: d.valor, lc: evento?.lc ?? null }]
      .sort((a, b) => (a.data < b.data ? -1 : 1));
  },

  'divida.amortizada'(e, d, evento) {
    // A amortização guarda o resultado escolhido no dia — quantas parcelas
    // sobraram, ou a parcela nova —, e o calendário passa a segui-lo. A
    // transferência que levou o dinheiro é lançamento comum, à parte.
    const c = e.contas[d.id];
    if (!c) return;
    c.amortizacoes = [
      ...(c.amortizacoes ?? []).filter((a) => a.lancamentoId !== d.lancamentoId),
      {
        lancamentoId: d.lancamentoId ?? null,
        data: d.data,
        valor: d.valor,
        modo: d.modo,
        restantes: d.restantes ?? null,
        ultima: d.ultima ?? null,
        parcela: d.parcela ?? null,
        lc: evento?.lc ?? null,
      },
    ].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  },

  'divida.parcelaCorrigida'(e, d) {
    // A parcela que o banco cobrou diferente — valor, dia ou conta. Continua
    // automática (cai no dia, sem pendência); só ela muda, o contrato não.
    // Com d.desfazer, volta a ser a do contrato.
    const c = e.contas[d.id];
    if (!c) return;
    const corrigidas = { ...(c.parcelasCorrigidas ?? {}) };
    if (d.desfazer) delete corrigidas[d.k];
    else corrigidas[d.k] = { valor: d.valor ?? null, data: d.data ?? null, contaId: d.contaId ?? null };
    c.parcelasCorrigidas = corrigidas;
  },

  'divida.parcelaPulada'(e, d) {
    // "Não foi debitada": a parcela automática daquele número não cai. Volta
    // com d.pulada === false.
    const c = e.contas[d.id];
    if (!c) return;
    const puladas = new Set(c.parcelasPuladas ?? []);
    if (d.pulada === false) puladas.delete(d.k);
    else puladas.add(d.k);
    c.parcelasPuladas = [...puladas].sort((a, b) => a - b);
  },

  'conta.conferida'(e, d) {
    // A conferência fica registrada sempre; a conta só ganha "conferida em"
    // quando o saldo bateu (ou foi ajustado, na espécie) — 03 §8.
    const c = e.contas[d.id];
    if (!c) return;
    c.ultimaConferencia = { data: d.data, saldoInformado: d.saldoInformado, bateu: Boolean(d.bateu) };
    if (d.bateu) c.conferidaEm = d.data;
  },

  // ── ativo ───────────────────────────────────────────────────────────────
  //
  // O papel, o título, a aplicação dentro de uma conta de investimento
  // (design/10 §3). Aplicar, resgatar e provento são lançamentos com
  // `ativoId`; o valor de hoje é uma avaliação, como a foto do saldo.

  'ativo.criado'(e, d) {
    e.ativos[d.id] = {
      id: d.id,
      contaId: d.contaId,
      nome: d.nome,
      classe: d.classe ?? 'renda_fixa',
      // 'valor' (CDB, Tesouro: acompanha-se o valor total) ou 'cotas' (ação,
      // FII, cripto: quantidade e preço por unidade).
      unidade: d.unidade ?? 'valor',
      vencimento: d.vencimento ?? null,
      avaliacoes: [],
      arquivado: false,
    };
  },

  'ativo.alterado'(e, d) {
    const a = e.ativos[d.id];
    if (!a) return;
    for (const campo of ['nome', 'classe', 'vencimento', 'contaId', 'unidade']) {
      if (d[campo] !== undefined) a[campo] = d[campo];
    }
  },

  'ativo.avaliado'(e, d, evento) {
    // O valor de hoje, informado: uma por dia, a mais nova substitui. No
    // ativo por cotas vem o preço de uma unidade (a cotação), não o total.
    const a = e.ativos[d.id];
    if (!a) return;
    a.avaliacoes = [...a.avaliacoes.filter((v) => v.data !== d.data), { data: d.data, valor: d.valor ?? null, preco: d.preco ?? null, lc: evento?.lc ?? null }]
      .sort((x, y) => (x.data < y.data ? -1 : 1));
  },

  'ativo.arquivado'(e, d) {
    const a = e.ativos[d.id];
    if (a) a.arquivado = d.arquivado !== false;
  },

  'ativo.removido'(e, d) {
    delete e.ativos[d.id];
  },

  // ── envelope (design/11) ────────────────────────────────────────────────
  //
  // Projeto tem data (IPVA 2027, viagem); o que acumula, não (reserva,
  // aposentadoria). Sem campo `tipo`: o comportamento vem do que está
  // preenchido (D20, design/11 §1).

  'envelope.criado'(e, d) {
    e.envelopes ??= {};
    e.envelopes[d.id] = {
      id: d.id,
      nome: d.nome,
      inicio: d.inicio ?? null,
      alvoValor: d.alvoValor ?? null,
      alvoData: d.alvoData ?? null,
      // Os lugares que são inteiros dele: o que chega ali sem dono é dele.
      inteiros: d.inteiros ?? [],
      // Data em que VOCÊ declarou o fim (D18): o único estado guardado.
      encerradoEm: null,
      arquivado: false,
    };
  },

  'envelope.encerrado'(e, d) {
    const v = e.envelopes?.[d.id];
    if (v) v.encerradoEm = d.data;
  },

  'envelope.reaberto'(e, d) {
    const v = e.envelopes?.[d.id];
    if (v) v.encerradoEm = null;
  },

  'envelope.alterado'(e, d) {
    const v = e.envelopes?.[d.id];
    if (!v) return;
    for (const campo of ['nome', 'inicio', 'alvoValor', 'alvoData', 'inteiros']) {
      if (d[campo] !== undefined) v[campo] = d[campo];
    }
    // Um lugar é inteiro de um envelope só.
    if (d.inteiros) {
      for (const outro of Object.values(e.envelopes)) {
        if (outro.id !== v.id) outro.inteiros = outro.inteiros.filter((l) => !d.inteiros.includes(l));
      }
    }
  },

  'envelope.arquivado'(e, d) {
    const v = e.envelopes?.[d.id];
    if (v) v.arquivado = d.arquivado !== false;
  },

  'envelope.removido'(e, d) {
    // Só chega aqui o envelope que nunca recebeu nada.
    delete e.envelopes?.[d.id];
  },

  // A alocação: muda o dono do dinheiro num lugar, sem mexer em saldo de
  // conta nenhuma (02 §3.6, design/11 §3). de nulo = vem do sem dono (aporte);
  // para nulo = volta ao sem dono (resgate); os dois = remanejamento.
  'envelope.alocado'(e, d, evento) {
    e.alocacoes ??= {};
    e.alocacoes[d.id] = {
      // A ordem do registro: no mesmo dia, aporte e movimento valem na ordem
      // em que foram feitos (design/11 §4).
      lc: evento?.lc ?? 0,
      id: d.id,
      lugarId: d.lugarId,
      de: d.de ?? null,
      para: d.para ?? null,
      valor: d.valor,
      data: d.data,
      removida: false,
    };
  },

  'envelope.alocacaoRemovida'(e, d) {
    const a = e.alocacoes?.[d.id];
    if (a) a.removida = true;
  },

  // ── regras e importação (design/13) ─────────────────────────────────────

  // Uma regra por texto limpo: o id é o próprio texto, então redefinir é
  // substituir, e os dois celulares chegam à mesma regra.
  'regra.definida'(e, d) {
    e.regras ??= {};
    e.regras[d.id] = {
      id: d.id,
      padrao: d.padrao,
      categoriaId: d.categoriaId ?? null,
      detalheId: d.detalheId ?? null,
      etiquetas: d.etiquetas ?? [],
      transferePara: d.transferePara ?? null,
    };
  },

  'regra.removida'(e, d) {
    delete e.regras?.[d.id];
  },

  // ── seleções do Explorar (design/14) ──────────────────────────────────────

  // Salvar de novo com o mesmo id atualiza: é assim que "salvar" edita.
  'selecao.salva'(e, d) {
    e.selecoes ??= {};
    e.selecoes[d.id] = {
      id: d.id,
      nome: d.nome,
      categorias: d.categorias ?? [],
      etiquetas: d.etiquetas ?? [],
      descricoes: d.descricoes ?? [],
      contas: d.contas ?? [],
      cruzar: Boolean(d.cruzar),
      // Como a seleção se mostra: período, mês ou ano, gasto ou renda, e o
      // agrupamento da lista (design/12 §0).
      vista: d.vista ?? null,
    };
  },

  'selecao.removida'(e, d) {
    delete e.selecoes?.[d.id];
  },

  'importacao.ignorada'(e, d) {
    e.importIgnorados ??= {};
    for (const f of d.fitids ?? []) e.importIgnorados[`${d.contaId}|${f}`] = true;
  },

  // ── categoria ───────────────────────────────────────────────────────────

  'categoria.criada'(e, d) {
    e.categorias[d.id] = {
      id: d.id,
      nome: d.nome,
      pai: d.pai ?? null,          // nulo = é grupo (04-categorias §2)
      natureza: d.natureza ?? 'despesa',
      // Onde a categoria aparece (D26, design/10 §1). Categoria antiga, de
      // antes disto existir, vale para o dia a dia: em caixa e cartões.
      areas: d.areas ?? AREAS_PADRAO,
      // Só em despesa de folha: IR, previdência oficial. Fica fora de "gasto",
      // e a renda disponível desconta só ela (D25).
      obrigatoria: d.obrigatoria ?? false,
      arquivada: false,
      ordem: d.ordem ?? 0,
    };
  },

  'categoria.alterada'(e, d) {
    const c = e.categorias[d.id];
    if (!c) return;
    for (const campo of ['nome', 'pai', 'ordem', 'areas', 'obrigatoria']) {
      if (d[campo] !== undefined) c[campo] = d[campo];
    }
  },

  'categoria.arquivada'(e, d) {
    const c = e.categorias[d.id];
    if (c) c.arquivada = d.arquivada !== false;
  },

  'categoria.removida'(e, d) {
    // Se ela era grupo de alguém, as filhas não podem ficar apontando pro
    // vazio: voltam a ser categorias soltas. Referência pendurada é o começo
    // de um relatório que some com dinheiro sem avisar.
    for (const c of Object.values(e.categorias)) {
      if (c.pai === d.id) c.pai = null;
    }
    delete e.categorias[d.id];
  },

  // ── etiqueta ────────────────────────────────────────────────────────────
  //
  // A etiqueta responde "de quem/do que é" e ATRAVESSA categorias: combustível
  // e seguro são categorias diferentes e os dois são do carro
  // (04-categorias §3). Por isso ela é lista própria, múltipla por lançamento,
  // e não um nível a mais na árvore.

  'etiqueta.criada'(e, d) {
    e.etiquetas[d.id] = { id: d.id, nome: d.nome, arquivada: false };
  },

  'etiqueta.alterada'(e, d) {
    const t = e.etiquetas[d.id];
    if (t && d.nome !== undefined) t.nome = d.nome;
  },

  'etiqueta.arquivada'(e, d) {
    const t = e.etiquetas[d.id];
    if (t) t.arquivada = d.arquivada !== false;
  },

  'etiqueta.removida'(e, d) {
    // Só chega aqui o que nunca foi usado (js/core/listas.js). Remoção é
    // evento, nunca ausência de dado (design/06 §5).
    delete e.etiquetas[d.id];
  },

  // ── detalhe ─────────────────────────────────────────────────────────────
  //
  // O detalhe é o que distingue um lançamento dos outros DA MESMA categoria:
  // em supermercado é o mercado, em manutenção é o serviço (04-categorias §3).
  // A frequência por categoria não se guarda — calcula-se dos lançamentos, e é
  // por isso que a sugestão da E3 está sempre certa sem ninguém manter nada.

  'detalhe.criado'(e, d) {
    e.detalhes[d.id] = { id: d.id, nome: d.nome, arquivado: false };
  },

  'detalhe.alterado'(e, d) {
    const x = e.detalhes[d.id];
    if (x && d.nome !== undefined) x.nome = d.nome;
  },

  'detalhe.arquivado'(e, d) {
    const x = e.detalhes[d.id];
    if (x) x.arquivado = d.arquivado !== false;
  },

  'detalhe.removido'(e, d) {
    delete e.detalhes[d.id];
  },

  // ── recorrência ─────────────────────────────────────────────────────────
  //
  // Entidade separada do lançamento que ela gera (exigência F4): a série
  // precisa existir sozinha pra projetar os meses à frente, inclusive os meses
  // em que ninguém lançou nada.

  'recorrencia.criada'(e, d) {
    e.recorrencias[d.id] = {
      id: d.id,
      nome: d.nome,
      tipo: d.tipo,                       // despesa · receita · transferencia
      contaId: d.contaId,
      contaDestinoId: d.contaDestinoId ?? null,
      categoriaId: d.categoriaId ?? null,
      detalheId: d.detalheId ?? null,
      // As etiquetas da série, para o primeiro mês projetado antes de haver
      // um lançamento dela (depois, vale o último lançado).
      etiquetas: d.etiquetas ?? [],
      // fixa = valor travado; estimada = média das últimas 3 cobranças (E2), e
      // o valor aparece sempre com ~, porque total com estimativa dentro leva ~.
      tipoValor: d.tipoValor ?? 'fixa',
      valor: d.valor ?? null,
      periodicidade: d.periodicidade ?? 'mensal',
      dia: d.dia ?? 1,
      inicio: d.inicio,
      fim: d.fim ?? null,                 // nulo = indeterminada
      esporadica: d.esporadica ?? false,
      envelopeId: d.envelopeId ?? null,
      // Débito automático: no dia vira lançamento sozinho, a partir de
      // `caiSozinhaDesde` (design/13 §1).
      caiSozinha: d.caiSozinha ?? false,
      caiSozinhaDesde: d.caiSozinhaDesde ?? null,
      arquivada: false,
    };
  },

  'recorrencia.alterada'(e, d) {
    const r = e.recorrencias[d.id];
    if (!r) return;
    for (const [campo, valor] of Object.entries(d)) {
      if (campo !== 'id' && valor !== undefined) r[campo] = valor;
    }
    // Corrigir o valor de uma série com reajustes corrige o valor vigente —
    // o último —, não reescreve a história dos anteriores.
    if (d.valor !== undefined && r.valores?.length) {
      r.valores = [...r.valores.slice(0, -1), { ...r.valores[r.valores.length - 1], valor: d.valor }];
    }
  },

  'recorrencia.reajustada'(e, d) {
    // Reajuste: um valor novo, a partir de uma data. Os meses antes dela
    // continuam com o valor que tinham — previsão e histórico (design/10 §7).
    const r = e.recorrencias[d.id];
    if (!r) return;
    const base = r.valores?.length ? r.valores : r.valor ? [{ desde: r.inicio ?? d.desde, valor: r.valor }] : [];
    r.valores = [...base.filter((v) => v.desde !== d.desde), { desde: d.desde, valor: d.valor }]
      .sort((a, b) => (a.desde < b.desde ? -1 : 1));
    r.valor = r.valores[r.valores.length - 1].valor;
  },

  'recorrencia.arquivada'(e, d) {
    const r = e.recorrencias[d.id];
    if (r) r.arquivada = d.arquivada !== false;
  },

  'recorrencia.removida'(e, d) {
    delete e.recorrencias[d.id];
  },

  'recorrencia.pulada'(e, d) {
    // "Não houve este mês": a ocorrência sai da projeção e da fila sem virar
    // lançamento. Nunca beco sem saída (03 §10).
    const r = e.recorrencias[d.id];
    if (!r) return;
    r.pulados = [...new Set([...(r.pulados ?? []), d.mes])];
  },

  // ── fusão ───────────────────────────────────────────────────────────────
  //
  // Fundir A em B remapeia as referências de A para B e remove A. Como o estado
  // é derivado, a fusão guarda o que moveu e pode ser desfeita (02 §3.15).

  'categoria.fundida'(e, d) { fundir(e, 'categorias', 'categoriaId', d); },
  'etiqueta.fundida'(e, d) { fundir(e, 'etiquetas', 'etiquetas', d); },
  'detalhe.fundido'(e, d) { fundir(e, 'detalhes', 'detalheId', d); },

  'fusao.desfeita'(e, d) {
    const f = e.fusoes[d.id];
    if (!f || f.desfeita) return;
    e[f.especie][f.item.id] = f.item;
    for (const id of f.lancamentos) {
      const l = e.lancamentos[id];
      if (!l) continue;
      if (f.campo === 'etiquetas') {
        // Quem só tinha a de origem volta a tê-la no lugar da de destino; quem
        // já tinha as duas só recupera a de origem. O que foi mexido depois da
        // fusão é decisão nova, e vale.
        if (f.substituiu.includes(id)) {
          if (l.etiquetas.includes(f.para)) {
            l.etiquetas = l.etiquetas.map((t) => (t === f.para ? f.item.id : t));
          }
        } else if (!l.etiquetas.includes(f.item.id)) {
          l.etiquetas = [...l.etiquetas, f.item.id];
        }
      } else if (l[f.campo] === f.para) {
        l[f.campo] = f.item.id;
      }
    }
    for (const id of f.recorrencias ?? []) {
      const r = e.recorrencias[id];
      if (r && r[f.campo] === f.para) r[f.campo] = f.item.id;
    }
    f.desfeita = true;
  },

  // ── lançamento ──────────────────────────────────────────────────────────

  'lancamento.registrado'(e, d, evento) {
    e.lancamentos[d.id] = {
      id: d.id,
      // A ordem do registro, para o que acontece no mesmo dia (design/11 §4).
      lc: evento?.lc ?? 0,
      tipo: d.tipo,                       // despesa · receita · transferencia · ...
      valor: d.valor,                     // centavos, positivo (02 §1)
      // As três datas, sempre presentes. Nos lançamentos comuns são iguais; no
      // cartão divergem, e é essa divergência que faz a visão dupla da D4
      // existir sem nenhum caso especial.
      dataCompetencia: d.dataCompetencia,
      dataCaixa: d.dataCaixa ?? d.dataCompetencia,
      dataVencimento: d.dataVencimento ?? d.dataCaixa ?? d.dataCompetencia,
      contaId: d.contaId,
      contaDestinoId: d.contaDestinoId ?? null,
      categoriaId: d.categoriaId ?? null, // nulo em transferência (02 §3.6)
      detalheId: d.detalheId ?? null,
      etiquetas: d.etiquetas ?? [],
      observacao: d.observacao ?? '',
      // Confirmado = o dinheiro se moveu. Não é escolhido: vem da origem e da
      // data (D2). O ESTADO (realizado/previsto/vencido) é calculado disto.
      confirmado: d.confirmado !== false,
      origemValor: d.origemValor ?? 'digitado',
      valorEstimadoOriginal: d.valorEstimadoOriginal ?? null,
      recorrenciaId: d.recorrenciaId ?? null,
      parcela: d.parcela ?? null,
      // A parcela de um contrato de dívida que este lançamento substitui —
      // a automática corrigida pela linha (design/10 §4.4).
      parcelaDe: d.parcelaDe ?? null,
      // Aplicação, resgate e provento: o ativo de que se trata (design/10 §3.6).
      ativoId: d.ativoId ?? null,
      // Compra e venda de um ativo por cotas: quantidade, preço de uma unidade
      // (centavos) e taxas. O valor é o que mexeu na conta.
      quantidade: d.quantidade ?? null,
      preco: d.preco ?? null,
      taxas: d.taxas ?? null,
      // No cartão: quantas faturas a compra anda para frente (+) ou para trás
      // (−) da que a data dela daria — o banco às vezes processa na vizinha.
      faturaDesloca: d.faturaDesloca ?? 0,
      estornoDe: d.estornoDe ?? null,
      custeadoPor: d.custeadoPor ?? null,
      envelopeId: d.envelopeId ?? null,
      // De quem é o dinheiro que este movimento leva de um lugar a outro:
      // [{ envelopeId, valor }]. O resto é sem dono (design/11 §4).
      donos: d.donos ?? [],
      // Caiu sozinho: a conta fixa em débito automático (design/13 §1).
      caiuSozinha: d.caiuSozinha ?? false,
      // Importado do banco (design/13 §3): o número que o banco dá à linha
      // (reimportar não duplica) e o texto dele (é dele que a regra aprende).
      fitid: d.fitid ?? null,
      textoBanco: d.textoBanco ?? null,
      extraordinario: d.extraordinario ?? Boolean(d.custeadoPor),
      lancadoPor: d.lancadoPor ?? null,
      // Só no estorno: quando o dinheiro voltou (02 §3.6). No cartão, é isso
      // que põe a devolução na fatura em formação, e não na da compra.
      devolvidoEm: d.devolvidoEm ?? null,
      cicloFatura: null,
      removido: false,
    };
    // No cartão, o evento traz a data da compra e o ciclo diz o resto (D4).
    // É aqui, e não na captura, para que as compras lançadas antes de o ciclo
    // existir no app caiam na fatura certa sem evento novo (02 §3.8).
    datarNoCartao(e.lancamentos[d.id], e.contas[d.contaId]);
  },

  'lancamento.alterado'(e, d) {
    const l = e.lancamentos[d.id];
    if (!l) return;
    for (const [campo, valor] of Object.entries(d)) {
      // No cartão, caixa e vencimento são do ciclo, nunca do dedo.
      if (l.cicloFatura && (campo === 'dataCaixa' || campo === 'dataVencimento')) continue;
      if (campo !== 'id' && valor !== undefined) l[campo] = valor;
    }
    if (d.contaId !== undefined || d.dataCompetencia !== undefined || d.devolvidoEm !== undefined || d.faturaDesloca !== undefined) {
      // Estorno fora do cartão: o caixa é quando o dinheiro voltou.
      if (d.devolvidoEm !== undefined && !l.cicloFatura) l.dataCaixa = d.devolvidoEm;
      datarNoCartao(l, e.contas[l.contaId]);
    }
  },

  'lancamento.removido'(e, d) {
    // Remoção é EVENTO, e o lançamento fica marcado em vez de sumir: é o que
    // impede o aparelho do outro de ressuscitá-lo na sincronização (06 §5).
    const l = e.lancamentos[d.id];
    if (l) l.removido = true;
  },

  'conta.removida'(e, d) {
    // Só chega aqui o que nunca foi usado — a regra está na camada de aplicação
    // (design/02-modelo-de-dados.md §3.15). Remoção é EVENTO, nunca ausência de
    // dado, senão a sincronização ressuscita o que foi apagado (design/06 §5).
    delete e.contas[d.id];
  },
};

/** Aplica um evento ao rascunho. Devolve true se o tipo era conhecido. */
export function aplicar(rascunho, evento) {
  const redutor = redutores[evento.tipo];
  if (!redutor) {
    rascunho.desconhecidos[evento.tipo] =
      (rascunho.desconhecidos[evento.tipo] || 0) + 1;
    return false;
  }
  redutor(rascunho, evento.dados ?? {}, evento);
  return true;
}

/**
 * Fundir `d.de` em `d.para` dentro de uma lista. Guarda em `e.fusoes` o item
 * removido e quem foi movido, para o desfazer.
 */
function fundir(e, especie, campo, d) {
  const item = e[especie][d.de];
  if (!item || !e[especie][d.para] || d.de === d.para) return;

  const movidos = [];
  const substituiu = [];
  for (const l of Object.values(e.lancamentos)) {
    if (campo === 'etiquetas') {
      if (!l.etiquetas.includes(d.de)) continue;
      // Se o lançamento já tinha as duas, a de origem só sai: não há o que
      // trocar, e no desfazer ela volta sem tirar a de destino.
      if (!l.etiquetas.includes(d.para)) substituiu.push(l.id);
      l.etiquetas = [...new Set(l.etiquetas.map((t) => (t === d.de ? d.para : t)))];
      movidos.push(l.id);
    } else if (l[campo] === d.de) {
      l[campo] = d.para;
      movidos.push(l.id);
    }
  }
  const recorrencias = [];
  if (campo !== 'etiquetas') {
    for (const r of Object.values(e.recorrencias)) {
      if (r[campo] === d.de) {
        r[campo] = d.para;
        recorrencias.push(r.id);
      }
    }
  }
  delete e[especie][d.de];
  e.fusoes[d.id] = {
    id: d.id, especie, campo, item, para: d.para,
    lancamentos: movidos, substituiu, recorrencias, desfeita: false,
  };
}
