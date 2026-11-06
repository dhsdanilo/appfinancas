// A tela de bloqueio do andar de cima (design/07-seguranca.md §4.1, D11). O térreo (a captura rápida, index.html) não
// carrega isto: lançar uma compra na fila do mercado continua sem PIN.
//
// Com PIN neste aparelho, o app pede o número ao abrir e de novo quando se volta a ele depois de alguns minutos fora.
// A tela é um <dialog> modal: o navegador deixa o resto inerte e acima de qualquer outra janela, e Esc não fecha.

import { conferirPin, pinAtivo, configuracaoDoPin, devePedirDeNovo, entrarComBiometria, apagarDadosDoAparelho, TAMANHO_DO_PIN } from '../core/pin.js';
import * as sincronia from '../core/sincronia.js';

const MARCACAO = `
<dialog id="tela-bloqueio" class="tela-bloqueio" aria-labelledby="bloqueio-titulo">
  <div class="bloqueio-caixa">
    <img src="icones/icone.svg" width="56" height="56" alt="">
    <h2 id="bloqueio-titulo">Finanças</h2>
    <p class="bloqueio-msg" id="bloqueio-msg" aria-live="polite">Digite o PIN</p>
    <div class="bloqueio-pontos" id="bloqueio-pontos" aria-hidden="true"></div>
    <input class="bloqueio-entrada" id="bloqueio-entrada" type="password" inputmode="numeric" pattern="[0-9]*"
           autocomplete="off" maxlength="${TAMANHO_DO_PIN}" aria-label="PIN">
    <div class="bloqueio-teclas" id="bloqueio-teclas">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-tecla="${n}">${n}</button>`).join('')}
      <button type="button" id="bloqueio-bio" class="bloqueio-lateral" aria-label="Usar biometria" hidden>digital</button>
      <button type="button" data-tecla="0">0</button>
      <button type="button" data-tecla="apagar" class="bloqueio-lateral" aria-label="Apagar um dígito">⌫</button>
    </div>
    <button type="button" class="elo" id="bloqueio-esqueci">esqueci o PIN</button>
    <div class="bloqueio-esqueci" id="bloqueio-esqueci-caixa" hidden>
      <p id="bloqueio-esqueci-texto"></p>
      <input type="text" id="bloqueio-apagar" autocomplete="off" autocapitalize="characters" placeholder="digite APAGAR">
      <div class="bloqueio-acoes">
        <button type="button" id="bloqueio-apagar-sim">Apagar os dados deste aparelho</button>
        <button type="button" class="elo" id="bloqueio-apagar-nao">voltar</button>
      </div>
    </div>
  </div>
