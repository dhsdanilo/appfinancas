// A criptografia da sincronização. design/06-sincronizacao.md §11
//
// O que sobe pro GitHub é ilegível; o que fica no aparelho continua em claro —
// é isso que mantém o térreo lançando sem senha (D11).
//
// Tudo vem do WebCrypto do próprio navegador. Nenhuma biblioteca de fora: a
// regra de zero requisição externa (07-seguranca §3) vale aqui como em todo o
// resto, e criptografia é justamente o lugar onde emprestar código alheio é
// pior ideia.

const ITERACOES = 310000; // PBKDF2-SHA-256, recomendação OWASP de 2023
const SELO = 'app-financas';

const texto = new TextEncoder();
const letras = new TextDecoder();

/** Sal novo, para uma família que está começando. Sal não é segredo. */
export function novoSal() {
  return paraBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * A chave vem de uma FRASE, nunca de um PIN: quatro dígitos viram chave fraca,
 * e chave fraca dá sensação de segurança maior que a real.
 *
 * Devolve uma chave não-exportável: ela pode ser guardada no IndexedDB do
 * aparelho, mas nem o app consegue ler os bytes dela de volta.
 */
export async function derivarChave(frase, salBase64) {
  const semente = await crypto.subtle.importKey(
    'raw',
    texto.encode(String(frase).normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: deBase64(salBase64),
      iterations: ITERACOES,
      hash: 'SHA-256',
    },
    semente,
    { name: 'AES-GCM', length: 256 },
    false, // não-exportável: guarda-se a chave, nunca a frase
    ['encrypt', 'decrypt']
  );
}

/**
 * Um nonce novo a cada chamada — é o que permite continuar acrescentando linhas
 * ao fim do arquivo sem reescrever nada. Append-only continua append-only.
 */
export async function cifrar(chave, textoClaro) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    chave,
    texto.encode(textoClaro)
  );
  // nonce na frente do corpo: a linha carrega tudo que precisa pra ser lida.
  return paraBase64(juntar(nonce, new Uint8Array(cifrado)));
}

export async function decifrar(chave, cifradoBase64) {
  const bytes = deBase64(cifradoBase64);
  const nonce = bytes.slice(0, 12);
  const corpo = bytes.slice(12);
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, chave, corpo);
  return letras.decode(claro);
}

/**
 * O selo é um texto conhecido, cifrado, guardado junto do sal no repositório.
 * Sem ele, frase errada produziria lixo em silêncio — e dado financeiro
 * ilegível em silêncio é a pior falha possível.
 */
export function criarSelo(chave) {
  return cifrar(chave, SELO);
}

export async function seloConfere(chave, seloCifrado) {
  try {
    return (await decifrar(chave, seloCifrado)) === SELO;
  } catch {
    // AES-GCM falha a autenticação quando a chave está errada. Isso não é
    // defeito: é exatamente o aviso que se quer.
    return false;
  }
}

// ── base64 ────────────────────────────────────────────────────────────────
//
// `btoa` só entende bytes, e o histórico tem acento em tudo. A conversão passa
// pelos bytes de propósito, nunca pela string direta.

function paraBase64(bytes) {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function deBase64(base64) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function juntar(a, b) {
  const tudo = new Uint8Array(a.length + b.length);
  tudo.set(a, 0);
  tudo.set(b, a.length);
  return tudo;
}
