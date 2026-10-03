// O estado derivado, e o cache descartável que evita reler dois anos de eventos
// a cada abertura. design/02-modelo-de-dados.md §2
//
// "Estado consolidado" é o cache. Pode ser apagado a qualquer momento e
// reconstruído inteiro a partir dos eventos, que são a única verdade.
// (Não confundir com a "foto de saldo" das contas de investimento, que é dado
// de verdade informado por nós.)

import * as db from './db.js';
import * as log from './log.js';
import { VERSAO_ATUAL } from './formato.js';
import { estadoVazio, aplicar, VERSAO_ESTADO } from './redutores.js';

let emMemoria = null;

// Quem quiser saber que o estado mudou se inscreve aqui. É o que permite a
// sincronização acontecer sozinha a cada alteração sem o núcleo saber que a
// sincronização existe — ele avisa, e quem se importa reage.
const ouvintes = new Set();

export function aoAplicar(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisar(motivo) {
  for (const fn of ouvintes) {
    try {
      fn(motivo);
    } catch (e) {
      // Ouvinte quebrado não pode derrubar uma gravação de dinheiro.
      console.warn('ouvinte de estado falhou', e);
    }
  }
}

/**
 * Estado atual. Usa o cache quando ele serve, e continua a conta só com os
 * eventos novos.
 */
export async function calcular({ ignorarCache = false } = {}) {
  if (emMemoria && !ignorarCache) return emMemoria;

  const cache = ignorarCache ? null : await db.lerMeta('consolidado');
  // Duas versões, e as duas precisam bater: a dos eventos (podem ter sido
  // gravados por um app mais novo) e a da FORMA do estado (pode ter ganhado
  // campos desde que este cache foi escrito).
  const cacheServe =
    cache &&
    cache.formato === VERSAO_ATUAL &&
    cache.formatoEstado === VERSAO_ESTADO &&
    cache.estado &&
    typeof cache.ateLc === 'number';

  let estado;
  let ateLc;
  let aplicados;

  if (cacheServe) {
    estado = cache.estado;
    ateLc = cache.ateLc;
    aplicados = cache.aplicados ?? 0;
  } else {
    estado = estadoVazio();
    ateLc = -Infinity;
    aplicados = 0;
  }

  const novos = await log.ler(ateLc === -Infinity ? {} : { aposLc: ateLc });
  for (const ev of novos) {
    aplicar(estado, ev);
    aplicados += 1;
    if (ev.lc > ateLc || ateLc === -Infinity) ateLc = ev.lc;
  }

  const resultado = {
    ...estado,
    formato: VERSAO_ATUAL,
    ateLc: ateLc === -Infinity ? 0 : ateLc,
    aplicados,
  };

  emMemoria = resultado;
  if (novos.length > 0 || !cacheServe) await consolidar(resultado);
  return resultado;
}

/** Joga o cache fora e reconstrói do primeiro evento. */
export async function recalcular() {
  emMemoria = null;
  await db.limparConsolidado();
  return calcular({ ignorarCache: true });
}

/** Esquece o que está em memória, sem apagar o cache em disco. */
export function invalidarMemoria() {
  emMemoria = null;
}

async function consolidar(estado) {
  const { formato, ateLc, aplicados, ...resto } = estado;
  await db.gravarMeta('consolidado', {
    formato,
    formatoEstado: VERSAO_ESTADO,
    ateLc,
    aplicados,
    gravadoEm: new Date().toISOString(),
    estado: resto,
  });
}

/**
 * Registra um evento e devolve o estado já atualizado.
 * É o caminho único de escrita do app: nada muda estado sem passar por um evento.
 */
export async function aplicarEvento(tipo, dados) {
  const evento = await log.registrar(tipo, dados);
  const estado = await calcular();
  aplicar(estado, evento);
  estado.aplicados += 1;
  estado.ateLc = Math.max(estado.ateLc, evento.lc);
  emMemoria = estado;
  await consolidar(estado);
  avisar('local');
  return { evento, estado };
}

/**
 * Absorve eventos de outro aparelho. Se algum chegou "atrasado" (lc menor que o
 * que já foi consolidado), o cache não serve mais e o estado é refeito do zero.
 * design/06-sincronizacao.md §4
 */
export async function absorverEventos(eventos) {
  const { novos, foraDeOrdem } = await log.absorver(eventos);
  if (novos === 0) return { novos, recalculado: false, estado: await calcular() };
  if (foraDeOrdem) {
    const estado = await recalcular();
    avisar('recebido');
    return { novos, recalculado: true, estado };
  }
  emMemoria = null;
  const estado = await calcular();
  avisar('recebido');
  return { novos, recalculado: false, estado };
}
