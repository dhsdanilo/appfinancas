// IndexedDB cru, embrulhado em promessas. Sem biblioteca — não precisa de uma.
//
// Dois depósitos, e a diferença entre eles é a espinha do design:
//   eventos — o registro append-only. É a ÚNICA verdade.
//   meta    — ponteiros, identidade do aparelho e o estado consolidado (cache descartável).

const VERSAO_BANCO = 1;

let nomeBanco = 'appfinancas';
let bancoAberto = null;

/**
 * Troca o banco em uso. Existe por um motivo só: a suíte de verificação precisa
 * de um banco próprio, porque ela apaga tudo que toca. Nunca chamar isto no app.
 */
export function usarBanco(nome) {
  if (bancoAberto) {
    bancoAberto.then((db) => db.close()).catch(() => {});
  }
  nomeBanco = nome;
  bancoAberto = null;
}

export function bancoEmUso() {
  return nomeBanco;
}

export function destruirBanco(nome) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(nome);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export function abrir() {
  if (bancoAberto) return bancoAberto;
  bancoAberto = new Promise((resolve, reject) => {
    const req = indexedDB.open(nomeBanco, VERSAO_BANCO);

    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('eventos')) {
        const ev = db.createObjectStore('eventos', { keyPath: 'id' });
        // Ordem determinística de aplicação: relógio lógico, desempatado pelo aparelho.
        ev.createIndex('ordem', ['lc', 'ap']);
        // Garante que um aparelho nunca repete um número de sequência.
        ev.createIndex('ap_seq', ['ap', 'seq'], { unique: true });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'chave' });
      }
      void e;
    };

    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('banco bloqueado por outra aba'));
  });
  return bancoAberto;
}

async function transacao(depositos, modo) {
  const db = await abrir();
  return db.transaction(depositos, modo);
}

function promessa(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function fim(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transação abortada'));
  });
}

// ── meta ──────────────────────────────────────────────────────────────────

export async function lerMeta(chave, padrao = null) {
  const tx = await transacao(['meta'], 'readonly');
  const linha = await promessa(tx.objectStore('meta').get(chave));
  return linha === undefined ? padrao : linha.valor;
}

export async function gravarMeta(chave, valor) {
  const tx = await transacao(['meta'], 'readwrite');
  tx.objectStore('meta').put({ chave, valor });
  await fim(tx);
  return valor;
}

// ── eventos ───────────────────────────────────────────────────────────────

/**
 * Acrescenta eventos. Idempotente: evento com id já conhecido é ignorado em
 * silêncio, o que torna sincronização repetida ou interrompida segura.
 * design/06-sincronizacao.md §4
 *
 * @returns {Promise<number>} quantos eventos realmente entraram
 */
export async function acrescentarEventos(eventos) {
  if (eventos.length === 0) return 0;
  const tx = await transacao(['eventos'], 'readwrite');
  const dep = tx.objectStore('eventos');
  let novos = 0;
  for (const ev of eventos) {
    const existe = await promessa(dep.get(ev.id));
    if (existe !== undefined) continue;
    dep.put(ev);
    novos += 1;
  }
  await fim(tx);
  return novos;
}

/** Todos os eventos, já na ordem canônica de aplicação. */
export async function eventosEmOrdem({ aposLc = -Infinity } = {}) {
  const tx = await transacao(['eventos'], 'readonly');
  const indice = tx.objectStore('eventos').index('ordem');
  const faixa =
    aposLc === -Infinity
      ? null
      : IDBKeyRange.lowerBound([aposLc, ''], true);
  const todos = await promessa(indice.getAll(faixa));
  return todos;
}

export async function contarEventos() {
  const tx = await transacao(['eventos'], 'readonly');
  return promessa(tx.objectStore('eventos').count());
}

/** Maior relógio lógico já visto, de qualquer aparelho. */
export async function maiorLc() {
  const tx = await transacao(['eventos'], 'readonly');
  const indice = tx.objectStore('eventos').index('ordem');
  const cursor = await promessa(indice.openCursor(null, 'prev'));
  return cursor ? cursor.value.lc : 0;
}

/** Último número de sequência usado por um aparelho. */
export async function ultimaSeq(ap) {
  const tx = await transacao(['eventos'], 'readonly');
  const indice = tx.objectStore('eventos').index('ap_seq');
  const cursor = await promessa(
    indice.openCursor(IDBKeyRange.bound([ap, -Infinity], [ap, Infinity]), 'prev')
  );
  return cursor ? cursor.value.seq : 0;
}

// ── manutenção ────────────────────────────────────────────────────────────

/** Apaga só o cache. Os eventos ficam: o estado é reconstruído do zero. */
export async function limparConsolidado() {
  const tx = await transacao(['meta'], 'readwrite');
  tx.objectStore('meta').delete('consolidado');
  await fim(tx);
}

/** Apaga tudo. Usado só por teste e por "recomeçar do zero" nos ajustes. */
export async function apagarTudo() {
  const tx = await transacao(['eventos', 'meta'], 'readwrite');
  tx.objectStore('eventos').clear();
  tx.objectStore('meta').clear();
  await fim(tx);
}