</dialog>`;

let dialogo = null;
let minutos = 3;
let travado = false;
let saiuEm = null;
let digitado = '';
let esperaAte = 0;
let temporizador = null;

const $ = (id) => document.getElementById(id);

function pintarPontos() {
  $('bloqueio-pontos').innerHTML = Array.from({ length: TAMANHO_DO_PIN }, (_, i) => `<i class="${i < digitado.length ? 'cheio' : ''}"></i>`).join('');
}

function dizer(texto, erro = false) {
  $('bloqueio-msg').textContent = texto;
  $('bloqueio-msg').classList.toggle('erro', erro);
}

/** Enquanto o app faz esperar, as teclas ficam paradas e a frase mostra a contagem. */
function esperar(ms) {
  esperaAte = Date.now() + ms;
  clearInterval(temporizador);
  const passo = () => {
    const resta = esperaAte - Date.now();
    const parado = resta > 0;
    for (const b of $('bloqueio-teclas').querySelectorAll('button')) b.disabled = parado;
    $('bloqueio-entrada').disabled = parado;
    if (parado) {
      const s = Math.ceil(resta / 1000);
      dizer(s >= 60 ? `Muitos erros: espere ${Math.ceil(s / 60)} min` : `Muitos erros: espere ${s} s`, true);
    } else {
      clearInterval(temporizador);
      dizer('Digite o PIN');
      $('bloqueio-entrada').focus();
    }
  };
  passo();
  temporizador = setInterval(passo, 500);
}

async function tentar() {
  const pin = digitado;
  digitado = '';
  $('bloqueio-entrada').value = '';
  pintarPontos();
  const r = await conferirPin(pin);
  if (r.ok) { destravar(); return; }
  dialogo.classList.remove('balanca');
  void dialogo.offsetWidth; // reinicia a animação
  dialogo.classList.add('balanca');
  if (r.esperarMs) esperar(r.esperarMs);
  else dizer(`PIN errado${r.restantes ? ` · ${r.restantes} ${r.restantes === 1 ? 'tentativa' : 'tentativas'} antes de esperar` : ''}`, true);
}

function tecla(valor) {
  if (esperaAte > Date.now()) return;
  if (valor === 'apagar') digitado = digitado.slice(0, -1);
  else if (digitado.length < TAMANHO_DO_PIN) digitado += valor;
  $('bloqueio-entrada').value = digitado;
  pintarPontos();
  if (digitado.length === TAMANHO_DO_PIN) tentar();
}

function destravar() {
  travado = false;
  saiuEm = null;
  clearInterval(temporizador);
  dialogo.close();
}

async function travar() {
  if (travado) return;
  travado = true;
  digitado = '';
  // Uma janela aberta com coisa pela metade é fechada: depois de minutos fora, o que se vê tem de ser só o PIN.
  for (const d of document.querySelectorAll('dialog[open]')) if (d !== dialogo) d.close();
  $('bloqueio-entrada').value = '';
  pintarPontos();
  dizer('Digite o PIN');
  $('bloqueio-esqueci-caixa').hidden = true;
  $('bloqueio-esqueci').hidden = false;
  for (const b of $('bloqueio-teclas').querySelectorAll('button')) b.disabled = false;
  $('bloqueio-entrada').disabled = false;
  const cfg = await configuracaoDoPin();
  $('bloqueio-bio').hidden = !cfg?.biometria;
  if (!dialogo.open) dialogo.showModal();
  $('bloqueio-entrada').focus();
  if (cfg?.biometria) biometria();
}

async function biometria() {
  if (await entrarComBiometria()) destravar();
}

async function esqueci() {
  const pareado = Boolean(await sincronia.configuracao());
  $('bloqueio-esqueci').hidden = true;
  $('bloqueio-esqueci-caixa').hidden = false;
  $('bloqueio-esqueci-texto').textContent = pareado
    ? 'Sem o PIN, o jeito é apagar os dados deste aparelho e parear de novo: os lançamentos voltam pela sincronização (os que ainda não subiram se perdem). Digite APAGAR para confirmar.'
    : 'Este aparelho NÃO está pareado com a sincronização: apagar os dados daqui perde TUDO que está nele, sem volta. Só faça isso se tiver uma cópia de segurança. Digite APAGAR para confirmar.';
  $('bloqueio-apagar').value = '';
  $('bloqueio-apagar').focus();
}

async function ligar() {
  document.body.insertAdjacentHTML('beforeend', MARCACAO);
  dialogo = $('tela-bloqueio');
  dialogo.addEventListener('cancel', (e) => e.preventDefault());
  $('bloqueio-teclas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tecla]');
    if (b) tecla(b.dataset.tecla);
  });
  // Teclado de verdade (no computador): digita direto.
  $('bloqueio-entrada').addEventListener('input', (e) => {
    digitado = e.target.value.replace(/\D/g, '').slice(0, TAMANHO_DO_PIN);
    e.target.value = digitado;
    pintarPontos();
    if (digitado.length === TAMANHO_DO_PIN) tentar();
  });
  $('bloqueio-bio').addEventListener('click', biometria);
  $('bloqueio-esqueci').addEventListener('click', esqueci);
  $('bloqueio-apagar-nao').addEventListener('click', () => {
    $('bloqueio-esqueci-caixa').hidden = true;
    $('bloqueio-esqueci').hidden = false;
    $('bloqueio-entrada').focus();
  });
  $('bloqueio-apagar-sim').addEventListener('click', async () => {
    if ($('bloqueio-apagar').value.trim().toUpperCase() !== 'APAGAR') { $('bloqueio-apagar').focus(); return; }
    await apagarDadosDoAparelho();
    location.reload();
  });

  // Fora do app por `minutos`: pede de novo.
  const saiu = () => { if (!travado && saiuEm == null) saiuEm = Date.now(); };
  const voltou = async () => {
    if (travado) return;
    const cfg = await configuracaoDoPin();
    if (!cfg) { saiuEm = null; return; }
    minutos = cfg.minutos;
    if (devePedirDeNovo(saiuEm, Date.now(), minutos)) travar();
    else saiuEm = null;
  };
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? saiu() : voltou()));
  window.addEventListener('pagehide', saiu);
  window.addEventListener('pageshow', (e) => { if (e.persisted) voltou(); });
}

/**
 * Chamada antes de qualquer tela: decide, sem piscar o conteúdo, se o app abre travado. Sem PIN, só libera a página.
 * Quem cria ou tira o PIN em Configurações chama `avisarMudanca()` para o app passar a valer na hora.
 */
export async function iniciarBloqueio() {
  try {
    await ligar();
    if (await pinAtivo()) await travar();
  } catch {
    // Se o bloqueio quebrar, o app abre: melhor um app aberto que uma tela em branco sem saída.
  } finally {
    document.documentElement.classList.remove('aguarda-bloqueio');
  }
}

/** Em Configurações, depois de criar/tirar o PIN: o app passa a (não) cobrar sem precisar recarregar. */
export async function avisarMudanca() {
  const cfg = await configuracaoDoPin();
  if (cfg) minutos = cfg.minutos;
  saiuEm = null;
}
