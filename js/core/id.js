// Identificadores. Ordenáveis por criação, legíveis o bastante pra depurar.

const ALFABETO = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * id com prefixo: "ev_m3k9x1_f8a2". A primeira parte é o tempo em base36
 * (ordena por criação), a segunda é aleatória (evita colisão).
 */
export function novoId(prefixo) {
  const tempo = Date.now().toString(36);
  const aleatorio = sorteio(6);
  return `${prefixo}_${tempo}_${aleatorio}`;
}

function sorteio(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
  return s;
}

/** Nome de aparelho vira identificador de arquivo: "Celular da cozinha" → "celular-da-cozinha". */
export function slug(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
