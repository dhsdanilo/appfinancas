// As janelas dos envelopes (design/11): criar e editar um envelope, distribuir
// o sem dono de um lugar, tirar dinheiro de um envelope, e o bloco "de quem é o
// dinheiro que sai" das janelas que movem dinheiro.
//
// Aportar e tirar não mexem em saldo de conta nenhuma: só mudam de quem o
// dinheiro é, no mesmo lugar (design/11 §3).

import * as estado from '../core/estado.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { hoje } from '../core/datas.js';
import {
  envelopesAtivos, ehProjeto, donosNoDia, numerosDoEnvelope, nomeDoLugar, envelopesNoLugar,
} from '../core/envelopes.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const campoReais = (v) => (v ? formatar(v, { comPrefixo: false }) : '');

const MARCACAO = `
<dialog id="dialogo-envelope" class="dialogo-captura dialogo-envelope" data-area="envelopes" aria-labelledby="titulo-envelope">
  <div class="cabecalho-dialogo">
    <strong id="titulo-envelope">Novo envelope</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples">
    <label class="campo-simples"><span class="miudo">nome</span>
      <input type="text" data-env="nome" autocomplete="off" placeholder="Reserva de emergência, IPVA 2027, Viagem"></label>
    <div class="pilulas" role="group" aria-label="Como funciona" data-env="jeito">
      <button type="button" data-jeito="acumula" aria-pressed="true">acumula</button>
      <button type="button" data-jeito="projeto" aria-pressed="false">projeto</button>
    </div>
    <p class="nota" data-env="pista-jeito"></p>
    <div class="linha-operacao">
      <label class="campo-simples"><span class="miudo" data-env="rotulo-alvo">alvo · opcional</span>
        <input type="text" inputmode="decimal" data-env="alvo" autocomplete="off" placeholder="0,00"></label>
      <label class="campo-simples" data-env="campo-inicio"><span class="miudo">começa em</span>
        <input type="date" data-env="inicio"></label>
      <label class="campo-simples" data-env="campo-data"><span class="miudo">até</span>
        <input type="date" data-env="data"></label>
    </div>
    <p class="recado" data-env="recado" hidden></p>
    <div class="acoes"><button type="button" class="principal" data-env="b-salvar">Criar</button></div>
    <p class="zona-perigo fim-contrato" data-env="perigo" hidden>
      <button type="button" class="elo" data-env="b-arquivar"></button>
      <button type="button" class="elo perigo" data-env="b-excluir">excluir</button>
    </p>
  </div>
</dialog>

<dialog id="dialogo-distribuir" class="dialogo-captura dialogo-envelope" data-area="envelopes" aria-labelledby="titulo-distribuir">
  <div class="cabecalho-dialogo">
    <strong id="titulo-distribuir">Distribuir</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples">
    <p class="nota" data-dist="cabeca"></p>
    <label class="campo-simples" data-dist="campo-inteiro" hidden><span class="miudo">este lugar inteiro é de</span>
      <select data-dist="inteiro"></select></label>
    <ol class="linhas-distribuir" data-dist="linhas"></ol>
    <p class="fica-sem-dono" data-dist="sobra"></p>
    <label class="campo-simples campo-data-dist"><span class="miudo">data</span>
      <input type="date" data-dist="data"></label>
    <p class="recado" data-dist="recado" hidden></p>
    <div class="acoes"><button type="button" class="principal" data-dist="b-ok">Distribuir</button></div>
  </div>
</dialog>

<dialog id="dialogo-mover-envelope" class="dialogo-captura dialogo-envelope" data-area="envelopes" aria-labelledby="titulo-mover-envelope">
  <div class="cabecalho-dialogo">
    <strong id="titulo-mover-envelope">Tirar do envelope</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples">
    <div class="linha-operacao">
      <label class="campo-simples"><span class="miudo">de onde</span>
        <select data-mov="lugar"></select></label>
      <label class="campo-simples"><span class="miudo">valor</span>
        <input type="text" inputmode="decimal" data-mov="valor" autocomplete="off" placeholder="0,00"></label>
      <label class="campo-simples"><span class="miudo">vai para</span>
        <select data-mov="para"></select></label>
      <label class="campo-simples"><span class="miudo">data</span>
        <input type="date" data-mov="data"></label>
    </div>
    <p class="nota">Não mexe em conta nenhuma: o dinheiro continua onde está e só muda de dono.</p>
    <p class="recado" data-mov="recado" hidden></p>
    <div class="acoes"><button type="button" class="principal" data-mov="b-ok">Tirar</button></div>
  </div>
</dialog>`;

