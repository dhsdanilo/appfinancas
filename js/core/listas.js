// As listas do app — categorias, contas, etiquetas — e as regras de manutenção
// delas. design/02-modelo-de-dados.md §3.15 · design/03-alimentacao.md §10
//
// Regra que governa tudo aqui: o app jamais apaga o passado, e jamais responde
// "não pode" sem o caminho que resolve. Por isso cada recusa devolve o motivo
// em dado — quem escreve a frase é a tela, não o núcleo.

import { visiveis, saldoReal, hoje } from './lancamentos.js';
import { saldoDevedor } from './divida.js';
import { calendarioDaDivida, fimDasParcelas } from './parcelas.js';

/**
 * Quantos lançamentos usam cada item. É o número que torna a bancada útil em
 * vez de burocrática (04-categorias §7): decidir o que arquivar com o uso à
 * vista é decisão informada; sem ele, é palpite — e no palpite ninguém apaga
 * nada e a lista só cresce.
 */
export function usos(estado) {
  const categorias = new Map();
  const contas = new Map();
  const etiquetas = new Map();
  const detalhes = new Map();
  const pessoas = new Map();
  const soma = (mapa, chave) => {
    if (chave) mapa.set(chave, (mapa.get(chave) || 0) + 1);
  };

  for (const l of visiveis(estado)) {
    soma(categorias, l.categoriaId);
    // Compra dividida: as outras categorias dela também a usam.
    for (const p of l.divisao ?? []) if (p.categoriaId !== l.categoriaId) soma(categorias, p.categoriaId);
    soma(contas, l.contaId);
    // A transferência toca duas contas, e pesa nas duas.
    soma(contas, l.contaDestinoId);
    soma(detalhes, l.detalheId);
    soma(pessoas, l.compradoPor);
    for (const etiqueta of l.etiquetas ?? []) soma(etiquetas, etiqueta);
  }
  for (const c of Object.values(estado.contas)) soma(pessoas, c.titular);
  return { categorias, contas, etiquetas, detalhes, pessoas };
}

/**
 * Remover de verdade só o que nunca foi usado. O que tem histórico se arquiva
 * ou se funde — apagar deixaria lançamento órfão, e isso o app não faz.
 *
 * @param {'categorias'|'contas'|'etiquetas'|'detalhes'} especie
 */
export function podeRemover(estado, especie, id) {
  const quantos = usos(estado)[especie]?.get(id) ?? 0;
  if (quantos > 0) return { pode: false, motivo: 'tem histórico', usos: quantos };
  // Sem lançamento, mas ainda usada por uma série, regra, seleção, cartão, folha, Energia ou envelope:
  // apagar tiraria isso do lugar sem aviso (auditoria H3, H4).
  const dependentes = dependentesDe(estado, especie, id);
  if (dependentes.length) return { pode: false, motivo: 'em uso', usos: 0, dependentes };
  // Conta sem lançamento nenhum sai, mesmo com saldo inicial declarado: nada
  // aponta pra ela, nada fica órfão, e a alternativa seria um beco sem saída
  // justo pra quem errou o cadastro na primeira semana. Quem confirma a saída
  // é a tela, dizendo o saldo em voz alta.
  return { pode: true, usos: 0 };
}

/**
 * O que, fora os lançamentos, aponta para um item: frases curtas ("a recorrência Luz", "o cartão X").
 * Também serve para um ativo (`especie` 'ativos'): dinheiro de envelope dentro dele.
 */
