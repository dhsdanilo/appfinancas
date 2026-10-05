// Transferência: de onde sai, pra onde vai e quanto. Nada mais.
// design/03-alimentacao.md §3.1
//
// Sem categoria, de propósito: o dinheiro não saiu da vida, só trocou de bolso.
// Tratar transferência como despesa é o erro número um dos apps desse gênero —
// dobra o gasto do mês e faz o relatório perder credibilidade na primeira
// semana.
//
// Transferir, sacar, depositar, aportar e resgatar são a MESMA operação, mudando
// só o nome que a tela usa. Por isso existe um formulário só.
//
// Ela vive no andar de cima, nunca no térreo: precisa de duas contas (mais
// toques do que a tela de 3 toques tolera) e não é perecível — o valor de um
// saque se registra em casa sem perder nada (§3).

import { valorLancavel, formatar } from '../core/dinheiro.js';
import { novoId } from '../core/id.js';
import * as log from '../core/log.js';
import * as estado from '../core/estado.js';
import { hoje, nasceConfirmado, correcao, tipoDaTransferencia } from '../core/lancamentos.js';
import { somarDias } from '../core/datas.js';
import { MARCACAO_CAMPO_VALOR, ligarCampoValor } from './campo-valor.js';
import { ligarZonaDePerigo } from './zona-perigo.js';
import { areaDaConta, opcoesDeConta } from './areas.js';
import { pularParcela, corrigirParcela, voltarAoContrato } from './contrato.js';
import { lugarDaConta } from '../core/envelopes.js';
import { ligarDonos } from './envelope.js';

// Todas as contas que não estão arquivadas. Cartão, dívida e folha entram
// porque o dinheiro passa por elas de verdade: pagar a fatura é corrente →
// cartão, e o líquido do holerite é folha → corrente.
//
// Pagar a fatura é ESTA operação com destino num cartão, e o tipo
// `pagamento_fatura` sai do destino sozinho — não existe como errar
// (03-alimentacao §6.2). O holerite (D25) ainda não tem tipo próprio.

// O mesmo desenho do "Novo lançamento" (pedido dele, 05/10/2026): a data em
// cima com − hoje +, as contas, o valor, o "mais" com o que é exceção, e os
// dois botões.
const MARCACAO = `
  <div class="contexto contexto-transferencia">
    <span class="tipo-transf" aria-hidden="true">→ transferência</span>
    <div class="quando">
      <button type="button" class="passo" data-papel="dia-menos" aria-label="Um dia antes">−</button>
      <button type="button" class="elo" data-papel="rotulo-data" aria-label="Escolher a data no calendário">hoje</button>
      <button type="button" class="passo" data-papel="dia-mais" aria-label="Um dia depois">+</button>
      <input type="date" class="data-exata" data-papel="data" aria-label="Data da transferência" tabindex="-1">
    </div>
  </div>

  <div class="rota">
    <label class="perna">
      <span class="rotulo-campo">de onde sai</span>
      <select data-papel="origem" aria-label="Conta de origem"></select>
    </label>
    <span class="seta" aria-hidden="true">→</span>
    <label class="perna">
      <span class="rotulo-campo">para onde vai</span>
      <select data-papel="destino" aria-label="Conta de destino"></select>
    </label>
  </div>

  <p class="rotulo-campo">valor</p>
  ${MARCACAO_CAMPO_VALOR}

  <!-- O que é exceção fica no "mais", como no lançamento: repetir todo mês
       (design/03 §3.2) e o débito automático (13 §1). -->
  <div class="linha-mais-transf" data-papel="linha-mais">
    <button type="button" class="elo" data-papel="b-mais" aria-expanded="false">mais ▾</button>
  </div>
  <div class="repete-transf" data-papel="linha-repete" hidden>
    <label><input type="checkbox" data-papel="repete"> repete todo mês</label>
    <label data-papel="linha-cai" hidden><input type="checkbox" data-papel="cai-sozinha"> cai sozinha no dia</label>
    <span class="fino" data-papel="pista-repete"></span>
  </div>

  <!-- De quem é o dinheiro que sai, quando há envelope na origem (design/11 §4). -->
  <div class="donos-saida" data-papel="donos" hidden></div>

  <p class="recado" data-papel="recado" hidden></p>

  <!-- A parcela de uma dívida cai sozinha; aqui só se corrige a exceção
       (design/10 §4.4). -->
  <p class="recado recado-parcela" data-papel="recado-parcela" hidden>
    <span data-papel="texto-parcela"></span>
    <button type="button" class="elo" data-papel="b-pular">não foi debitada</button>
    <button type="button" class="elo" data-papel="b-voltar-contrato" hidden>voltar ao contrato</button>
  </p>

  <div class="acoes">
    <button type="button" class="principal" data-papel="b-salvar-nova" disabled>Transferir e nova</button>
    <button type="button" data-papel="b-salvar" disabled>Transferir e fechar</button>
  </div>

  <p class="zona-perigo" data-papel="perigo" hidden></p>
`;

