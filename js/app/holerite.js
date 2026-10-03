// "Lançar o holerite do mês" — numa conta de folha (design/10 §2, D25).
//
// É um resumo para conferir (pedido dele, 03/10/2026): as linhas previstas do
// mês — editáveis, e "não veio" para a que faltou —, o que já foi lançado na
// folha, e o líquido que vai para a conta corrente. Lança-se, ou volta-se: se
// falta alguma linha, ela se lança na folha como qualquer lançamento (marcando
// "repete" para o mês que vem já nascer pronto), e o holerite se abre de novo.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { hoje, diaNoMes, nomeDoMes } from '../core/datas.js';
import { nomeDaCategoria } from '../core/lancamentos.js';
import { linhasDoHolerite, lancadosNoMes, liquido } from '../core/holerite.js';
import { opcoesDeConta } from './areas.js';

const MARCACAO = `
  <p class="nota" data-papel="cabeca"></p>
  <label class="campo-simples">
    <span class="miudo">dia do crédito</span>
    <input type="date" data-papel="data" aria-label="Dia do crédito">
  </label>
  <p class="miudo titulo-linhas" data-papel="titulo-previstas" hidden>a lançar agora</p>
  <ol class="linhas-holerite" data-papel="linhas"></ol>
  <p class="miudo titulo-linhas" data-papel="titulo-lancados" hidden>já lançado no mês</p>
  <ol class="linhas-holerite lancados-holerite" data-papel="lancados"></ol>
  <div class="liquido-holerite">
    <span>→ líquido para</span>
    <select data-papel="destino" aria-label="Para onde vai o líquido"></select>
    <strong data-papel="valor-liquido"></strong>
  </div>
  <p class="recado" data-papel="recado" hidden></p>
  <div class="acoes">
    <button type="button" class="principal" data-papel="b-lancar">Lançar contracheque</button>
    <button type="button" data-papel="b-voltar">Voltar</button>
  </div>
`;

