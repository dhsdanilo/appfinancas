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
    <!-- O disponível fica parado: é a referência de quanto dá para pôr
         (pedido dele, 05/10/2026). A barra enche com cada envelope. -->
    <div class="disponivel-dist">
      <span class="miudo" data-dist="rotulo-disp">disponível neste lugar</span>
      <strong data-dist="disponivel"></strong>
      <div class="barra-dist" data-dist="barra" aria-hidden="true"></div>
      <p class="fica-sem-dono" data-dist="sobra"></p>
    </div>
    <ol class="linhas-distribuir" data-dist="linhas"></ol>
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
    <label class="linha-check" data-mov="campo-repor" hidden><input type="checkbox" data-mov="repor" checked>
      <span>Repor este dinheiro: volta a ser cobrado pelo compromisso da Energia (desmarque se foi para o sistema elétrico)</span></label>
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
        || (editando.inteiros ?? []).length > 0
        || Object.values(app.lancamentos ?? {}).some((l) => !l.removido && l.custeadoPor === editando.id);
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
  // Ajustar: o que cada envelope tem NESTE lugar vira o ponto de partida, e o
  // total a repartir é o do lugar (menos o que é de envelope fora da lista).
  let modoAjuste = false;

  function lerLinhas() {
    return [...dist('linhas').querySelectorAll('[data-dist-env]')]
      .map((i) => ({ envelopeId: i.dataset.distEnv, valor: Math.abs(deTexto(i.value)) }))
      .filter((x) => x.valor > 0);
  }

  const campoDe = (id) => dist('linhas').querySelector(`[data-dist-env="${CSS.escape(id)}"]`);
  const faixaDe = (id) => dist('linhas').querySelector(`[data-dist-faixa="${CSS.escape(id)}"]`);

  /** O que ainda está livre para um envelope: o disponível menos o que os outros já pegaram. */
  function livrePara(id) {
    return semDono - lerLinhas().filter((x) => x.envelopeId !== id).reduce((t, x) => t + x.valor, 0);
  }

  /** Põe um valor num envelope — nunca além do que está livre — e acerta campo e barra. */
  function definir(id, valor) {
    const v = Math.max(0, Math.min(Math.round(valor), livrePara(id)));
    campoDe(id).value = campoReais(v);
    faixaDe(id).value = String(v);
    pintarSobra();
  }

  function pintarSobra() {
    const linhas = lerLinhas();
    const total = linhas.reduce((t, x) => t + x.valor, 0);
    const fica = semDono - total;
    dist('sobra').textContent = `distribuído ${formatar(total)} · fica sem dono ${fica < 0 ? '−' : ''}${formatar(Math.abs(fica))}`;
    dist('sobra').classList.toggle('negativo', fica < 0);
    dist('barra').innerHTML = semDono > 0
      ? linhas.map((x) => `<i style="width:${Math.min(100, (x.valor / semDono) * 100)}%;background:${faixaDe(x.envelopeId)?.style.getPropertyValue('--cor') || 'var(--area)'}"></i>`).join('')
      : '';
  }

  async function abrirDistribuir(idDoLugar, { envelopeId = null } = {}) {
    const app = await estado.calcular();
    lugarId = idDoLugar;
    modoAjuste = false;
    dist('rotulo-disp').textContent = 'disponível neste lugar';
    dist('b-ok').textContent = 'Distribuir';
    const r = donosNoDia(app).porLugar.get(lugarId);
    semDono = Math.max(0, r?.semDono ?? 0);
    const ativo = app.ativos?.[lugarId];
    document.getElementById('titulo-distribuir').textContent = `Distribuir · ${nomeDoLugar(app, lugarId)}`;
    dist('cabeca').textContent = `${ativo ? `${app.contas[ativo.contaId]?.nome ?? ''} · ` : ''}${envelopeId ? 'Arraste ou digite quanto vai para o envelope.' : 'Arraste ou digite quanto vai para cada envelope.'} Cada linha vira um aporte; nada sai do lugar.`;
    dist('disponivel').textContent = formatar(semDono);
    // O passo da barra: de real em real até R$ 1.000; acima, de 10 em 10.
    const passo = semDono > 100000 ? 1000 : 100;

    // "Inteiro" só onde rende: a previdência que é toda da aposentadoria.
    // Vindo da ficha de um envelope, só ele aparece: não há o que escolher.
    const rende = r?.lugar.tipo === 'fracao' && !envelopeId;
    dist('campo-inteiro').hidden = !rende;
    const todos = envelopesAtivos(app);
    const lista = envelopeId ? todos.filter((v) => v.id === envelopeId) : todos;
    if (envelopeId && lista[0]) document.getElementById('titulo-distribuir').textContent = `Aportar em ${lista[0].nome} · ${nomeDoLugar(app, lugarId)}`;
    const dono = todos.find((v) => (v.inteiros ?? []).includes(lugarId));
    dist('inteiro').innerHTML = `<option value="">— cada aporte decide</option>${todos.map((v) => `<option value="${esc(v.id)}"${v === dono ? ' selected' : ''}>${esc(v.nome)}</option>`).join('')}`;

    const totais = donosNoDia(app).porEnvelope;
    dist('linhas').innerHTML = lista.map((v, i) => {
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
      const atalhos = [
        sugestao > 0 ? `<button type="button" class="elo" data-por="${esc(v.id)}" data-quanto="${sugestao}">o ritmo · ${formatar(sugestao)}</button>` : '',
        n.falta ? `<button type="button" class="elo" data-por="${esc(v.id)}" data-quanto="${n.falta}">o que falta</button>` : '',
        `<button type="button" class="elo" data-por="${esc(v.id)}" data-quanto="tudo">tudo que sobra</button>`,
      ].filter(Boolean).join('');
      return `<li class="linha-distribuir com-barra">
        <span class="nome-dist">${esc(v.nome)}<span class="fino">${esc(dica)}</span></span>
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" data-dist-env="${esc(v.id)}" aria-label="Aportar em ${esc(v.nome)}">
        <input type="range" class="faixa-dist" min="0" max="${semDono}" step="${passo}" value="0" data-dist-faixa="${esc(v.id)}"
          style="--cor:var(--serie-${(i % 8) + 1})" aria-label="Arrastar quanto vai para ${esc(v.nome)}"${semDono ? '' : ' disabled'}>
        <span class="atalhos-dist">${atalhos}</span>
      </li>`;
    }).join('') || '<li class="vazio">Nenhum envelope ainda.</li>';
    dist('data').value = hoje();
    recado(dist('recado'), '');
    pintarSobra();
    distJ.showModal();
    const alvo = envelopeId ? dist('linhas').querySelector(`[data-dist-env="${CSS.escape(envelopeId)}"]`) : dist('linhas').querySelector('input');
    alvo?.focus();
  }

  /**
   * Ajustar o que já foi distribuído de um lugar: cada envelope com o quanto tem
   * aqui, e o sem dono fecha a conta. Salvar grava só as diferenças — aporte do
   * sem dono, resgate para ele, ou remanejamento direto entre dois envelopes.
   */
  async function abrirAjustar(idDoLugar) {
    const app = await estado.calcular();
    lugarId = idDoLugar;
    modoAjuste = true;
    const r = donosNoDia(app).porLugar.get(lugarId);
    const todos = envelopesAtivos(app);
    const aqui = (v) => Math.round(r?.donos.get(v.id) ?? 0);
    const dosListados = todos.reduce((t, v) => t + aqui(v), 0);
    const doRestoDosDonos = [...(r?.donos.values() ?? [])].reduce((t, v) => t + Math.round(v), 0) - dosListados;
    semDono = Math.max(0, Math.round(r?.valor ?? 0) - doRestoDosDonos);
    document.getElementById('titulo-distribuir').textContent = `Ajustar · ${nomeDoLugar(app, lugarId)}`;
    dist('cabeca').textContent = 'Arraste ou digite quanto de cada envelope está aqui. O que não for de nenhum fica sem dono. Cada diferença vira um aporte ou um resgate.';
    dist('rotulo-disp').textContent = 'total para repartir';
    dist('b-ok').textContent = 'Ajustar';
    dist('disponivel').textContent = formatar(semDono);
    dist('campo-inteiro').hidden = true;
    const passo = semDono > 100000 ? 1000 : 100;
    const totais = donosNoDia(app).porEnvelope;
    const linhas = todos.map((v, i) => {
      const ali = aqui(v);
      const tem = totais.get(v.id)?.total ?? 0;
      return `<li class="linha-distribuir com-barra"${ali > 0 ? '' : ' data-fora style="display:none"'}>
        <span class="nome-dist">${esc(v.nome)}<span class="fino">${esc(`tem ${formatar(tem)}${ali ? ` (${formatar(ali)} aqui)` : ''}`)}</span></span>
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" data-dist-env="${esc(v.id)}" value="${ali > 0 ? campoReais(ali) : ''}" aria-label="Quanto de ${esc(v.nome)} está aqui">
        <input type="range" class="faixa-dist" min="0" max="${semDono}" step="${passo}" value="${ali}" data-dist-faixa="${esc(v.id)}"
          style="--cor:var(--serie-${(i % 8) + 1})" aria-label="Arrastar quanto de ${esc(v.nome)} está aqui">
        <span class="atalhos-dist"><button type="button" class="elo" data-por="${esc(v.id)}" data-quanto="tudo">tudo que sobra</button></span>
      </li>`;
    });
    const escondidos = todos.filter((v) => aqui(v) <= 0).length;
    dist('linhas').innerHTML = (linhas.join('') + (escondidos ? '<li class="vazio"><button type="button" class="elo" data-mostrar-outros>+ outro envelope</button></li>' : ''))
      || '<li class="vazio">Nenhum envelope ainda.</li>';
    dist('data').value = hoje();
    recado(dist('recado'), '');
    pintarSobra();
    distJ.showModal();
  }

  // Arrastar acerta o campo; digitar acerta a barra. Nenhum dos dois passa do
  // que está livre — o disponível do alto continua sendo a referência.
  dist('linhas').addEventListener('input', (e) => {
    const faixa = e.target.closest('[data-dist-faixa]');
    if (faixa) { definir(faixa.dataset.distFaixa, Number(faixa.value)); return; }
    const campo = e.target.closest('[data-dist-env]');
    if (campo) {
      const id = campo.dataset.distEnv;
      // Não se digita além do que está livre: passou, o campo volta ao máximo.
      if (Math.abs(deTexto(campo.value)) > livrePara(id)) { definir(id, Infinity); return; }
      faixaDe(id).value = String(Math.abs(deTexto(campo.value)));
      pintarSobra();
    }
  });
  // Ao sair do campo, o que passou do livre volta ao livre.
  dist('linhas').addEventListener('change', (e) => {
    const campo = e.target.closest('[data-dist-env]');
    if (campo && Math.abs(deTexto(campo.value)) > livrePara(campo.dataset.distEnv)) definir(campo.dataset.distEnv, Infinity);
  });
  dist('linhas').addEventListener('click', (e) => {
    if (e.target.closest('[data-mostrar-outros]')) {
      for (const li of dist('linhas').querySelectorAll('[data-fora]')) li.style.display = '';
      e.target.closest('li').remove();
      return;
    }
    const b = e.target.closest('[data-por]');
    if (!b) return;
    definir(b.dataset.por, b.dataset.quanto === 'tudo' ? Infinity : Number(b.dataset.quanto));
  });
  dist('linhas').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); dist('b-ok').click(); } });

  dist('b-ok').addEventListener('click', async () => {
    if (modoAjuste) { await salvarAjuste(); return; }
    const linhas = lerLinhas();
    const total = linhas.reduce((t, x) => t + x.valor, 0);
    const app = await estado.calcular();
    const antes = envelopesAtivos(app).find((v) => (v.inteiros ?? []).includes(lugarId))?.id ?? null;
    // Campo escondido (lugar que não rende, ou aporte vindo da ficha): não mexe no "inteiro".
    const inteiro = dist('campo-inteiro').hidden ? antes : dist('inteiro').value || null;
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

  async function salvarAjuste() {
    const app = await estado.calcular();
    const r = donosNoDia(app).porLugar.get(lugarId);
    const novos = new Map(lerLinhas().map((x) => [x.envelopeId, x.valor]));
    const soma = [...novos.values()].reduce((t, v) => t + v, 0);
    if (soma > semDono) { recado(dist('recado'), `O total passa de ${formatar(semDono)}: não há tanto neste lugar.`); return; }
    const data = dist('data').value || hoje();
    const saem = [];
    const entram = [];
    for (const v of envelopesAtivos(app)) {
      const d = (novos.get(v.id) ?? 0) - Math.round(r?.donos.get(v.id) ?? 0);
      if (d < 0) saem.push({ id: v.id, valor: -d });
      else if (d > 0) entram.push({ id: v.id, valor: d });
    }
    const gravar = (de, para, valor) => estado.aplicarEvento('envelope.alocado', { id: novoId('alo'), lugarId, de, para, valor, data });
    // Quem perde e quem ganha se acertam direto (remanejar); o resto vai e volta do sem dono.
    for (const s of saem) {
      for (const e of entram) {
        const q = Math.min(s.valor, e.valor);
        if (q <= 0) continue;
        await gravar(s.id, e.id, q);
        s.valor -= q;
        e.valor -= q;
      }
    }
    for (const s of saem) if (s.valor > 0) await gravar(s.id, null, s.valor);
    for (const e of entram) if (e.valor > 0) await gravar(null, e.id, e.valor);
    distJ.close();
    await depois();
  }

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
    // Só no envelope ligado à Energia: perguntar se o dinheiro volta a ser cobrado.
    mov('campo-repor').hidden = app.energiaConfig?.envelopeId !== envelopeId;
    mov('repor').checked = true;
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
      repor: mov('campo-repor').hidden ? null : mov('repor').checked,
    });
    movJ.close();
    await depois();
  });
  mov('valor').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); mov('b-ok').click(); } });

  janelas = { abrirFicha, abrirDistribuir, abrirAjustar, abrirTirar };
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

