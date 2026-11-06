// "Proteção do aparelho" em Configurações › Avançado: criar, trocar e tirar o PIN, o tempo para pedir de novo e a
// biometria. design/07-seguranca.md §4.1. Um PIN por aparelho: nada disto sincroniza.

import * as pin from '../core/pin.js';
import { avisarMudanca } from './bloqueio.js';

const $ = (id) => document.getElementById(id);

const MARCACAO = `
<dialog id="dialogo-pin" class="dialogo-ciclo" aria-labelledby="pin-titulo">
  <form class="formulario" id="f-pin" autocomplete="off">
    <p class="titulo-bloco" id="pin-titulo">PIN</p>
    <div class="campo" id="pin-campo-atual">
      <label for="pin-atual">PIN de agora</label>
      <input type="password" id="pin-atual" name="atual" inputmode="numeric" pattern="[0-9]*" maxlength="${pin.TAMANHO_DO_PIN}" autocomplete="off">
    </div>
    <div class="campo" id="pin-campo-novo">
      <label for="pin-novo">PIN novo · ${pin.TAMANHO_DO_PIN} números</label>
      <input type="password" id="pin-novo" name="novo" inputmode="numeric" pattern="[0-9]*" maxlength="${pin.TAMANHO_DO_PIN}" autocomplete="off">
    </div>
    <div class="campo" id="pin-campo-repetir">
      <label for="pin-repetir">Repita o PIN novo</label>
      <input type="password" id="pin-repetir" name="repetir" inputmode="numeric" pattern="[0-9]*" maxlength="${pin.TAMANHO_DO_PIN}" autocomplete="off">
    </div>
    <p class="aviso erro" id="pin-aviso" hidden></p>
    <div class="campo acao"><button type="submit" class="principal" id="pin-ok">Salvar</button></div>
    <div class="campo acao"><button type="button" id="pin-cancelar">Cancelar</button></div>
  </form>
</dialog>`;

let modo = 'criar'; // 'criar' | 'trocar' | 'remover'

function aviso(texto) {
  $('pin-aviso').textContent = texto;
  $('pin-aviso').hidden = !texto;
}

async function pintar() {
  const cfg = await pin.configuracaoDoPin();
  $('pin-estado').textContent = cfg
    ? `Ligado. O app pede o PIN ao abrir e depois de ${cfg.minutos} min fora dele${cfg.biometria ? ', ou a biometria do aparelho' : ''}.`
    : 'Sem PIN: quem abrir o app com o celular destravado vê tudo. A captura rápida (a tela de lançar) nunca pede PIN.';
  $('pin-definir').hidden = Boolean(cfg);
  $('pin-trocar').hidden = !cfg;
  $('pin-remover').hidden = !cfg;
  $('pin-campo-tempo').hidden = !cfg;
  if (cfg) $('pin-minutos').value = String(cfg.minutos);
  const bioPossivel = cfg && (await pin.biometriaDisponivel());
  $('pin-campo-bio').hidden = !bioPossivel;
  if (bioPossivel) $('pin-bio').checked = cfg.biometria;
}

function abrir(como) {
  modo = como;
  $('f-pin').reset();
  aviso('');
  $('pin-titulo').textContent = como === 'criar' ? 'Criar o PIN deste aparelho' : como === 'trocar' ? 'Trocar o PIN' : 'Tirar o PIN';
  $('pin-campo-atual').hidden = como === 'criar';
  $('pin-campo-novo').hidden = como === 'remover';
  $('pin-campo-repetir').hidden = como === 'remover';
  $('pin-ok').textContent = como === 'remover' ? 'Tirar o PIN' : 'Salvar';
  $('dialogo-pin').showModal();
  (como === 'criar' ? $('pin-novo') : $('pin-atual')).focus();
}

async function salvar(e) {
  e.preventDefault();
  const f = $('f-pin').elements;
  try {
    if (modo !== 'criar') {
      // O PIN de agora vale antes de qualquer mudança: confere aqui só para dar a frase certa.
      const r = await pin.conferirPin(f.atual.value);
      if (!r.ok) {
        aviso(r.esperarMs ? `Muitos erros: espere ${Math.ceil(r.esperarMs / 1000)} s.` : 'O PIN de agora não confere.');
        return;
      }
    }
    if (modo === 'remover') {
      await pin.removerPin(f.atual.value);
    } else {
      if (!pin.pinValido(f.novo.value)) { aviso(`O PIN tem ${pin.TAMANHO_DO_PIN} números.`); return; }
      if (f.novo.value !== f.repetir.value) { aviso('Os dois PINs não são iguais.'); return; }
      if (/^(\d)\1+$/.test(f.novo.value) || '0123456789012345'.includes(f.novo.value) || '9876543210987654'.includes(f.novo.value)) {
        aviso('Esse PIN é fácil demais de adivinhar (repetido ou em sequência). Escolha outro.');
        return;
      }
      if (modo === 'trocar') await pin.trocarPin(f.atual.value, f.novo.value);
      else await pin.definirPin(f.novo.value);
    }
    $('dialogo-pin').close();
    await avisarMudanca();
    await pintar();
  } catch (erro) {
    aviso(erro.message);
  }
}

function ligar() {
  if (!$('pin-estado')) return;
  document.body.insertAdjacentHTML('beforeend', MARCACAO);
  $('pin-definir').addEventListener('click', () => abrir('criar'));
  $('pin-trocar').addEventListener('click', () => abrir('trocar'));
  $('pin-remover').addEventListener('click', () => abrir('remover'));
  $('pin-cancelar').addEventListener('click', () => $('dialogo-pin').close());
  $('f-pin').addEventListener('submit', salvar);
  $('pin-minutos').addEventListener('change', async (e) => { await pin.definirMinutos(e.target.value); await avisarMudanca(); await pintar(); });
  $('pin-bio').addEventListener('change', async (e) => {
    try {
      if (e.target.checked) await pin.ligarBiometria();
      else await pin.desligarBiometria();
    } catch {
      // O celular recusou ou o usuário cancelou: fica como estava.
    }
    await pintar();
  });
  document.addEventListener('app:tela', (e) => { if (e.detail.tela === 'configuracoes') pintar(); });
  pintar();
}

ligar();
