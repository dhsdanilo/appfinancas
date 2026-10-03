// A sincronização que acontece sozinha. design/06-sincronizacao.md §3
//
// Regra: ao abrir, depois de cada alteração, e num botão pra quando se quer
// certeza na hora. **Nunca travando a tela** — quem lança não espera a rede.
//
// Escritas seguidas (cinco compras lançadas em sequência) viram UM envio só:
// o relógio rearma a cada alteração e só dispara quando a mão para.

import * as estado from '../core/estado.js';
import * as sincronia from '../core/sincronia.js';

const ESPERA = 2500; // junta escritas seguidas num envio só

let relogio = null;
let ocupado = false;
let sujo = false;
let situacao = { estado: 'parado', texto: '', grave: false };
let carimbo = null;
let botao = null;

/**
 * @param {object} [opcoes]
 * @param {HTMLElement} [opcoes.raiz]  o bloco do carimbo e do botão, se a tela tiver
 */
export async function iniciarSincronia({ raiz } = {}) {
  if (raiz) {
    carimbo = raiz.querySelector('[data-papel="carimbo"]');
    botao = raiz.querySelector('[data-papel="b-nuvem"]');
    if (botao) botao.addEventListener('click', () => agora());
  }

  const config = await sincronia.configuracao();
  if (raiz) raiz.hidden = !config;
  if (!config) return;

  // Toda alteração marca sujo: lançar, corrigir, apagar, criar conta. O núcleo
  // avisa sem saber que a sincronização existe.
  estado.aoAplicar((motivo) => {
    if (motivo === 'local') marcarSujo();
  });

  // Voltar a ter rede, ou voltar pra aba, é hora de conferir.
  addEventListener('online', () => agendar(0));
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') agendar(0);
  });

  await pintar();
  agendar(0); // ao abrir
}

function marcarSujo() {
  sujo = true;
  agendar(ESPERA);
}

function agendar(espera) {
  clearTimeout(relogio);
  relogio = setTimeout(rodar, espera);
}

/** O botão: certeza na hora, sem esperar o relógio. */
export function agora() {
  sujo = true;
  agendar(0);
}

async function rodar() {
  if (ocupado) return; // o que ficou sujo no meio rearma no fim
  ocupado = true;
  sujo = false;
  definir({ estado: 'indo', texto: 'sincronizando…' });

  try {
    const { recebidos, enviados } = await sincronia.sincronizar();
    definir({ estado: 'ok', texto: await textoDoCarimbo(), movimento: recebidos + enviados });
  } catch (erro) {
    // Sem rede não é falha de verdade: a fila espera (§9). O resto fica visível,
    // e o repositório público fica visível em vermelho.
    definir({
      estado: erro.grave ? 'grave' : 'erro',
      texto: erro.grave ? erro.message : resumir(erro),
      grave: Boolean(erro.grave),
    });
  } finally {
    ocupado = false;
    if (sujo) agendar(ESPERA);
  }
}

function resumir(erro) {
  if (/conexão/i.test(erro.message)) return 'sem conexão';
  if (/token/i.test(erro.message)) return 'o token não vale mais';
  return 'não sincronizou';
}

async function textoDoCarimbo() {
  const ultima = await sincronia.ultimaSincronizacao();
  if (!ultima) return 'nunca sincronizou';

  const minutos = Math.floor((Date.now() - new Date(ultima.em)) / 60000);
  if (minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  // Aqui o tom muda de propósito: dois aparelhos longe um do outro é o começo
  // da divergência silenciosa, que é o pior cenário da sincronização.
  return `não sincroniza há ${dias} dia${dias > 1 ? 's' : ''}`;
}

function definir(nova) {
  situacao = { grave: false, ...nova };
  pintar();
}

async function pintar() {
  if (!carimbo) return;
  if (situacao.estado === 'parado') situacao.texto = await textoDoCarimbo();

  carimbo.textContent = situacao.texto;
  carimbo.className = `carimbo ${situacao.estado}`;
  if (botao) {
    botao.disabled = situacao.estado === 'indo';
    botao.classList.toggle('girando', situacao.estado === 'indo');
  }
}
