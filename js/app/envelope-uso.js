// Usar um envelope (design/11 §8): pagar com ele e encerrar.
//
// "Pagar com o envelope" é a porta do caso comum: se o dinheiro dele não está
// na conta que paga, resgata a diferença de onde ele tem — com o dono — e grava
// a despesa marcada com o envelope, tudo de uma vez (D18). Encerrar resolve o
// que sobrou e, num projeto, já abre o do ano seguinte.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { hoje } from '../core/datas.js';
import { contaDoDinheiro } from '../core/investimentos.js';
import { categoriaNaArea } from './areas.js';
import {
  envelopesAtivos, ehProjeto, donosNoDia, nomeDoLugar, proximoDoProjeto,
} from '../core/envelopes.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mesAno = (dia) => `${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

const MARCACAO = `
<dialog id="dialogo-pagar-envelope" class="dialogo-captura dialogo-envelope" data-area="envelopes" aria-labelledby="titulo-pagar-envelope">
  <div class="cabecalho-dialogo">
    <strong id="titulo-pagar-envelope">Pagar com o envelope</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples">
    <p class="nota" data-pag="cabeca"></p>
    <div class="linha-operacao">
      <label class="campo-simples"><span class="miudo">valor</span>
        <input type="text" inputmode="decimal" data-pag="valor" autocomplete="off" placeholder="0,00"></label>
      <label class="campo-simples"><span class="miudo">data</span>
        <input type="date" data-pag="data"></label>
      <label class="campo-simples"><span class="miudo">paga com</span>
        <select data-pag="conta"></select></label>
      <label class="campo-simples"><span class="miudo">categoria</span>
        <select data-pag="categoria"></select></label>
    </div>
    <label class="campo-simples"><span class="miudo">descrição · opcional</span>
      <input type="text" data-pag="descricao" autocomplete="off" placeholder="Detran, loja de material…"></label>
    <div data-pag="parte-resgate" hidden>
      <label class="campo-simples"><span class="miudo" data-pag="rotulo-resgate">resgatar a diferença de</span>
        <select data-pag="origem"></select></label>
    </div>
    <p class="nota" data-pag="pista"></p>
    <p class="recado" data-pag="recado" hidden></p>
    <div class="acoes"><button type="button" class="principal" data-pag="b-ok">Pagar</button></div>
  </div>
</dialog>

<dialog id="dialogo-encerrar-envelope" class="dialogo-captura dialogo-envelope" data-area="envelopes" aria-labelledby="titulo-encerrar-envelope">
  <div class="cabecalho-dialogo">
    <strong id="titulo-encerrar-envelope">Encerrar</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples">
    <p class="nota" data-enc="cabeca"></p>
    <label class="campo-simples" data-enc="campo-destino"><span class="miudo">o que sobrou vai para</span>
      <select data-enc="destino"></select></label>
    <label class="linha-check" data-enc="campo-proximo"><input type="checkbox" data-enc="proximo" checked> <span data-enc="texto-proximo"></span></label>
    <label class="campo-simples campo-data-dist"><span class="miudo">encerrado em</span>
      <input type="date" data-enc="data"></label>
    <p class="nota">Encerrado não some: fica no fim do Geral com o fechamento do projeto, e pode ser reaberto.</p>
    <div class="acoes"><button type="button" class="principal" data-enc="b-ok">Encerrar</button></div>
  </div>
</dialog>`;

let janelas = null;
const repintar = new Set();

