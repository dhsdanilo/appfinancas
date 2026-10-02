// Ajustes: o pareamento e a sincronização. design/06-sincronizacao.md §8
//
// Duas telas numa: antes de parear, o formulário; depois, o estado e o botão.
// Nunca com modal, nunca bloqueando, nunca perdendo lançamento (§9) — falha de
// sincronização é uma frase na tela, não um susto.

import * as db from './core/db.js';
import * as log from './core/log.js';
import * as sincronia from './core/sincronia.js';
import { instalarServiceWorker } from './app/instalar.js';

const $ = (id) => document.getElementById(id);

let config = null;

// ── pintura ───────────────────────────────────────────────────────────────

async function recarregar() {
  config = await sincronia.configuracao();
  $('painel-pareado').hidden = !config;
  $('painel-parear').hidden = Boolean(config);
  if (config) await pintarEstado();
  else await pintarSugestaoDeNome();
}

async function pintarEstado() {
  const ultima = await sincronia.ultimaSincronizacao();
  const meus = (await db.eventosEmOrdem({})).filter((ev) => ev.ap === config.aparelho).length;

  $('estado-sincronia').innerHTML = `
    <dt>Repositório</dt><dd>${escapar(config.repo)} <span class="selo-privado">privado</span></dd>
    <dt>Este aparelho</dt><dd>${escapar(config.aparelho)}.ndjson · ${meus} evento${meus === 1 ? '' : 's'}</dd>
    <dt>Última sincronização</dt><dd>${ultima ? descreverUltima(ultima) : 'ainda não'}</dd>
  `;

  $('zona-esquecer').innerHTML =
    '<button type="button" class="elo" data-papel="esquecer">esquecer este aparelho</button>';
}

/**
 * "não sincroniza há 2 dias" é mais útil que um carimbo de hora: o que importa
 * é saber se os aparelhos estão perto ou longe um do outro (§9).
 */
function descreverUltima({ em, recebidos, enviados }) {
  const dias = Math.floor((Date.now() - new Date(em)) / 86400000);
  const quando = dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
  const movimento =
    recebidos || enviados
      ? ` · ${enviados} enviado${enviados === 1 ? '' : 's'}, ${recebidos} recebido${recebidos === 1 ? '' : 's'}`
      : ' · nada novo';
  return `${quando}, ${new Date(em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${movimento}`;
}

async function pintarSugestaoDeNome() {
  const aparelho = await log.aparelho();
  const campo = $('f-parear').elements.aparelho;
  if (aparelho && !campo.value) campo.value = aparelho.nome;
}

// ── ações ─────────────────────────────────────────────────────────────────

$('f-parear').addEventListener('submit', async (e) => {
  e.preventDefault();
  const campos = e.target.elements;
  const botao = e.target.querySelector('[type="submit"]');

  botao.disabled = true;
  dizer('Conferindo o repositório…');
  try {
    const { primeiro } = await sincronia.parear({
      repo: campos.repo.value.trim(),
      token: campos.token.value.trim(),
      frase: campos.frase.value,
      aparelho: campos.aparelho.value.trim(),
    });

    // O token e a frase saem da tela assim que viram chave guardada.
    campos.token.value = '';
    campos.frase.value = '';

    avisar(
      primeiro
        ? 'Pareado. Este é o primeiro aparelho: a frase que você digitou é a que os outros vão precisar.'
        : 'Pareado. A frase confere com a que já estava em uso.',
      'ok'
    );
    await recarregar();
    await sincronizar();
  } catch (erro) {
    mostrarErro(erro);
  } finally {
    botao.disabled = false;
    dizer('');
  }
});

$('b-sincronizar').addEventListener('click', () => sincronizar());

$('zona-esquecer').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-papel="esquecer"]')) return;
  if (e.target.dataset.papel === 'esquecer') return pedirParaEsquecer();
  if (e.target.dataset.papel === 'esquecer-nao') return pintarEstado();
  if (e.target.dataset.papel === 'esquecer-sim') {
    await sincronia.esquecerAparelho();
    avisar('Pronto: o token e a chave sumiram deste aparelho. Os lançamentos continuam aqui.', 'ok');
    await recarregar();
  }
});

function pedirParaEsquecer() {
  $('zona-esquecer').innerHTML =
    '<span class="pergunta">esquecer o token e a chave deste aparelho? os lançamentos ficam</span>' +
    '<button type="button" class="perigo" data-papel="esquecer-sim">esquecer</button>' +
    '<button type="button" class="elo" data-papel="esquecer-nao">não</button>';
}

async function sincronizar() {
  const botao = $('b-sincronizar');
  botao.disabled = true;
  dizer('Sincronizando…');
  try {
    const { recebidos, enviados } = await sincronia.sincronizar();
    avisar(
      recebidos || enviados
        ? `Pronto: ${enviados} enviado${enviados === 1 ? '' : 's'}, ${recebidos} recebido${recebidos === 1 ? '' : 's'}.`
        : 'Pronto: já estava tudo no lugar.',
      'ok'
    );
  } catch (erro) {
    mostrarErro(erro);
  } finally {
    botao.disabled = false;
    dizer('');
    await recarregar();
  }
}

// ── recados ───────────────────────────────────────────────────────────────

function mostrarErro(erro) {
  // Repositório público é a única coisa que este app trata como emergência
  // (07-seguranca §4.2): ele não some sozinho e não se resolve depois.
  avisar(erro.message, erro.grave ? 'grave' : 'erro');
  if (!erro.grave) console.warn(erro);
}

function avisar(mensagem, tom = 'ok') {
  const el = $('aviso');
  el.textContent = mensagem;
  el.className = `aviso ${tom}`;
  el.hidden = !mensagem;
}

const dizer = (texto) => {
  $('progresso').textContent = texto;
};

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── partida ───────────────────────────────────────────────────────────────

await recarregar();
instalarServiceWorker();