/**
 * As três janelas. `aoSalvar` repinta quem chamou.
 */
// As janelas existem uma vez só; cada tela que as usa só se inscreve para
// repintar quando algo for salvo.
let janelas = null;
const repintar = new Set();

export function criarJanelasDeEnvelope({ aoSalvar } = {}) {
  if (aoSalvar) repintar.add(aoSalvar);
  if (janelas) return janelas;
  document.body.insertAdjacentHTML('beforeend', MARCACAO);
  const fichaJ = document.getElementById('dialogo-envelope');
  const distJ = document.getElementById('dialogo-distribuir');
  const movJ = document.getElementById('dialogo-mover-envelope');
  for (const j of [fichaJ, distJ, movJ]) j.querySelector('[data-fechar]').addEventListener('click', () => j.close());
  const env = (p) => fichaJ.querySelector(`[data-env="${p}"]`);
  const dist = (p) => distJ.querySelector(`[data-dist="${p}"]`);
  const mov = (p) => movJ.querySelector(`[data-mov="${p}"]`);
  const recado = (el, t) => { el.textContent = t; el.hidden = !t; };
  const depois = async () => { for (const fn of repintar) await fn(); };

  // ── a ficha ─────────────────────────────────────────────────────────────

  let editando = null;
  let jeito = 'acumula';

  function pintarJeito() {
    for (const b of env('jeito').querySelectorAll('[data-jeito]')) b.setAttribute('aria-pressed', String(b.dataset.jeito === jeito));
    const projeto = jeito === 'projeto';
    env('campo-inicio').hidden = !projeto;
    env('campo-data').hidden = !projeto;
    env('rotulo-alvo').textContent = projeto ? 'alvo' : 'alvo · opcional';
    env('pista-jeito').textContent = projeto
      ? 'Começo, alvo e data: junta, é gasto, e você encerra. IPVA e seguro são projeto — um por ano.'
      : 'Sem fim: só acumula. Reserva de emergência, aposentadoria.';
  }

  env('jeito').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jeito]');
    if (!b) return;
    jeito = b.dataset.jeito;
    pintarJeito();
  });

  env('b-salvar').addEventListener('click', async () => {
    const nome = env('nome').value.trim();
    if (!nome) { env('nome').focus(); return; }
    const alvoValor = Math.abs(deTexto(env('alvo').value)) || null;
    const dados = { nome, alvoValor, inicio: null, alvoData: null };
    if (jeito === 'projeto') {
      dados.inicio = env('inicio').value || hoje();
      dados.alvoData = env('data').value || null;
      if (!alvoValor || !dados.alvoData) { recado(env('recado'), 'Projeto precisa de alvo e data.'); return; }
      if (dados.alvoData < dados.inicio) { recado(env('recado'), 'A data do alvo vem depois do começo.'); return; }
    }
    recado(env('recado'), '');
    if (editando) await estado.aplicarEvento('envelope.alterado', { id: editando.id, ...dados });
    else await estado.aplicarEvento('envelope.criado', { id: novoId('env'), ...dados });
    fichaJ.close();
    await depois();
  });
  env('nome').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); env('b-salvar').click(); } });

  env('b-arquivar').addEventListener('click', async () => {
    await estado.aplicarEvento('envelope.arquivado', { id: editando.id, arquivado: !editando.arquivado });
    fichaJ.close();
    await depois();
  });
  env('b-excluir').addEventListener('click', async () => {
    const b = env('b-excluir');
    if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'excluir mesmo?'; return; }
    await estado.aplicarEvento('envelope.removido', { id: editando.id });
    fichaJ.close();
    await depois();
  });

  async function abrirFicha(envelopeId = null) {
    const app = await estado.calcular();
    editando = envelopeId ? app.envelopes?.[envelopeId] ?? null : null;
    jeito = editando && ehProjeto(editando) ? 'projeto' : 'acumula';
    document.getElementById('titulo-envelope').textContent = editando ? `Editar ${editando.nome}` : 'Novo envelope';
    env('nome').value = editando?.nome ?? '';
    env('alvo').value = campoReais(editando?.alvoValor);
    env('inicio').value = editando?.inicio ?? hoje();
    env('data').value = editando?.alvoData ?? '';
    env('b-salvar').textContent = editando ? 'Salvar' : 'Criar';
    env('perigo').hidden = !editando;
    if (editando) {
      env('b-arquivar').textContent = editando.arquivado ? 'desarquivar' : 'arquivar';
      // Só se exclui o envelope que nunca recebeu nada; o resto se arquiva.
      const usado = Object.values(app.alocacoes ?? {}).some((a) => a.de === editando.id || a.para === editando.id)
        || (editando.inteiros ?? []).length > 0;
      env('b-excluir').hidden = usado;
      env('b-excluir').dataset.confirmar = '';
      env('b-excluir').textContent = 'excluir';
    }
    recado(env('recado'), '');
    pintarJeito();
    fichaJ.showModal();
    env('nome').focus();
  }

  // ── distribuir o sem dono de um lugar (§3.2) ─────────────────────────────

  let lugarId = null;
  let semDono = 0;

  function lerLinhas() {
    return [...dist('linhas').querySelectorAll('[data-dist-env]')]
      .map((i) => ({ envelopeId: i.dataset.distEnv, valor: Math.abs(deTexto(i.value)) }))
      .filter((x) => x.valor > 0);
  }

  function pintarSobra() {
    const total = lerLinhas().reduce((t, x) => t + x.valor, 0);
    const fica = semDono - total;
    dist('sobra').textContent = `fica sem dono ${fica < 0 ? '−' : ''}${formatar(Math.abs(fica))}`;
    dist('sobra').classList.toggle('negativo', fica < 0);
  }

  async function abrirDistribuir(idDoLugar, { envelopeId = null } = {}) {
    const app = await estado.calcular();
    lugarId = idDoLugar;
    const r = donosNoDia(app).porLugar.get(lugarId);
    semDono = Math.max(0, r?.semDono ?? 0);
    const ativo = app.ativos?.[lugarId];
    document.getElementById('titulo-distribuir').textContent = `Distribuir · ${nomeDoLugar(app, lugarId)}`;
    dist('cabeca').textContent = `sem dono ${formatar(semDono)}${ativo ? ` · ${app.contas[ativo.contaId]?.nome ?? ''}` : ''}. Cada linha vira um aporte no envelope; nada sai do lugar.`;

    // "Inteiro" só onde rende: a previdência que é toda da aposentadoria.
    const rende = r?.lugar.tipo === 'fracao';
    dist('campo-inteiro').hidden = !rende;
    const lista = envelopesAtivos(app);
    const dono = lista.find((v) => (v.inteiros ?? []).includes(lugarId));
    dist('inteiro').innerHTML = `<option value="">— cada aporte decide</option>${lista.map((v) => `<option value="${esc(v.id)}"${v === dono ? ' selected' : ''}>${esc(v.nome)}</option>`).join('')}`;

    const totais = donosNoDia(app).porEnvelope;
    dist('linhas').innerHTML = lista.map((v) => {
      const tem = totais.get(v.id)?.total ?? 0;
      const n = numerosDoEnvelope(v, tem);
      const ali = r?.donos.get(v.id) ?? 0;
      const dica = [
        n.deveriaTer != null ? `deveria ter ${formatar(n.deveriaTer)}` : '',
        `tem ${formatar(tem)}${ali ? ` (${formatar(ali)} aqui)` : ''}`,
        n.falta ? `falta ${formatar(n.falta)}` : '',
      ].filter(Boolean).join(' · ');
      // A sugestão é o que falta para o "deveria ter": um toque preenche.
      const sugestao = n.deveriaTer != null && n.deveriaTer > tem ? Math.min(semDono, n.deveriaTer - tem) : 0;
      return `<li class="linha-distribuir">
        <span class="nome-dist">${esc(v.nome)}<span class="fino">${esc(dica)}</span>
          ${sugestao > 0 ? `<button type="button" class="elo" data-sugerir="${esc(v.id)}">pôr ${formatar(sugestao)}, o que falta para o ritmo</button>` : ''}</span>
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" data-dist-env="${esc(v.id)}" aria-label="Aportar em ${esc(v.nome)}"
          ${sugestao > 0 ? `data-sugestao="${sugestao}"` : ''}>
      </li>`;
    }).join('') || '<li class="vazio">Nenhum envelope ainda.</li>';
    dist('data').value = hoje();
    recado(dist('recado'), '');
    pintarSobra();
    distJ.showModal();
    const alvo = envelopeId ? dist('linhas').querySelector(`[data-dist-env="${CSS.escape(envelopeId)}"]`) : dist('linhas').querySelector('input');
    alvo?.focus();
  }

  dist('linhas').addEventListener('input', pintarSobra);
  dist('linhas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sugerir]');
    if (!b) return;
    const i = dist('linhas').querySelector(`[data-dist-env="${CSS.escape(b.dataset.sugerir)}"]`);
    i.value = campoReais(Number(i.dataset.sugestao));
    pintarSobra();
  });
  dist('linhas').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); dist('b-ok').click(); } });

  dist('b-ok').addEventListener('click', async () => {
    const linhas = lerLinhas();
    const total = linhas.reduce((t, x) => t + x.valor, 0);
    const app = await estado.calcular();
    const inteiro = dist('campo-inteiro').hidden ? null : dist('inteiro').value || null;
    const antes = envelopesAtivos(app).find((v) => (v.inteiros ?? []).includes(lugarId))?.id ?? null;
    if (total > semDono) { recado(dist('recado'), `Há ${formatar(semDono)} sem dono aqui: não dá para aportar ${formatar(total)}.`); return; }
    if (!linhas.length && inteiro === antes) { distJ.close(); return; }
    const data = dist('data').value || hoje();
    for (const x of linhas) {
      await estado.aplicarEvento('envelope.alocado', { id: novoId('alo'), lugarId, de: null, para: x.envelopeId, valor: x.valor, data });
    }
    if (inteiro !== antes) {
      if (antes) await estado.aplicarEvento('envelope.alterado', { id: antes, inteiros: app.envelopes[antes].inteiros.filter((l) => l !== lugarId) });
      if (inteiro) {
        // Inteiro dele: o que ainda está sem dono ali passa a ser dele também.
        const resto = semDono - total;
        if (resto > 0) await estado.aplicarEvento('envelope.alocado', { id: novoId('alo'), lugarId, de: null, para: inteiro, valor: resto, data });
        await estado.aplicarEvento('envelope.alterado', { id: inteiro, inteiros: [...(app.envelopes[inteiro].inteiros ?? []), lugarId] });
      }
    }
    distJ.close();
    await depois();
  });

  // ── tirar do envelope: devolver ao sem dono ou passar a outro ────────────

  let tirandoDe = null;

  async function abrirTirar(envelopeId) {
    const app = await estado.calcular();
    tirandoDe = app.envelopes?.[envelopeId];
    if (!tirandoDe) return;
    const r = donosNoDia(app).porEnvelope.get(envelopeId);
    document.getElementById('titulo-mover-envelope').textContent = `Tirar de ${tirandoDe.nome}`;
    const onde = [...(r?.porLugar ?? new Map()).entries()].filter(([, v]) => v > 0);
    mov('lugar').innerHTML = onde.map(([id, v]) => `<option value="${esc(id)}">${esc(nomeDoLugar(app, id))} · ${formatar(v)}</option>`).join('');
    mov('para').innerHTML = `<option value="">sem dono</option>${envelopesAtivos(app).filter((v) => v.id !== envelopeId)
      .map((v) => `<option value="${esc(v.id)}">${esc(v.nome)}</option>`).join('')}`;
    mov('valor').value = '';
    mov('data').value = hoje();
    recado(mov('recado'), onde.length ? '' : 'Este envelope não tem dinheiro em lugar nenhum.');
    movJ.showModal();
    mov('valor').focus();
  }

  mov('b-ok').addEventListener('click', async () => {
    const app = await estado.calcular();
    const lugar = mov('lugar').value;
    const valor = Math.abs(deTexto(mov('valor').value));
    if (!lugar || !valor) { mov('valor').focus(); return; }
    const tem = donosNoDia(app).porEnvelope.get(tirandoDe.id)?.porLugar.get(lugar) ?? 0;
    if (valor > tem) { recado(mov('recado'), `${tirandoDe.nome} tem ${formatar(tem)} em ${nomeDoLugar(app, lugar)}.`); return; }
    await estado.aplicarEvento('envelope.alocado', {
      id: novoId('alo'), lugarId: lugar, de: tirandoDe.id, para: mov('para').value || null, valor, data: mov('data').value || hoje(),
    });
    movJ.close();
    await depois();
  });
  mov('valor').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); mov('b-ok').click(); } });

  janelas = { abrirFicha, abrirDistribuir, abrirTirar };
  return janelas;
}