export function dependentesDe(estado, especie, id) {
  const achados = [];
  const nome = (m) => Object.values(m ?? {}).filter((x) => !x.removida && !x.arquivada);
  const alocacoes = Object.values(estado.alocacoes ?? {}).filter((a) => !a.removida && a.lugarId === id);
  if ((especie === 'contas' || especie === 'ativos') && alocacoes.length) {
    const quais = [...new Set(alocacoes.flatMap((a) => [a.para, a.de]).filter(Boolean))].map((e) => estado.envelopes?.[e]?.nome).filter(Boolean);
    achados.push(`o dinheiro de envelope que está ali${quais.length ? ` (${quais.join(', ')})` : ''}`);
  }
  const campoRec = { categorias: ['categoriaId'], contas: ['contaId', 'contaDestinoId'], detalhes: ['detalheId'] }[especie] ?? [];
  for (const r of nome(estado.recorrencias)) {
    if (campoRec.some((c) => r[c] === id) || (especie === 'etiquetas' && (r.etiquetas ?? []).includes(id))) achados.push(`a recorrência ${r.nome}`);
  }
  for (const r of nome(estado.regras)) {
    const usa = (especie === 'categorias' && r.categoriaId === id) || (especie === 'detalhes' && r.detalheId === id)
      || (especie === 'etiquetas' && (r.etiquetas ?? []).includes(id)) || (especie === 'contas' && r.transferePara === id);
    if (usa) achados.push(`a regra "${r.padrao}"`);
  }
  const campoSel = { categorias: 'categorias', etiquetas: 'etiquetas', detalhes: 'descricoes', contas: 'contas' }[especie];
  if (campoSel) for (const s of nome(estado.selecoes)) if ((s[campoSel] ?? []).includes(id)) achados.push(`a seleção "${s.nome}"`);
  if (especie === 'contas') {
    for (const c of Object.values(estado.contas)) {
      if (c.id === id) continue;
      if (c.pagaCom === id) achados.push(`${c.tipo === 'cartao' ? 'o cartão' : 'a dívida'} ${c.nome} (paga com ela)`);
      if (c.liquidoPara === id) achados.push(`a renda ${c.nome} (o líquido cai nela)`);
      if (c.caixaEm === id) achados.push(`${c.nome} (o dinheiro fica nela)`);
      if (c.cofrinhoId === id) achados.push(`o cartão ${c.nome} (cofrinho)`);
    }
    if (estado.energiaConfig?.contaId === id) achados.push('a Energia (conta da fatura)');
  }
  if (especie === 'ativos') {
    for (const c of Object.values(estado.contas)) if (c.cofrinhoAtivoId === id) achados.push(`o cartão ${c.nome} (cofrinho)`);
  }
  return achados;
}

/** Conta com saldo não se arquiva antes de o saldo ser resolvido. */
export function podeArquivarConta(estado, id, dia = hoje()) {
  // Na dívida o que importa é o que ainda se deve, não a soma dos pagamentos.
  const devedor = estado.contas[id]?.tipo === 'divida' ? saldoDevedor(estado, id) : null;
  const saldo = devedor != null ? -devedor : saldoReal(estado, id);
  if (saldo !== 0) return { pode: false, motivo: 'tem saldo', saldo };
  // Conta que ainda paga parcelas de um empréstimo: arquivada, elas cairiam
  // escondidas nela. Primeiro o contrato passa a ser pago por outra.
  const divida = dividaPagaPor(estado, id, dia);
  if (divida) return { pode: false, motivo: 'paga dívida', divida, saldo: 0 };
  return { pode: true, saldo: 0 };
}

/** A dívida com parcelas ainda por cair que esta conta paga, se houver. */
export function dividaPagaPor(estado, contaId, dia) {
  return Object.values(estado.contas).find((d) => {
    if (d.tipo !== 'divida' || d.arquivada || !d.contrato || d.pagaCom !== contaId) return false;
    const fim = fimDasParcelas(d);
    if (fim && fim <= dia) return false;
    return calendarioDaDivida(estado, d).some((p) => p.data > dia);
  }) ?? null;
}

/**
 * Acha um item de uma lista pelo nome, ignorando caixa e espaço nas pontas.
 *
 * Existe porque o dono da conta é digitado como texto, e "Maria" e "maria"
 * não podem virar duas pessoas: o app cria a pessoa na primeira vez e reusa
 * dali pra frente, sem nunca pedir isso a quem está cadastrando a conta.
 */
export function acharPorNome(colecao, nome) {
  const chave = chaveDoNome(nome);
  if (!chave) return null;
  return Object.values(colecao).find((i) => chaveDoNome(i.nome) === chave) ?? null;
}

/** O nome sem caixa, sem espaço nas pontas e sem acento: "Aná" e "ana" são a mesma. */
export const chaveDoNome = (nome) =>
  String(nome).normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('pt-BR');