export function criarHolerite({ janela, raiz, aoSalvar }) {
  raiz.innerHTML = MARCACAO;
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);

  let app = null;
  let folha = null;
  let mes = null;
  // Cada linha: { chave, ocorrencia, tipo, categoriaId, contaDestinoId, valor, estimado, automatico, fora }
  let linhas = [];
  let jaLancado = 0;
  // Os lançamentos que já estão na folha no mês — mostrados para conferir.
  let jaLancados = [];

  function recadar(texto) {
    el('recado').textContent = texto;
    el('recado').hidden = !texto;
  }

  function nomeDaLinha(l) {
    if (l.tipo === 'transferencia') return `→ ${app.contas[l.contaDestinoId]?.nome ?? '—'}`;
    return nomeDaCategoria(app, l.categoriaId) || l.tipo;
  }

  function pintar() {
    el('linhas').innerHTML = linhas.length
      ? linhas
          .map((l) => {
            const marca = l.tipo === 'receita' ? '↑' : l.tipo === 'despesa' ? '↓' : '→';
            const tom = l.tipo === 'receita' ? 'receita' : l.tipo === 'despesa' ? 'despesa' : 'transferencia';
            const obrig = l.tipo === 'despesa' && app.categorias[l.categoriaId]?.obrigatoria;
            return `<li class="linha-holerite ${tom} ${l.fora ? 'fora' : ''}" data-chave="${escapar(l.chave)}">
              <span class="marca" aria-hidden="true">${marca}</span>
              <span class="nome-linha">${escapar(nomeDaLinha(l))}${obrig ? ' <span class="selo">obrigatória</span>' : ''}${l.estimado ? ' <span class="selo">estimado</span>' : ''}${l.automatico ? ' <span class="selo">cai sozinha</span>' : ''}</span>
              <input type="text" inputmode="decimal" data-valor value="${escapar(formatar(l.valor, { comPrefixo: false }))}" ${l.fora || l.automatico ? 'disabled' : ''} aria-label="Valor de ${escapar(nomeDaLinha(l))}">
              ${l.automatico ? '<span></span>' : `<button type="button" class="elo" data-fora title="${l.fora ? 'Volta para este mês' : 'Não veio este mês'}">${l.fora ? 'voltar' : 'não veio'}</button>`}
              ${reajustavel(l) ? `<label class="reajuste"><input type="checkbox" data-reajuste ${l.reajuste ? 'checked' : ''}> vale daqui pra frente</label>` : ''}
            </li>`;
          })
          .join('')
      : '';
    el('titulo-previstas').hidden = !linhas.length;
    pintarLancados();
    pintarLiquido();
  }

  /** Linha fixa que veio com valor diferente: pode ser reajuste (aumento, por exemplo). */
  function reajustavel(l) {
    const serie = l.ocorrencia ? app.recorrencias[l.ocorrencia.recorrenciaId] : null;
    return !l.fora && serie?.tipoValor === 'fixa' && l.valor !== l.ocorrencia.valor;
  }

  function valorDoLiquido() {
    const ativas = linhas.filter((l) => !l.fora);
    return liquido(ativas) + jaLancado;
  }

  function pintarLiquido() {
    const v = valorDoLiquido();
    el('valor-liquido').textContent = formatar(v);
    el('valor-liquido').classList.toggle('negativo', v < 0);
  }

  /** O que já está na folha no mês: só para conferir, cada linha com o seu sinal. */
  function pintarLancados() {
    const ordem = { receita: 0, despesa: 1 };
    const lista = [...jaLancados].sort((a, b) => (ordem[a.tipo] ?? 2) - (ordem[b.tipo] ?? 2));
    el('titulo-lancados').hidden = !lista.length;
    el('lancados').innerHTML = lista
      .map((l) => {
        const entra = l.tipo === 'receita' || l.contaDestinoId === folha.id;
        const outra = app.contas[l.contaId === folha.id ? l.contaDestinoId : l.contaId];
        const nome = l.tipo === 'transferencia'
          ? outra?.nome ?? '—'
          : nomeDaCategoria(app, l.categoriaId) || l.tipo;
        const tom = l.tipo === 'receita' ? 'receita' : l.tipo === 'despesa' ? 'despesa' : 'transferencia';
        const marca = l.tipo === 'receita' ? '↑' : l.tipo === 'despesa' ? '↓' : '→';
        return `<li class="linha-holerite ${tom}">
          <span class="marca" aria-hidden="true">${marca}</span>
          <span class="nome-linha">${escapar(nome)}${l.automatico ? ' <span class="selo">caiu sozinha</span>' : ''}</span>
          <span class="valor-lancado">${entra ? '+' : '−'} ${escapar(formatar(l.valor))}</span>
        </li>`;
      })
      .join('');
  }

  /**
   * @param {string} folhaId
   * @param {string} [mesAlvo] '2026-10' — padrão: o mês corrente
   */
  async function abrir(folhaId, mesAlvo = hoje().slice(0, 7)) {
    app = await estado.calcular();
    folha = app.contas[folhaId];
    if (!folha) return;
    mes = mesAlvo;

    const previstas = linhasDoHolerite(app, folha.id, mes);
    linhas = previstas.map((o) => ({
      chave: o.id,
      ocorrencia: o,
      tipo: o.tipo,
      categoriaId: o.categoriaId,
      contaDestinoId: o.contaDestinoId,
      valor: o.valor,
      estimado: o.estimado,
      // A parcela do consignado cai sozinha (design/10 §4.4): conta no
      // líquido, mas não se lança nem se edita aqui.
      automatico: Boolean(o.automatico),
      fora: false,
    }));

    // O que já foi lançado na folha neste mês conta no líquido — inclusive um
    // líquido já transferido: o holerite fecha a folha do mês inteira, então o
    // líquido novo é só o que falta para ela zerar.
    const ja = lancadosNoMes(app, folha.id, mes);
    jaLancados = ja;
    jaLancado = liquido(ja.filter((l) => l.contaId === folha.id)) + ja.filter((l) => l.contaDestinoId === folha.id).reduce((t, l) => t + l.valor, 0);

    const [ano, m] = mes.split('-').map(Number);
    const dia = previstas[0] ? previstas[0].dataCompetencia : mes === hoje().slice(0, 7) ? hoje() : diaNoMes(ano, m, 1);
    el('data').value = dia;
    el('cabeca').innerHTML = `<strong>${escapar(folha.nome)}</strong> · contracheque de ${escapar(nomeDoMes(mes))} · confira: falta alguma linha? Volte, lance na folha e abra de novo.`;

    const caixa = Object.values(app.contas).filter((c) => !c.arquivada && (c.tipo === 'corrente' || c.tipo === 'especie'));
    el('destino').innerHTML = opcoesDeConta(caixa, folha.liquidoPara ?? caixa[0]?.id);
    recadar('');
    pintar();
    janela.dataset.area = 'folha';
    janela.showModal();
  }

  async function lancar() {
    const data = el('data').value;
    const destino = el('destino').value;
    const total = valorDoLiquido();
    if (!data) return recadar('Falta o dia do crédito.');
    if (total < 0) return recadar(`Os descontos passam o que entrou em ${formatar(-total)}: confira os valores.`);
    if (total > 0 && !destino) return recadar('Escolha para onde vai o líquido.');

    const ap = await log.aparelho();
    const confirmado = data <= hoje();
    const comum = { contaId: folha.id, dataCompetencia: data, dataCaixa: data, confirmado, lancadoPor: ap?.id ?? null };

    for (const l of linhas) {
      if (l.automatico) continue;
      if (l.fora) {
        // Não veio este mês: a série segue, só este mês sai da projeção.
        if (l.ocorrencia) await estado.aplicarEvento('recorrencia.pulada', { id: l.ocorrencia.recorrenciaId, mes });
        continue;
      }
      const recorrenciaId = l.ocorrencia?.recorrenciaId ?? null;
      const o = l.ocorrencia;
      await estado.aplicarEvento('lancamento.registrado', {
        id: novoId('lan'),
        ...comum,
        tipo: l.tipo,
        valor: l.valor,
        categoriaId: l.categoriaId,
        contaDestinoId: l.contaDestinoId,
        recorrenciaId,
        // O estimado e o realizado ficam os dois (03 §5, R18).
        origemValor: o && l.valor === o.valor ? o.origemValor ?? 'digitado' : 'digitado',
        valorEstimadoOriginal: o?.estimado ? o.valor : null,
      });
      if (l.reajuste && reajustavel(l) && recorrenciaId) {
        await estado.aplicarEvento('recorrencia.reajustada', { id: recorrenciaId, desde: data, valor: l.valor });
      }
    }

    if (total > 0) {
      // O líquido: uma linha limpa na corrente (D25), e a folha volta a zero.
      await estado.aplicarEvento('lancamento.registrado', {
        id: novoId('lan'),
        ...comum,
        tipo: 'transferencia',
        valor: total,
        contaDestinoId: destino,
        categoriaId: null,
      });
    }
    if (destino && destino !== folha.liquidoPara) {
      await estado.aplicarEvento('conta.alterada', { id: folha.id, liquidoPara: destino });
    }
    if (aoSalvar) await aoSalvar();
    janela.close();
  }

  // ── eventos ─────────────────────────────────────────────────────────────

  el('linhas').addEventListener('input', (e) => {
    const campo = e.target.closest('[data-valor]');
    if (!campo) return;
    const l = linhas.find((x) => x.chave === campo.closest('[data-chave]').dataset.chave);
    if (!l) return;
    l.valor = Math.abs(deTexto(campo.value));
    l.estimado = false;
    pintarLiquido();
  });

  // Ao sair do campo, a linha se redesenha: é quando aparece a pergunta do reajuste.
  el('linhas').addEventListener('change', (e) => {
    const marca = e.target.closest('[data-reajuste]');
    const l = linhas.find((x) => x.chave === e.target.closest('[data-chave]')?.dataset.chave);
    if (!l) return;
    if (marca) { l.reajuste = marca.checked; return; }
    if (e.target.closest('[data-valor]')) pintar();
  });

  el('linhas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fora]');
    if (!b) return;
    const l = linhas.find((x) => x.chave === b.closest('[data-chave]').dataset.chave);
    if (!l) return;
    l.fora = !l.fora;
    pintar();
  });

  el('b-lancar').addEventListener('click', lancar);
  el('b-voltar').addEventListener('click', () => janela.close());

  return { abrir };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
