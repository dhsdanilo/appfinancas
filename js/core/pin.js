// O PIN deste aparelho (design/07-seguranca.md §4.1, D11, 06/11/2026).
//
// É tranca de porta, não cofre: os dados continuam em claro no navegador, e quem sabe abrir as ferramentas de
// desenvolvedor chega neles. O PIN barra quem pega o celular destravado e abre o app (a criança, o curioso). A defesa
// de verdade é o bloqueio de tela do celular.
//
// Um por aparelho: nunca sincroniza (um PIN que sobe vira PIN de todos). Fica no `meta` do banco, como impressão
// criptográfica com sal — nunca o número. Errar o PIN nunca apaga dado: só faz esperar, cada vez mais.

import * as db from './db.js';
import { novoSal, impressao, mesmoTexto } from './cripto.js';

const META = 'pin';
export const TAMANHO_DO_PIN = 6;
export const MINUTOS_PADRAO = 3;
export const MINUTOS_POSSIVEIS = [1, 3, 5, 15];

/** A cada 5 erros seguidos o app faz esperar: 30 s, 1 min, 2 min… até 15 min. Acertar zera. */
export const ERROS_POR_ESPERA = 5;
const ESPERA_INICIAL_MS = 30000;
const ESPERA_MAXIMA_MS = 15 * 60000;

export const pinValido = (pin) => new RegExp(`^\\d{${TAMANHO_DO_PIN}}$`).test(String(pin ?? ''));

export class ErroDoPin extends Error {
  constructor(mensagem, { esperarMs = 0 } = {}) {
    super(mensagem);
    this.name = 'ErroDoPin';
    this.esperarMs = esperarMs;
  }
}

const ler = () => db.lerMeta(META);

/** Tem PIN neste aparelho? */
export async function pinAtivo() {
  return Boolean((await ler())?.hash);
}

/** { minutos, biometria } para a tela; null sem PIN. */
export async function configuracaoDoPin() {
  const p = await ler();
  if (!p?.hash) return null;
  return { minutos: p.minutos ?? MINUTOS_PADRAO, biometria: Boolean(p.bio?.id) };
}

async function gravar(p) {
  await db.gravarMeta(META, p);
  return p;
}

/** Cria o PIN deste aparelho (ou troca, quando já foi conferido o antigo — ver `trocarPin`). */
export async function definirPin(pin, { minutos = MINUTOS_PADRAO } = {}) {
  if (!pinValido(pin)) throw new ErroDoPin(`O PIN tem ${TAMANHO_DO_PIN} dígitos, só números.`);
  const antigo = await ler();
  const sal = novoSal();
  await gravar({
    sal,
    hash: await impressao(pin, sal),
    minutos: antigo?.minutos ?? minutos,
    falhas: 0,
    bloqueadoAte: 0,
    bio: antigo?.bio ?? null,
  });
}

/**
 * Confere o PIN. Devolve { ok, esperarMs }: `esperarMs` > 0 diz que o app está fazendo esperar (nem tenta comparar).
 * `agora` é para os testes.
 */
export async function conferirPin(pin, agora = Date.now()) {
  const p = await ler();
  if (!p?.hash) return { ok: true, esperarMs: 0 };
  if ((p.bloqueadoAte ?? 0) > agora) return { ok: false, esperarMs: p.bloqueadoAte - agora };

  const bate = pinValido(pin) && mesmoTexto(await impressao(pin, p.sal), p.hash);
  if (bate) {
    if (p.falhas || p.bloqueadoAte) await gravar({ ...p, falhas: 0, bloqueadoAte: 0 });
    return { ok: true, esperarMs: 0 };
  }

  const falhas = (p.falhas ?? 0) + 1;
  let bloqueadoAte = 0;
  if (falhas % ERROS_POR_ESPERA === 0) {
    const rodada = falhas / ERROS_POR_ESPERA;
    bloqueadoAte = agora + Math.min(ESPERA_MAXIMA_MS, ESPERA_INICIAL_MS * 2 ** (rodada - 1));
  }
  await gravar({ ...p, falhas, bloqueadoAte });
  return { ok: false, esperarMs: bloqueadoAte ? bloqueadoAte - agora : 0, restantes: ERROS_POR_ESPERA - (falhas % ERROS_POR_ESPERA) };
}

async function exigirAtual(atual) {
  const r = await conferirPin(atual);
  if (!r.ok) {
    throw new ErroDoPin(r.esperarMs ? 'Muitos erros: espere um pouco.' : 'O PIN de agora não confere.', { esperarMs: r.esperarMs });
  }
}

export async function trocarPin(atual, novo) {
  await exigirAtual(atual);
  await definirPin(novo);
}

/** Tirar o PIN também exige o PIN: senão quem pega o celular destravado o tira em dois toques. */
export async function removerPin(atual) {
  await exigirAtual(atual);
  await db.gravarMeta(META, null);
}

export async function definirMinutos(minutos) {
  const p = await ler();
  if (!p?.hash) return;
  await gravar({ ...p, minutos: MINUTOS_POSSIVEIS.includes(Number(minutos)) ? Number(minutos) : MINUTOS_PADRAO });
}

/**
 * O app, de volta à tela depois de `saiuEm`, deve pedir o PIN de novo? Só depois de `minutos` fora: trocar de app
 * rapidinho não incomoda.
 */
export function devePedirDeNovo(saiuEm, agora, minutos) {
  if (saiuEm == null) return false;
  return agora - saiuEm >= minutos * 60000;
}

/** Esquecer o PIN não tem volta por e-mail: só apagando os dados do aparelho (eles voltam pela sincronização). */
export async function apagarDadosDoAparelho() {
  await db.apagarTudo();
}

// ── biometria do aparelho (WebAuthn) ────────────────────────────────────────
//
// Atalho, não garantia: sem servidor não há como verificar a assinatura, então o que vale é o próprio celular ter
// pedido a digital ou o rosto. O PIN continua existindo, e é ele que protege se a biometria falhar.

export async function biometriaDisponivel() {
  try {
    return Boolean(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

const bytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const paraTexto = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deTexto = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

export async function ligarBiometria() {
  const p = await ler();
  if (!p?.hash) throw new ErroDoPin('Crie o PIN antes.');
  const credencial = await navigator.credentials.create({
    publicKey: {
      challenge: bytes(32),
      rp: { name: 'App Finanças' },
      user: { id: bytes(16), name: 'este-aparelho', displayName: 'Este aparelho' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  });
  await gravar({ ...p, bio: { id: paraTexto(credencial.rawId) } });
}

export async function desligarBiometria() {
  const p = await ler();
  if (p?.hash) await gravar({ ...p, bio: null });
}

/** true se o celular confirmou a biometria. */
export async function entrarComBiometria() {
  const p = await ler();
  if (!p?.bio?.id) return false;
  try {
    const r = await navigator.credentials.get({
      publicKey: {
        challenge: bytes(32),
        allowCredentials: [{ type: 'public-key', id: deTexto(p.bio.id) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return Boolean(r);
  } catch {
    return false;
  }
}