/**
 * O bloco "de quem é o dinheiro que sai" (design/11 §4): aparece só quando há
 * dinheiro de envelope no lugar de onde o movimento sai. Vazio = sai do sem
 * dono. Devolve { pintar(app, lugarId, donos, dia), ler(), conferir(valor) }.
 */
export function ligarDonos(raiz) {
  let lugarId = null;
  let disponiveis = [];
  let semDono = 0;

  /**
   * `doMovimento`: os donos que o movimento sendo corrigido já levou (voltam
   * a estar disponíveis). `valores`: o que está digitado, para não perder ao
   * repintar.
   */
  function pintar(app, idDoLugar, { doMovimento = [], valores = null, dia = hoje() } = {}) {
    const donos = doMovimento;
    const digitados = valores ?? doMovimento;
    lugarId = idDoLugar;
    const r = lugarId ? envelopesNoLugar(app, lugarId, dia) : { envelopes: [], semDono: 0 };
    // Na correção, o próprio movimento já tirou o dinheiro dali: o que ele
    // levou volta a estar disponível.
    disponiveis = r.envelopes.map((x) => ({ ...x, valor: x.valor + (donos.find((d) => d.envelopeId === x.envelope.id)?.valor ?? 0) }));
    for (const d of donos) {
      if (!disponiveis.some((x) => x.envelope.id === d.envelopeId) && app.envelopes?.[d.envelopeId]) {
        disponiveis.push({ envelope: app.envelopes[d.envelopeId], valor: d.valor });
      }
    }
    semDono = Math.max(0, r.semDono);
    raiz.hidden = !disponiveis.length;
    if (!disponiveis.length) { raiz.innerHTML = ''; return; }
    raiz.innerHTML = `<p class="miudo titulo-linhas">de quem é o dinheiro que sai · ${esc(nomeDoLugar(app, lugarId))}</p>
      <ol class="linhas-distribuir">${disponiveis.map((x) => `<li class="linha-distribuir">
        <span class="nome-dist">${esc(x.envelope.nome)}<span class="fino">tem ${formatar(x.valor)} aqui</span></span>
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" data-dono="${esc(x.envelope.id)}"
          value="${campoReais(digitados.find((d) => d.envelopeId === x.envelope.id)?.valor)}" aria-label="Quanto sai de ${esc(x.envelope.nome)}">
      </li>`).join('')}</ol>
      <p class="nota">Vazio sai do sem dono (${formatar(semDono)} aqui). O que sai de um envelope continua dele no lugar de destino.</p>`;
  }

  function ler() {
    return [...raiz.querySelectorAll('[data-dono]')]
      .map((i) => ({ envelopeId: i.dataset.dono, valor: Math.abs(deTexto(i.value)) }))
      .filter((x) => x.valor > 0);
  }

  /** Recusa o que não fecha; devolve a frase, ou ''. */
  function conferir(valor) {
    const donos = ler();
    for (const d of donos) {
      const x = disponiveis.find((y) => y.envelope.id === d.envelopeId);
      if (x && d.valor > x.valor) return `${x.envelope.nome} tem ${formatar(x.valor)} aqui.`;
    }
    const total = donos.reduce((t, d) => t + d.valor, 0);
    if (total > valor) return `Os envelopes somam ${formatar(total)}, mais que os ${formatar(valor)} que saem.`;
    return '';
  }

  return { pintar, ler, conferir, lugar: () => lugarId };
}