export function criarJanelasDeUso({ aoSalvar } = {}) {
  if (aoSalvar) repintar.add(aoSalvar);
  if (janelas) return janelas;
  document.body.insertAdjacentHTML('beforeend', MARCACAO);
  const pagJ = document.getElementById('dialogo-pagar-envelope');
  const encJ = document.getElementById('dialogo-encerrar-envelope');
  for (const j of [pagJ, encJ]) j.querySelector('[data-fechar]').addEventListener('click', () => j.close());
  const pag = (p) => pagJ.querySelector(`[data-pag="${p}"]`);
  const enc = (p) => encJ.querySelector(`[data-enc="${p}"]`);
  const recado = (el, t) => { el.textContent = t; el.hidden = !t; };
  const depois = async () => { for (const fn of repintar) await fn(); };

  // ── pagar com o envelope ────────────────────────────────────────────────

  let app = null;
  let envelope = null;
  let doEnvelope = null; // porEnvelope do donosNoDia
  // A origem que a pessoa escolheu; sem escolha, a primeira que serve.
  let origemEscolhida = null;

  /**
   * De onde dá para resgatar para a conta que paga: um lugar onde o envelope
   * tem dinheiro e cujo dinheiro volta para ESSA conta. Ação por cotas não
   * entra: vender pede quantidade e preço, e isso é na janela do ativo.
   */
  function origens(contaId) {
    const lista = [];
    for (const [lugarId, valor] of doEnvelope?.porLugar ?? []) {
      if (valor <= 0 || lugarId === contaId) continue;
      const ativo = app.ativos?.[lugarId];
      if (ativo) {
        const volta = contaDoDinheiro(app.contas[ativo.contaId]);
        lista.push({ lugarId, valor, nome: ativo.nome, serve: volta === contaId && ativo.unidade !== 'cotas',
          porque: ativo.unidade === 'cotas' ? 'é por cotas: venda na janela do ativo' : `o resgate volta para ${app.contas[volta]?.nome ?? 'outra conta'}` });
      } else {
        lista.push({ lugarId, valor, nome: nomeDoLugar(app, lugarId), serve: true });
      }
    }
    return lista.sort((a, b) => Number(b.serve) - Number(a.serve) || b.valor - a.valor);
  }

  function pintarPagar() {
    const contaId = pag('conta').value;
    const valor = Math.abs(deTexto(pag('valor').value));
    const tem = doEnvelope?.porLugar.get(contaId) ?? 0;
    const falta = Math.max(0, valor - tem);
    pag('parte-resgate').hidden = !falta;
    const lista = origens(contaId);
    pag('origem').innerHTML = lista.map((o) => `<option value="${esc(o.lugarId)}"${o.serve ? '' : ' disabled'}>${esc(o.nome)} · ${formatar(o.valor)}${o.serve ? '' : ` — ${esc(o.porque)}`}</option>`).join('')
      + '<option value="">não resgatar — o que faltar sai do caixa comum</option>';
    const valida = (v) => [...pag('origem').options].some((o) => o.value === v && !o.disabled);
    pag('origem').value = origemEscolhida !== null && valida(origemEscolhida) ? origemEscolhida : lista.find((o) => o.serve)?.lugarId ?? '';
    pag('rotulo-resgate').textContent = `resgatar ${formatar(falta)} de`;
    const nomeConta = app.contas[contaId]?.nome ?? 'a conta';
    pag('pista').textContent = !valor
      ? `${envelope.nome} tem ${formatar(tem)} em ${nomeConta}.`
      : !falta
        ? `Sai dos ${formatar(tem)} que ${envelope.nome} tem em ${nomeConta}.`
        : !pag('origem').value
          ? `${formatar(falta)} sairão do caixa comum: é o estouro do envelope.`
          : falta > (doEnvelope.porLugar.get(pag('origem').value) ?? 0)
            ? `${envelope.nome} tem só ${formatar(doEnvelope.porLugar.get(pag('origem').value) ?? 0)} em ${nomeDoLugar(app, pag('origem').value)}: escolha outro lugar, ou pague menos.`
            : `${tem ? `${formatar(tem)} já estão em ${nomeConta}; ` : ''}o resgate traz ${formatar(falta)} de ${nomeDoLugar(app, pag('origem').value)} — ainda do envelope — e o pagamento sai em seguida.`;
  }

  async function abrirPagar(envelopeId) {
    app = await estado.calcular();
    envelope = app.envelopes?.[envelopeId];
    if (!envelope) return;
    doEnvelope = donosNoDia(app).porEnvelope.get(envelopeId);
    document.getElementById('titulo-pagar-envelope').textContent = `Pagar com ${envelope.nome}`;
    pag('cabeca').textContent = `${envelope.nome} tem ${formatar(doEnvelope?.total ?? 0)}. O gasto entra na categoria como qualquer outro, marcado como do envelope.`;
    // A conta que paga: corrente ou espécie, começando pela que já tem
    // dinheiro do envelope.
    const contas = Object.values(app.contas).filter((c) => !c.arquivada && (c.tipo === 'corrente' || c.tipo === 'especie'))
      .sort((a, b) => (doEnvelope?.porLugar.get(b.id) ?? 0) - (doEnvelope?.porLugar.get(a.id) ?? 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
    pag('conta').innerHTML = contas.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
    pintarCategorias();
    pag('valor').value = '';
    pag('descricao').value = '';
    pag('data').value = hoje();
    pag('origem').innerHTML = '';
    origemEscolhida = null;
    recado(pag('recado'), '');
    pintarPagar();
    pagJ.showModal();
    pag('valor').focus();
  }

  function pintarCategorias() {
    const conta = app.contas[pag('conta').value];
    const antes = pag('categoria').value;
    const cats = Object.values(app.categorias)
      .filter((c) => !c.arquivada && c.natureza === 'despesa' && categoriaNaArea(c, conta))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    pag('categoria').innerHTML = '<option value="">escolha</option>' + cats.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
    if (antes) pag('categoria').value = antes;
  }

  pag('valor').addEventListener('input', pintarPagar);
  pag('origem').addEventListener('change', () => { origemEscolhida = pag('origem').value; pintarPagar(); });
  pag('conta').addEventListener('change', () => { pintarCategorias(); pintarPagar(); });

  pag('b-ok').addEventListener('click', async () => {
    const valor = Math.abs(deTexto(pag('valor').value));
    const contaId = pag('conta').value;
    const categoriaId = pag('categoria').value || null;
    const data = pag('data').value || hoje();
    if (!valor) { pag('valor').focus(); return; }
    if (!contaId) { recado(pag('recado'), 'Falta a conta que paga.'); return; }
    if (!categoriaId) { recado(pag('recado'), 'Falta a categoria: o gasto entra nela como qualquer outro.'); return; }
    const tem = doEnvelope?.porLugar.get(contaId) ?? 0;
    const falta = Math.max(0, valor - tem);
    const origem = falta ? pag('origem').value : '';
    const daOrigem = origem ? doEnvelope.porLugar.get(origem) ?? 0 : 0;
    if (origem && falta > daOrigem) {
      recado(pag('recado'), `${envelope.nome} tem ${formatar(daOrigem)} em ${nomeDoLugar(app, origem)}: não dá para resgatar ${formatar(falta)} dali.`);
      return;
    }
    recado(pag('recado'), '');
    const ap = await log.aparelho();
    const comum = { dataCompetencia: data, dataCaixa: data, confirmado: data <= hoje(), lancadoPor: ap?.id ?? null };
    // Primeiro o resgate (ainda do envelope), depois o pagamento: no mesmo
    // dia vale a ordem do registro (design/11 §4).
    if (origem) {
      const donos = [{ envelopeId: envelope.id, valor: falta }];
      if (app.ativos?.[origem]) {
        await estado.aplicarEvento('lancamento.registrado', {
          id: novoId('lan'), tipo: 'resgate', valor: falta, contaId, ativoId: origem, categoriaId: null, donos, ...comum,
        });
      } else {
        await estado.aplicarEvento('lancamento.registrado', {
          id: novoId('lan'), tipo: 'transferencia', valor: falta, contaId: origem, contaDestinoId: contaId, categoriaId: null, donos, ...comum,
        });
      }
    }
    // A descrição é a lista de descrições do app: acha a que já existe, ou cria.
    let detalheId = null;
    const texto = pag('descricao').value.trim();
    if (texto) {
      const igual = Object.values(app.detalhes ?? {}).find((x) => x.nome.toLocaleLowerCase('pt-BR') === texto.toLocaleLowerCase('pt-BR'));
      detalheId = igual?.id ?? novoId('det');
      if (!igual) await estado.aplicarEvento('detalhe.criado', { id: detalheId, nome: texto });
    }
    await estado.aplicarEvento('lancamento.registrado', {
      id: novoId('lan'), tipo: 'despesa', valor, contaId, categoriaId, detalheId, custeadoPor: envelope.id, ...comum,
    });
    pagJ.close();
    await depois();
  });
  pag('valor').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pag('b-ok').click(); } });

  // ── encerrar ────────────────────────────────────────────────────────────

  let encerrando = null;
  let sobra = [];

  async function abrirEncerrar(envelopeId) {
    app = await estado.calcular();
    encerrando = app.envelopes?.[envelopeId];
    if (!encerrando) return;
    const r = donosNoDia(app).porEnvelope.get(envelopeId);
    sobra = [...(r?.porLugar ?? new Map()).entries()].filter(([, v]) => v > 0);
    const total = sobra.reduce((t, [, v]) => t + v, 0);
    document.getElementById('titulo-encerrar-envelope').textContent = `Encerrar ${encerrando.nome}`;
    enc('cabeca').textContent = total
      ? `Sobrou ${formatar(total)} (${sobra.map(([id, v]) => `${nomeDoLugar(app, id)} ${formatar(v)}`).join(' · ')}). Você decide para onde vai — nada sai do lugar.`
      : 'Não sobrou nada no envelope.';
    const proximo = ehProjeto(encerrando) ? proximoDoProjeto(encerrando) : null;
    enc('campo-proximo').hidden = !proximo;
    enc('proximo').checked = Boolean(proximo);
    if (proximo) {
      enc('texto-proximo').textContent = `abrir ${proximo.nome}${proximo.alvoValor ? ` · ${formatar(proximo.alvoValor)}` : ''}${proximo.alvoData ? ` até ${mesAno(proximo.alvoData)}` : ''}`;
    }
    enc('campo-destino').hidden = !total;
    pintarDestinos(proximo);
    enc('data').value = hoje();
    encJ.showModal();
  }

  function pintarDestinos(proximo = ehProjeto(encerrando) ? proximoDoProjeto(encerrando) : null) {
    const novo = proximo && enc('proximo').checked ? `<option value="__novo" selected>${esc(proximo.nome)} (o novo)</option>` : '';
    enc('destino').innerHTML = `${novo}<option value="">sem dono</option>${envelopesAtivos(app)
      .filter((v) => v.id !== encerrando.id).map((v) => `<option value="${esc(v.id)}">${esc(v.nome)}</option>`).join('')}`;
  }

  enc('proximo').addEventListener('change', () => pintarDestinos());

  enc('b-ok').addEventListener('click', async () => {
    const data = enc('data').value || hoje();
    let destino = enc('destino').value || null;
    if (enc('proximo').checked && ehProjeto(encerrando)) {
      const id = novoId('env');
      await estado.aplicarEvento('envelope.criado', { id, ...proximoDoProjeto(encerrando) });
      if (destino === '__novo') destino = id;
    }
    if (destino === '__novo') destino = null;
    for (const [lugarId, valor] of sobra) {
      // +1 centavo: leva até a última fração, sem deixar pó de arredondamento.
      await estado.aplicarEvento('envelope.alocado', {
        id: novoId('alo'), lugarId, de: encerrando.id, para: destino, valor: valor + 1, data,
      });
    }
    await estado.aplicarEvento('envelope.encerrado', { id: encerrando.id, data });
    encJ.close();
    await depois();
  });

  janelas = { abrirPagar, abrirEncerrar };
  return janelas;
}

