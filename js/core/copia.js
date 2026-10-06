// A cópia de segurança: um arquivo com TODOS os registros do aparelho (o histórico
// inteiro de eventos, de todos os aparelhos que já chegaram até aqui), cifrado com
// uma frase que a pessoa digita. Serve para recomeçar num endereço novo ou num
// aparelho vazio: o app não depende de nenhum serviço para voltar.
//
// Restaurar só ACRESCENTA o que falta (evento com id conhecido é ignorado, como na
// sincronização): nunca apaga nem troca o que o aparelho já tem.
//
// O arquivo não leva a frase, o token da sincronização nem o PIN: só os registros.

import * as db from './db.js';
import * as estado from './estado.js';
import { novoSal, derivarChave, cifrar, decifrar, criarSelo, seloConfere } from './cripto.js';
import { hoje } from './datas.js';

const FORMATO = 'app-financas-copia';
const VERSAO = 1;
const CHAVE_ULTIMA = 'appfinancas:ultima-copia';
export const TAMANHO_MINIMO_DA_FRASE = 8;

export class ErroDaCopia extends Error {}

/** O dia (AAAA-MM-DD) da última cópia guardada neste aparelho, ou null. */
export function ultimaCopia() {
  try { return localStorage.getItem(CHAVE_ULTIMA) || null; } catch { return null; }
}

function marcarCopia(dia) {
  try { localStorage.setItem(CHAVE_ULTIMA, dia); } catch { /* sem armazenamento: só o aviso volta */ }
}

/** O nome do arquivo de hoje. */
export const nomeDoArquivo = (dia = hoje()) => `financas-${dia}.fin`;

/**
 * Monta a cópia com a frase dada. Devolve { texto, registros }.
 * `marcar: false` é para os testes.
 */
export async function criarCopia(frase, { marcar = true } = {}) {
  if (String(frase ?? '').length < TAMANHO_MINIMO_DA_FRASE) {
    throw new ErroDaCopia(`A frase precisa de pelo menos ${TAMANHO_MINIMO_DA_FRASE} caracteres.`);
  }
  const eventos = await db.eventosEmOrdem();
  const sal = novoSal();
  const chave = await derivarChave(frase, sal);
  const arquivo = {
    formato: FORMATO,
    versao: VERSAO,
    criadaEm: new Date().toISOString(),
    registros: eventos.length,
    sal,
    selo: await criarSelo(chave),
    dados: await cifrar(chave, JSON.stringify(eventos)),
  };
  if (marcar) marcarCopia(hoje());
  return { texto: JSON.stringify(arquivo), registros: eventos.length };
}

/**
 * Abre uma cópia. Devolve { eventos, criadaEm }. Frase errada, arquivo que não
 * é uma cópia ou arquivo danificado viram ErroDaCopia, com texto para a tela.
 */
export async function lerCopia(texto, frase) {
  let arquivo;
  try { arquivo = JSON.parse(texto); } catch { throw new ErroDaCopia('Este arquivo não é uma cópia do app.'); }
  if (arquivo?.formato !== FORMATO) throw new ErroDaCopia('Este arquivo não é uma cópia do app.');
  if (arquivo.versao > VERSAO) throw new ErroDaCopia('Esta cópia é de uma versão mais nova do app. Atualize o app e tente de novo.');
  const chave = await derivarChave(frase, arquivo.sal);
  if (!(await seloConfere(chave, arquivo.selo))) throw new ErroDaCopia('Frase errada.');
  let eventos;
  try { eventos = JSON.parse(await decifrar(chave, arquivo.dados)); } catch { throw new ErroDaCopia('O arquivo está danificado.'); }
  if (!Array.isArray(eventos) || eventos.some((e) => !e || typeof e.id !== 'string')) throw new ErroDaCopia('O arquivo está danificado.');
  return { eventos, criadaEm: arquivo.criadaEm };
}

/** Quantos dos registros da cópia o aparelho já tem e quantos faltam. */
export async function conferirCopia(eventos) {
  const tem = new Set((await db.eventosEmOrdem()).map((e) => e.id));
  const novos = eventos.filter((e) => !tem.has(e.id));
  return { total: eventos.length, jaTem: eventos.length - novos.length, novos };
}

/** Acrescenta ao aparelho os registros que faltam. Devolve quantos entraram. */
export async function restaurarCopia(novos) {
  if (!novos.length) return 0;
  const { novos: quantos } = await estado.absorverEventos(novos);
  return quantos;
}
