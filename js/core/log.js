// O registro de eventos: a única verdade do app.
// design/02-modelo-de-dados.md §2 · design/06-sincronizacao.md
//
// Append-only. Nada aqui reescreve ou apaga um evento já gravado — nem edição,
// nem remoção: as duas são eventos novos.

import * as db from './db.js';
import { VERSAO_ATUAL, promover } from './formato.js';
import { novoId, slug } from './id.js';

// ── identidade do aparelho ────────────────────────────────────────────────

/**
 * Cada aparelho escreve no próprio espaço, e é só isso que torna conflito de
 * escrita impossível por construção (design/06 §2).
 *
 * Lido do banco a cada chamada, sem cache em memória de propósito: cache aqui
 * sobreviveria a uma troca de banco e faria o app gravar eventos em nome de um
 * aparelho que não existe naquele banco. Uma leitura de IndexedDB é barata;
 * identidade errada em dado financeiro, não.
 */
export async function aparelho() {
  return db.lerMeta('aparelho');
}

export async function registrarAparelho(nome) {
  const id = slug(nome) || 'aparelho';
  const existente = await db.lerMeta('aparelho');
  if (existente && existente.id === id) return existente;
  const registro = { id, nome, criadoEm: new Date().toISOString() };
  await db.gravarMeta('aparelho', registro);
  return registro;
}

// ── relógio lógico ────────────────────────────────────────────────────────
//
// Relógio de celular erra, atrasa e dá saltos. Ordenar por horário faria os
// três aparelhos chegarem a resultados diferentes. Então a ordem canônica é o
// relógio lógico (Lamport): sempre maior que tudo que o aparelho já viu, e
// desempatado pelo id do aparelho. Determinístico, independente de quem
// sincronizou primeiro (design/06 §4).

async function proximoLc() {
  const local = await db.lerMeta('lc', 0);
  const visto = await db.maiorLc();
  const proximo = Math.max(local, visto) + 1;
  await db.gravarMeta('lc', proximo);
  return proximo;
}

/** Ao receber eventos de fora, o relógio local sobe para não repetir números. */
async function alinharLc(eventos) {
  const maior = eventos.reduce((m, ev) => Math.max(m, ev.lc || 0), 0);
  const local = await db.lerMeta('lc', 0);
  if (maior > local) await db.gravarMeta('lc', maior);
}

// ── fila de escrita ───────────────────────────────────────────────────────
//
// Calcular o próximo lc e o próximo seq é ler-modificar-gravar, e IndexedDB não
// mantém isso atômico entre transações separadas. Duas escritas simultâneas —
// dois toques rápidos no botão de lançar, ou um lançamento enquanto a
// sincronização absorve — produziriam o MESMO número de sequência, e o índice
// único abortaria a transação. Ou, pior, o mesmo lc, bagunçando a ordem
// canônica que a sincronização depende (design/06 §4).
//
// Então toda escrita passa por uma fila. É a serialização mais simples que
// resolve, e o custo é irrelevante: escrita de lançamento é coisa de uma por vez
// na mão humana.

let fila = Promise.resolve();

function enfileirar(tarefa) {
  const resultado = fila.then(tarefa, tarefa);
  // A fila segue viva mesmo se uma tarefa falhar: o erro vai para quem chamou.
  fila = resultado.then(
    () => undefined,
    () => undefined
  );
  return resultado;
}

// ── escrita ───────────────────────────────────────────────────────────────

/**
 * Grava um evento gerado NESTE aparelho.
 * @param {string} tipo  "conta.criada", "lancamento.registrado", ...
 * @param {object} dados corpo do evento
 */
export function registrar(tipo, dados) {
  return enfileirar(async () => {
    const ap = await aparelho();
    if (!ap) throw new Error('aparelho não registrado: chame registrarAparelho() antes');

    const evento = {
      id: novoId('ev'),
      ap: ap.id,
      seq: (await db.ultimaSeq(ap.id)) + 1,
      lc: await proximoLc(),
      t: new Date().toISOString(),
      v: VERSAO_ATUAL,
      tipo,
      dados,
    };

    await db.acrescentarEventos([evento]);
    return evento;
  });
}

/**
 * Absorve eventos vindos de outro aparelho (Fase 4 usará isto).
 * Idempotente: reaplicar os mesmos eventos não muda nada.
 */
export function absorver(eventos) {
  if (!eventos.length) return Promise.resolve({ novos: 0, foraDeOrdem: false });
  return enfileirar(async () => {
    const antesDoMaior = await db.maiorLc();
    const novos = await db.acrescentarEventos(eventos);
    await alinharLc(eventos);

    // Evento que chega com lc menor que o que já foi consolidado invalida o
    // cache: o estado precisa ser recalculado do zero para a ordem ficar certa.
    const menorRecebido = eventos.reduce((m, ev) => Math.min(m, ev.lc || 0), Infinity);
    const foraDeOrdem = menorRecebido <= antesDoMaior;
    return { novos, foraDeOrdem };
  });
}

// ── leitura ───────────────────────────────────────────────────────────────

/**
 * Eventos em ordem canônica, já promovidos ao formato atual.
 * `aposLc` permite continuar a conta de onde o cache parou.
 */
export async function ler({ aposLc } = {}) {
  const crus = await db.eventosEmOrdem(aposLc === undefined ? {} : { aposLc });
  return crus.map((ev) => promover(ev));
}

export const contar = db.contarEventos;
export const maiorLc = db.maiorLc;
