// "Precisa de você" — a fila de pendências (R16) na tela. A única parte do app
// que cobra, e cobra pendência: saldo que está mentindo até alguém resolver
// (08-telas §6). Resolver cada item é um toque (03 §5).

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { correcao, nomeDaCategoria } from '../core/lancamentos.js';
import { pendencias } from '../core/pendencias.js';
import { diaCurto, hoje, nomeDoMes } from '../core/datas.js';
import { dinheiroHTML } from './dinheiro-html.js';

const VISIVEIS = 5;

/**
 * @param {object} o
 * @param {HTMLElement} o.raiz          a seção (fica escondida quando não há nada)
 * @param {Function} o.abrirPagamento   (cartaoId, centavos) → abre o pagar fatura
 * @param {Function} o.abrirConferencia (contaId) → abre a conferência
 */
export function criarFila({ raiz, abrirPagamento, abrirConferencia, abrirHolerite }) {
  let app = null;
  let itens = [];
  let todas = false;
  // O item com um campo aberto: { chave, modo: 'valor' | 'data' }.
  let aberto = null;

  function pintar(novoApp) {
    if (novoApp) app = novoApp;
    itens = pendencias(app);
    raiz.hidden = !itens.length;
    if (!itens.length) return;

    const mostrados = todas ? itens : itens.slice(0, VISIVEIS);
    raiz.innerHTML = `
      <h2>Precisa de você <span class="quantos">${itens.length}</span></h2>
      <ol class="lista-pendencias">${mostrados.map(itemHTML).join('')}</ol>
      ${itens.length > VISIVEIS ? `<button type="button" class="elo" data-fila="todas">${todas ? 'mostrar menos' : `ver todas (${itens.length})`}</button>` : ''}`;
  }

  function itemHTML(i) {
    const campo = aberto?.chave === i.chave ? campoAberto(i) : '';
    const botoes = campo || botoesDe(i);
    return `<li class="pendencia" data-chave="${escapar(i.chave)}">
      <span class="o-que">${descricao(i)}</span>
      <span class="botoes-pendencia">${botoes}</span>
    </li>`;
  }

  function descricao(i) {
    if (i.tipo === 'fatura') {
      return `Fatura ${escapar(i.cartao.nome)} · ${dinheiroHTML(i.fatura.aPagar)} · <span class="quando">venceu ${diaCurto(i.fatura.vencimento)}</span>`;
    }
    if (i.tipo === 'conferir') {
      return `${escapar(i.conta.nome)} · <span class="quando">sem conferir desde ${diaCurto(i.data)}</span>`;
    }
    if (i.tipo === 'holerite') {
      return `Contracheque de ${escapar(nomeDoMes(i.mes).split(' ')[0])} · ${escapar(i.conta.nome)} · <span class="quando">desde ${diaCurto(i.data)}</span>`;
    }
    const l = i.tipo === 'vencido' ? i.lancamento : i.ocorrencia;
    const conta = app.contas[l.contaId]?.nome ?? '';
    const nome =
      l.tipo === 'transferencia' || l.tipo === 'pagamento_fatura'
        ? `Transferência ${conta} → ${app.contas[l.contaDestinoId]?.nome ?? ''}`
        : `${nomeDaCategoria(app, l.categoriaId) || l.tipo}${l.detalheId && app.detalhes?.[l.detalheId] ? ` · ${app.detalhes[l.detalheId].nome}` : ''}`;
    const estimado = i.tipo === 'ocorrencia' ? i.ocorrencia.estimado : l.origemValor?.startsWith('estimado');
    const quando = l.dataCaixa === hoje() ? 'vence hoje' : `venceu ${diaCurto(l.dataCaixa)}`;
    return `${escapar(nome)} · ${dinheiroHTML(l.valor, { estimado })} · <span class="quando">${quando}</span>${
      l.tipo === 'transferencia' ? '' : ` <span class="fino">${escapar(conta)}</span>`
    }`;
  }

  function botoesDe(i) {
    if (i.tipo === 'fatura') return '<button type="button" class="principal" data-fila="pagar">Pagar</button>';
    if (i.tipo === 'conferir') return '<button type="button" data-fila="conferir">Conferir</button>';
    if (i.tipo === 'holerite') return '<button type="button" class="principal" data-fila="holerite">Lançar</button>';
    const l = i.tipo === 'vencido' ? i.lancamento : i.ocorrencia;
    const estimado = i.tipo === 'ocorrencia' ? i.ocorrencia.estimado : l.origemValor?.startsWith('estimado');
    // O ~ é obrigatório no valor estimado, até no botão (08-telas §3.1).
    return `<button type="button" class="principal" data-fila="confirmar">Confirmar ${estimado ? '~' : ''}${escapar(formatar(l.valor))}</button>
      <button type="button" data-fila="outro">Outro valor</button>
      <button type="button" data-fila="reagendar">Reagendar</button>
      ${i.tipo === 'ocorrencia' ? '<button type="button" class="elo" data-fila="nao-houve" title="Este mês não teve">não houve</button>' : ''}`;
  }

  function campoAberto(i) {
    const l = i.tipo === 'vencido' ? i.lancamento : i.ocorrencia;
    if (aberto.modo === 'valor') {
      // Conta fixa que veio diferente: pode ser reajuste (design/10 §7).
      const serie = app.recorrencias?.[l.recorrenciaId];
      const reajustavel = serie?.tipoValor === 'fixa';
      return `<input type="text" inputmode="decimal" class="campo-fila" data-fila-campo
          value="${escapar(formatar(l.valor, { comPrefixo: false }))}" aria-label="Quanto foi">
        ${reajustavel ? '<label class="reajuste-fila"><input type="checkbox" data-fila-reajuste> vale daqui pra frente</label>' : ''}
        <button type="button" class="principal" data-fila="ok-valor">Confirmar</button>
        <button type="button" class="elo" data-fila="cancelar">cancelar</button>`;
    }
    return `<input type="date" class="campo-fila" data-fila-campo value="${escapar(hoje())}" aria-label="Nova data">
      <button type="button" class="principal" data-fila="ok-data">Reagendar</button>
      <button type="button" class="elo" data-fila="cancelar">cancelar</button>`;
  }

  // ── resolver ────────────────────────────────────────────────────────────

  /** Lança a ocorrência de uma série: confirmada, ou agendada noutra data. */
  async function lancarOcorrencia(o, { valor = o.valor, confirmado = true, dataCaixa = o.dataCompetencia } = {}) {
    const ap = await log.aparelho();
    await estado.aplicarEvento('lancamento.registrado', {
      id: novoId('lan'),
      tipo: o.tipo,
      valor,
      contaId: o.contaId,
      contaDestinoId: o.contaDestinoId,
      categoriaId: o.categoriaId,
      detalheId: o.detalheId,
      recorrenciaId: o.recorrenciaId,
      dataCompetencia: o.dataCompetencia,
      dataCaixa,
      confirmado,
      // O estimado e o realizado ficam os dois: sem isso a R18 é impossível
      // de reconstruir depois (03 §5).
      origemValor: valor === o.valor ? o.origemValor ?? 'digitado' : 'digitado',
      valorEstimadoOriginal: o.estimado ? o.valor : null,
      lancadoPor: ap?.id ?? null,
    });
  }

  async function confirmarVencido(l, valor = l.valor) {
    const mudancas = { id: l.id, confirmado: true };
    if (valor !== l.valor) {
      mudancas.valor = valor;
      mudancas.origemValor = 'digitado';
      if (l.origemValor?.startsWith('estimado') && l.valorEstimadoOriginal == null) {
        mudancas.valorEstimadoOriginal = l.valor;
      }
    }
    await estado.aplicarEvento('lancamento.alterado', mudancas);
  }

  async function agir(acao, i, campo) {
    const l = i.tipo === 'vencido' ? i.lancamento : i.ocorrencia;
    switch (acao) {
      case 'pagar':
        return abrirPagamento(i.cartao.id, i.fatura.aPagar);
      case 'conferir':
        return abrirConferencia(i.conta.id);
      case 'holerite':
        return abrirHolerite(i.conta.id, i.mes);
      case 'outro':
      case 'reagendar':
        aberto = { chave: i.chave, modo: acao === 'outro' ? 'valor' : 'data' };
        pintar();
        raiz.querySelector('[data-fila-campo]')?.focus();
        raiz.querySelector('[data-fila-campo]')?.select?.();
        return;
      case 'cancelar':
        aberto = null;
        return pintar();
      case 'confirmar':
        if (i.tipo === 'vencido') await confirmarVencido(l);
        else await lancarOcorrencia(l);
        break;
      case 'ok-valor': {
        const valor = Math.abs(deTexto(campo?.value ?? ''));
        if (!valor) return;
        const reajuste = raiz.querySelector(`[data-chave="${CSS.escape(i.chave)}"] [data-fila-reajuste]`)?.checked;
        if (i.tipo === 'vencido') await confirmarVencido(l, valor);
        else await lancarOcorrencia(l, { valor });
        if (reajuste && l.recorrenciaId) {
          await estado.aplicarEvento('recorrencia.reajustada', { id: l.recorrenciaId, desde: l.dataCompetencia, valor });
        }
        break;
      }
      case 'ok-data': {
        const nova = campo?.value;
        if (!nova) return;
        if (i.tipo === 'vencido') {
          const m = correcao(l, { dataCaixa: nova });
          if (Object.keys(m).length) await estado.aplicarEvento('lancamento.alterado', { id: l.id, ...m });
        } else {
          // Reagendar uma ocorrência é agendá-la: vira lançamento previsto na
          // data nova, ainda do mês dela.
          await lancarOcorrencia(l, { confirmado: nova <= hoje(), dataCaixa: nova });
        }
        break;
      }
      case 'nao-houve':
        await estado.aplicarEvento('recorrencia.pulada', { id: l.recorrenciaId, mes: l.dataCompetencia.slice(0, 7) });
        break;
      default:
        return;
    }
    aberto = null;
    // Quem pintou a tela de novo é o ouvinte do estado (aoAplicar).
  }

  raiz.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fila]');
    if (!b) return;
    if (b.dataset.fila === 'todas') {
      todas = !todas;
      return pintar();
    }
    const li = b.closest('[data-chave]');
    const i = itens.find((x) => x.chave === li?.dataset.chave);
    if (!i) return;
    await agir(b.dataset.fila, i, li.querySelector('[data-fila-campo]'));
  });

  raiz.addEventListener('keydown', async (e) => {
    const campo = e.target.closest?.('[data-fila-campo]');
    if (!campo) return;
    if (e.key === 'Escape') { aberto = null; pintar(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const li = campo.closest('[data-chave]');
    const i = itens.find((x) => x.chave === li?.dataset.chave);
    if (i) await agir(aberto?.modo === 'valor' ? 'ok-valor' : 'ok-data', i, campo);
  });

  return { pintar };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