/**
 * @param {object} opcoes
 * @param {HTMLElement} opcoes.raiz
 * @param {Function} [opcoes.aoSalvar]
 * @param {Function} [opcoes.aoFechar]
 */
export async function criarTransferencia({ raiz, aoSalvar, aoFechar, aoMudarTitulo }) {
  raiz.innerHTML = MARCACAO;
  // O desenho do "Novo lançamento": os mesmos rótulos e espaçamentos.
  raiz.classList.add('formulario-app');
  // Transferência não é de área: leva a cor do próprio tipo, ela e a janela.
  raiz.dataset.area = 'transferencia';
  const janela = raiz.closest('dialog');
  if (janela) janela.dataset.area = 'transferencia';
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);

  let app = null;
  let data = hoje();
  let editando = null;
  // A série de que esta transferência é a ocorrência, quando veio de um previsto.
  let daSerie = null;
  // A parcela automática de uma dívida que esta transferência corrige.
  let daParcela = null;

  const valor = ligarCampoValor(raiz, {
    aoMudar: () => pintarAcao(),
    aoConfirmar: async () => {
      const salvou = await salvar();
      if (salvou && aoFechar) aoFechar();
    },
  });

  const donos = ligarDonos(el('donos'));
  // Só repinta os donos quando muda a origem: a conta de quem é dono de quê
  // não acompanha cada tecla do valor.
  let donosDe = undefined;
  function pintarDonos(forcar = false) {
    if (!app) return;
    const lugar = lugarDaConta(app, origem())?.id ?? null;
    if (!forcar && lugar === donosDe) return;
    donosDe = lugar;
    donos.pintar(app, lugar, { doMovimento: editando?.donos ?? [], dia: data });
  }

  const origem = () => el('origem').value || null;
  const destino = () => el('destino').value || null;

  const pronto = () =>
    valorLancavel(valor.centavos()) && origem() && destino() && origem() !== destino();

  const pagandoFatura = () => Boolean(app) && tipoDaTransferencia(app, destino()) === 'pagamento_fatura';

  /** Cada perna veste a cor da área da sua conta (09-identidade §3). */
  function pintarAreas() {
    if (!app) return;
    el('origem').closest('.perna').dataset.area = areaDaConta(app.contas[origem()]);
    el('destino').closest('.perna').dataset.area = areaDaConta(app.contas[destino()]);
  }

  function pintarAcao() {
    pintarAreas();
    pintarDonos();
    // Corrigir, a parcela e a fatura são uma coisa só: um botão. A transferência
    // nova tem os dois, como o lançamento.
    const unico = Boolean(editando || daParcela || pagandoFatura());
    el('b-salvar-nova').hidden = unico;
    el('b-salvar').classList.toggle('principal', unico);
    el('b-salvar').disabled = !pronto();
    el('b-salvar-nova').disabled = !pronto();
    el('b-salvar').textContent = editando || daParcela ? 'Salvar' : pagandoFatura() ? 'Pagar fatura' : 'Transferir e fechar';
    if (aoMudarTitulo) aoMudarTitulo(daParcela ? 'Corrigir parcela' : pagandoFatura() ? 'Pagar fatura' : 'Transferência');
    el('recado-parcela').hidden = !daParcela;
    pintarRepete();

    // A recusa diz o que resolve, nunca só que não dá.
    const mesma = origem() && origem() === destino();
    const recusa = mesma ? 'Escolha duas contas diferentes: transferência é dinheiro trocando de bolso.' : donos.conferir(valor.centavos());
    el('recado').textContent = recusa;
    el('recado').hidden = !recusa;
    if (recusa) { el('b-salvar').disabled = true; el('b-salvar-nova').disabled = true; }
  }

  /**
   * "Repete todo mês" só na transferência nova e avulsa: não na correção, não
   * na ocorrência de uma série que já existe, não na parcela de dívida, e não
   * no pagamento de fatura — o valor dela muda todo mês e ela já aparece
   * prevista sozinha.
   */
  let maisAberto = false;
  function pintarRepete() {
    const pode = !editando && !daSerie && !daParcela && !pagandoFatura();
    el('linha-mais').hidden = !pode;
    el('linha-repete').hidden = !pode || !maisAberto;
    el('b-mais').textContent = maisAberto ? 'menos ▴' : `mais ▾${el('repete').checked ? ' · repete todo mês' : ''}`;
    el('b-mais').setAttribute('aria-expanded', String(maisAberto));
    if (!pode) el('repete').checked = false;
    const repete = el('repete').checked;
    el('linha-cai').hidden = !repete;
    if (!repete) el('cai-sozinha').checked = false;
    el('pista-repete').textContent = repete && app && origem() && destino()
      ? `todo dia ${Number(data.slice(8, 10))}, ${valor.centavos() ? formatar(valor.centavos()) : 'o mesmo valor'} de ${app.contas[origem()]?.nome ?? '—'} para ${app.contas[destino()]?.nome ?? '—'}${el('cai-sozinha').checked ? ', lançada sozinha no dia' : ' — aparece prevista nos meses seguintes'}`
      : '';
  }

  function contasDisponiveis() {
    return Object.values(app.contas)
      .filter((c) => !c.arquivada)
      .sort((a, b) => (a.nome < b.nome ? -1 : 1));
  }

  function pintarContas() {
    const contas = contasDisponiveis();
    const opcoes = (escolhida) => opcoesDeConta(contas, escolhida, { vazia: true });

    const antesOrigem = editando ? editando.contaId : origem();
    const antesDestino = editando ? editando.contaDestinoId : destino();
    el('origem').innerHTML = opcoes(antesOrigem);
    el('destino').innerHTML = opcoes(antesDestino);
  }

  function pintarData() {
    el('data').value = data;
    el('rotulo-data').textContent = rotuloDoDia(data);
  }

  function rotuloDoDia(dia) {
    if (dia === hoje()) return 'hoje';
    if (dia === somarDias(hoje(), -1)) return 'ontem';
    if (dia === somarDias(hoje(), 1)) return 'amanhã';
    const [ano, mes, d] = dia.split('-');
    return ano === hoje().slice(0, 4) ? `${d}/${mes}` : `${d}/${mes}/${ano}`;
  }

  function irPara(dia) {
    data = dia;
    pintarData();
    pintarRepete();
  }

  // ── apagar ──────────────────────────────────────────────────────────────

  const perigo = ligarZonaDePerigo(el('perigo'), {
    rotulo: 'apagar transferência',
    descricao: () => {
      const de = app.contas[editando.contaId]?.nome ?? '—';
      const para = app.contas[editando.contaDestinoId]?.nome ?? '—';
      return `${formatar(editando.valor)} · ${de} → ${para}`;
    },
    apagar: async () => {
      await estado.aplicarEvento('lancamento.removido', { id: editando.id });
      if (aoSalvar) await aoSalvar();
      if (aoFechar) aoFechar();
    },
  });

  // ── salvar ──────────────────────────────────────────────────────────────

  async function salvar() {
    if (!pronto()) return false;
    if (daParcela) return salvarParcela();
    return editando ? salvarCorrecao() : registrar();
  }

  /**
   * A parcela automática corrigida continua automática: a correção fica na
   * dívida, e a parcela segue caindo no dia (design/10 §4.4).
   */
  async function salvarParcela() {
    const p = daParcela;
    const mudou = valor.centavos() !== p.valor || data !== p.data || origem() !== p.contaId;
    if (mudou) {
      await corrigirParcela(p.dividaId, p.k, { valor: valor.centavos(), data, contaId: origem() });
      if (aoSalvar) await aoSalvar();
    }
    daParcela = null;
    return true;
  }

  /** Marcado "repete", a série nasce desta transferência: mesmo valor, mesmo dia. */
  async function criarSerie() {
    if (!el('repete').checked || el('linha-mais').hidden) return null;
    const id = novoId('rec');
    const cai = el('cai-sozinha').checked;
    await estado.aplicarEvento('recorrencia.criada', {
      id,
      nome: `${app.contas[origem()]?.nome ?? '—'} → ${app.contas[destino()]?.nome ?? '—'}`,
      tipo: 'transferencia',
      contaId: origem(),
      contaDestinoId: destino(),
      tipoValor: 'fixa',
      valor: valor.centavos(),
      periodicidade: 'mensal',
      dia: Number(data.slice(8, 10)),
      inicio: data,
      caiSozinha: cai,
      caiSozinhaDesde: cai ? hoje() : null,
    });
    return id;
  }

  async function registrar() {
    const ap = await log.aparelho();
    const serie = await criarSerie();
    await estado.aplicarEvento('lancamento.registrado', {
      id: novoId('lan'),
      tipo: tipoDaTransferencia(app, destino()),
      valor: valor.centavos(),
      dataCompetencia: data,
      dataCaixa: data,
      contaId: origem(),
      contaDestinoId: destino(),
      // Sem categoria: não é gasto nem ganho (§3.1).
      categoriaId: null,
      confirmado: nasceConfirmado({ manual: true, dataCaixa: data }),
      recorrenciaId: daSerie ?? serie,
      donos: donos.ler(),
      lancadoPor: ap?.id ?? null,
    });
    daSerie = null;
    el('repete').checked = false;
    el('cai-sozinha').checked = false;
    await recarregar();
    if (aoSalvar) await aoSalvar();
    return true;
  }

  async function salvarCorrecao() {
    const mudancas = correcao(editando, {
      valor: valor.centavos(),
      tipo: tipoDaTransferencia(app, destino()),
      contaId: origem(),
      contaDestinoId: destino(),
      dataCaixa: data,
    });
    const deQuem = donos.ler();
    if (JSON.stringify(deQuem) !== JSON.stringify(editando.donos ?? [])) mudancas.donos = deQuem;
    if (Object.keys(mudancas).length === 0) return true;

    await estado.aplicarEvento('lancamento.alterado', { id: editando.id, ...mudancas });
    await recarregar();
    editando = app.lancamentos[editando.id] ?? editando;
    if (aoSalvar) await aoSalvar();
    return true;
  }

  // ── eventos ─────────────────────────────────────────────────────────────

  el('b-salvar').addEventListener('click', async () => {
    const salvou = await salvar();
    if (salvou && aoFechar) aoFechar();
  });

  // "Transferir e nova": guarda a data e as contas, e limpa o valor — a
  // pilha de aportes do mês, uma atrás da outra.
  el('b-salvar-nova').addEventListener('click', async () => {
    const salvou = await salvar();
    if (!salvou) return;
    valor.limpar();
    pintarAcao();
    valor.focar();
  });

  el('b-mais').addEventListener('click', () => { maisAberto = !maisAberto; pintarRepete(); });
  el('dia-menos').addEventListener('click', () => irPara(somarDias(data, -1)));
  el('dia-mais').addEventListener('click', () => irPara(somarDias(data, 1)));
  el('rotulo-data').addEventListener('click', () => {
    const campo = el('data');
    // O calendário do próprio aparelho, como no lançamento.
    if (typeof campo.showPicker === 'function') {
      try { campo.showPicker(); return; } catch { /* fora de gesto: cai abaixo */ }
    }
    campo.focus();
    campo.click();
  });

  el('b-pular').addEventListener('click', async () => {
    if (!daParcela) return;
    await pularParcela(daParcela.dividaId, daParcela.k);
    daParcela = null;
    if (aoSalvar) await aoSalvar();
    if (aoFechar) aoFechar();
  });

  el('b-voltar-contrato').addEventListener('click', async () => {
    if (!daParcela) return;
    await voltarAoContrato(daParcela.dividaId, daParcela.k);
    daParcela = null;
    if (aoSalvar) await aoSalvar();
    if (aoFechar) aoFechar();
  });

  el('origem').addEventListener('change', pintarAcao);
  el('donos').addEventListener('input', pintarAcao);
  el('destino').addEventListener('change', pintarAcao);
  el('data').addEventListener('change', () => {
    if (!el('data').value) { pintarData(); return; }
    irPara(el('data').value);
  });
  el('repete').addEventListener('change', pintarRepete);
  el('cai-sozinha').addEventListener('change', pintarRepete);

  // ── partida ─────────────────────────────────────────────────────────────

  async function recarregar() {
    app = await estado.calcular();
    pintarContas();
    pintarData();
    pintarDonos(true);
    perigo.mostrar(Boolean(editando));
    valor.pintar();
    pintarAcao();
  }

  await recarregar();

  return {
    recarregar,
    focar: () => valor.focar(),

    async carregar(l) {
      editando = l;
      daParcela = null;
      data = l.dataCaixa;
      valor.definir(l.valor);
      await recarregar();
    },

    /** A data em que a transferência nova abre (o mês da tela, D35). */
    usarData(dia) {
      if (!dia) return;
      data = dia;
      pintarData();
    },

    /** A data na tela agora: a da última transferência salva, depois de salvar. */
    dataAtual: () => data,

    limpar: () => {
      editando = null;
      daSerie = null;
      daParcela = null;
      data = hoje();
      el('repete').checked = false;
      el('cai-sozinha').checked = false;
      maisAberto = false;
      valor.limpar();
      el('origem').value = '';
      el('destino').value = '';
      pintarDonos(true);
      pintarData();
      perigo.mostrar(false);
      pintarAcao();
    },

    /**
     * A ocorrência de uma transferência recorrente, vinda do extrato: tudo
     * preenchido, e lançar amarra à série — o previsto some (03 §4).
     */
    async preencher(o) {
      editando = null;
      daSerie = o.recorrenciaId;
      daParcela = o.parcelaDe
        ? { ...o.parcelaDe, valor: o.valor, data: o.dataCompetencia, contaId: o.contaId }
        : null;
      data = o.dataCompetencia;
      await recarregar();
      if (daParcela) {
        const divida = app.contas[daParcela.dividaId]?.nome ?? 'a dívida';
        el('texto-parcela').textContent = o.corrigida
          ? `Parcela ${daParcela.k}/${daParcela.total} de ${divida}, corrigida (no contrato: ${formatar(o.valorDoContrato)}). Continua caindo sozinha.`
          : `Parcela ${daParcela.k}/${daParcela.total} de ${divida}: cai sozinha. Mude valor ou data se o banco cobrou diferente — só esta parcela muda.`;
        el('b-voltar-contrato').hidden = !o.corrigida;
      }
      el('origem').value = o.contaId ?? '';
      el('destino').value = o.contaDestinoId ?? '';
      valor.definir(o.valor);
      pintarAcao();
    },

    /**
     * O botão "pagar fatura" do cartão: a mesma transferência, já com a conta
     * que paga, o cartão e o valor. Tudo editável — pagamento parcial é
     * permitido, e o que falta continua devido (03-alimentacao §6.2).
     */
    async pagarFatura({ cartaoId, origemId, centavos }) {
      editando = null;
      daParcela = null;
      data = hoje();
      await recarregar();
      el('origem').value = origemId ?? '';
      el('destino').value = cartaoId;
      if (centavos > 0) valor.definir(centavos); else valor.limpar();
      pintarAcao();
    },
  };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
