// Redutores: como cada evento muda o estado.
//
// O estado NÃO é armazenado — é calculado lendo os eventos em ordem
// (design/02-modelo-de-dados.md §2). Cada redutor recebe o rascunho do estado e
// o altera no lugar; a ordem de aplicação é garantida por quem chama.
//
// Cobertos: pessoa, conta, categoria e lançamento. Faltam recorrência,
// envelope, holerite e os demais tipos de lançamento — Fase 3 em diante.

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
export const VERSAO_ESTADO = 4;

export function estadoVazio() {
  return {
    pessoas: {},
    contas: {},
    categorias: {},
    etiquetas: {},
    detalhes: {},
    lancamentos: {},
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
      // Só em cartão (D13)
      limite: d.limite ?? null,
      diaFechamento: d.diaFechamento ?? null,
      diaVencimento: d.diaVencimento ?? null,
      // Só em investimento (D16)
      risco: d.risco ?? null,
      liquidez: d.liquidez ?? null,
    };
  },

  'conta.alterada'(e, d) {
    const c = e.contas[d.id];
    if (!c) return;
    for (const campo of [
      'nome',
      'titular',
      'limite',
      'diaFechamento',
      'diaVencimento',
      'risco',
      'liquidez',
    ]) {
      if (d[campo] !== undefined) c[campo] = d[campo];
    }
    // tipo, saldoInicial e dataInicial não mudam por aqui de propósito:
    // mexem em saldo histórico e precisam de evento próprio, deliberado.
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

  // ── categoria ───────────────────────────────────────────────────────────

  'categoria.criada'(e, d) {
    e.categorias[d.id] = {
      id: d.id,
      nome: d.nome,
      pai: d.pai ?? null,          // nulo = é grupo (04-categorias §2)
      natureza: d.natureza ?? 'despesa',
      arquivada: false,
      ordem: d.ordem ?? 0,
    };
  },

  'categoria.alterada'(e, d) {
    const c = e.categorias[d.id];
    if (!c) return;
    for (const campo of ['nome', 'pai', 'ordem']) {
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

  // ── lançamento ──────────────────────────────────────────────────────────

  'lancamento.registrado'(e, d) {
    e.lancamentos[d.id] = {
      id: d.id,
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
      estornoDe: d.estornoDe ?? null,
      custeadoPor: d.custeadoPor ?? null,
      envelopeId: d.envelopeId ?? null,
      extraordinario: d.extraordinario ?? Boolean(d.custeadoPor),
      lancadoPor: d.lancadoPor ?? null,
      removido: false,
    };
  },

  'lancamento.alterado'(e, d) {
    const l = e.lancamentos[d.id];
    if (!l) return;
    for (const [campo, valor] of Object.entries(d)) {
      if (campo !== 'id' && valor !== undefined) l[campo] = valor;
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
