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
  // Conta sem lançamento nenhum sai, mesmo com saldo inicial declarado: nada
  // aponta pra ela, nada fica órfão, e a alternativa seria um beco sem saída
  // justo pra quem errou o cadastro na primeira semana. Quem confirma a saída
  // é a tela, dizendo o saldo em voz alta.
  return { pode: true, usos: 0 };
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
