// "Lançar o holerite do mês" — numa conta de folha (design/10 §2, D25).
//
// Traz todas as linhas previstas — salário base, auxílio, IR, previdência,
// consignado —, cada uma editável, e calcula o líquido que vai para a conta
// corrente. Confirma-se tudo de uma vez, ou ajusta-se a linha que veio
// diferente. Linha a mais (hora extra, 13º) se acrescenta ali mesmo; linha que
// não veio este mês sai com um toque, sem mexer na série.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { hoje, diaNoMes, nomeDoMes } from '../core/datas.js';
import { nomeDaCategoria } from '../core/lancamentos.js';
import { linhasDoHolerite, lancadosNoMes, liquido } from '../core/holerite.js';
import { opcoesDeConta, categoriaNaArea } from './areas.js';

const MARCACAO = `
  <p class="nota" data-papel="cabeca"></p>
  <label class="campo-simples">
    <span class="miudo">dia do crédito</span>
    <input type="date" data-papel="data" aria-label="Dia do crédito">
  </label>
  <ol class="linhas-holerite" data-papel="linhas"></ol>
  <div class="linha-nova">
    <select data-papel="nova-categoria" aria-label="Categoria da linha nova"></select>
    <input type="text" inputmode="decimal" data-papel="novo-valor" placeholder="0,00" aria-label="Valor da linha nova" autocomplete="off">
    <select data-papel="nova-repete" aria-label="Se repete">
      <option value="nao">só este mês</option>
      <option value="fixa">todo mês, fixo</option>
      <option value="variavel">todo mês, estimado</option>
    </select>
    <button type="button" data-papel="b-acrescentar">acrescentar</button>
  </div>
  <div class="liquido-holerite">
    <span>→ líquido para</span>
    <select data-papel="destino" aria-label="Para onde vai o líquido"></select>
    <strong data-papel="valor-liquido"></strong>
  </div>
  <p class="recado" data-papel="recado" hidden></p>
  <div class="acoes"><button type="button" class="principal" data-papel="b-lancar">Lançar holerite</button></div>
`;

export function criarHolerite({ janela, raiz, aoSalvar }) {
  raiz.innerHTML = MARCACAO;
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);

  let app = null;
  let folha = null;
  let mes = null;
  // Cada linha: { chave, ocorrencia?, tipo, categoriaId, contaDestinoId, valor, estimado, fora, repete }
  let linhas = [];
  let jaLancado = 0;

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
              <span class="nome-linha">${escapar(nomeDaLinha(l))}${obrig ? ' <span class="selo">obrigatória</span>' : ''}${l.estimado ? ' <span class="selo">estimado</span>' : ''}</span>
              <input type="text" inputmode="decimal" data-valor value="${escapar(formatar(l.valor, { comPrefixo: false }))}" ${l.fora ? 'disabled' : ''} aria-label="Valor de ${escapar(nomeDaLinha(l))}">
              <button type="button" class="elo" data-fora title="${l.fora ? 'Volta para este mês' : 'Não veio este mês'}">${l.fora ? 'voltar' : 'não veio'}</button>
            </li>`;
          })
          .join('')
      : '<li class="vazio">Nenhuma linha prevista. Acrescente abaixo o que entrou e o que foi descontado — marcando "todo mês", o holerite do mês que vem já nasce pronto.</li>';
    pintarLiquido();
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

  function pintarCategoriasNovas() {
    const daFolha = Object.values(app.categorias).filter((c) => !c.arquivada && categoriaNaArea(c, folha));
    const grupo = (natureza, rotulo) => {
      const lista = daFolha.filter((c) => (c.natureza ?? 'despesa') === natureza).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      return lista.length
        ? `<optgroup label="${rotulo}">${lista.map((c) => `<option value="${escapar(c.id)}">${escapar(c.nome)}</option>`).join('')}</optgroup>`
        : '';
    };
    el('nova-categoria').innerHTML =
      '<option value="">linha nova…</option>' + grupo('receita', '↑ entra') + grupo('despesa', '↓ desconto');
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
      fora: false,
    }));

    // O que já foi lançado na folha neste mês conta no líquido — inclusive um
    // líquido já transferido: o holerite fecha a folha do mês inteira, então o
    // líquido novo é só o que falta para ela zerar.
    const ja = lancadosNoMes(app, folha.id, mes);
    jaLancado = liquido(ja.filter((l) => l.contaId === folha.id)) + ja.filter((l) => l.contaDestinoId === folha.id).reduce((t, l) => t + l.valor, 0);

    const [ano, m] = mes.split('-').map(Number);
    const dia = previstas[0] ? previstas[0].dataCompetencia : mes === hoje().slice(0, 7) ? hoje() : diaNoMes(ano, m, 1);
    el('data').value = dia;
    el('cabeca').innerHTML = `<strong>${escapar(folha.nome)}</strong> · holerite de ${escapar(nomeDoMes(mes))}${ja.length ? ` · ${ja.length} linha${ja.length > 1 ? 's' : ''} já lançada${ja.length > 1 ? 's' : ''} entra${ja.length > 1 ? 'm' : ''} no líquido` : ''}`;

    const caixa = Object.values(app.contas).filter((c) => !c.arquivada && (c.tipo === 'corrente' || c.tipo === 'especie'));
    el('destino').innerHTML = opcoesDeConta(caixa, folha.liquidoPara ?? caixa[0]?.id);
    pintarCategoriasNovas();
    el('novo-valor').value = '';
    recadar('');
    pintar();
    janela.dataset.area = 'folha';
    janela.showModal();
  }

  function acrescentar() {
    const categoriaId = el('nova-categoria').value;
    const valor = Math.abs(deTexto(el('novo-valor').value));
    if (!categoriaId) return recadar('Escolha a categoria da linha nova.');
    if (!valor) return recadar('Falta o valor da linha nova.');
    const c = app.categorias[categoriaId];
    linhas.push({
      chave: novoId('nova'),
      tipo: c.natureza === 'receita' ? 'receita' : 'despesa',
      categoriaId,
      contaDestinoId: null,
      valor,
      estimado: false,
      fora: false,
      repete: el('nova-repete').value,
    });
    el('nova-categoria').value = '';
    el('novo-valor').value = '';
    el('nova-repete').value = 'nao';
    recadar('');
    pintar();
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
      if (l.fora) {
        // Não veio este mês: a série segue, só este mês sai da projeção.
        if (l.ocorrencia) await estado.aplicarEvento('recorrencia.pulada', { id: l.ocorrencia.recorrenciaId, mes });
        continue;
      }
      let recorrenciaId = l.ocorrencia?.recorrenciaId ?? null;
      if (!recorrenciaId && l.repete && l.repete !== 'nao') {
        recorrenciaId = novoId('rec');
        await estado.aplicarEvento('recorrencia.criada', {
          id: recorrenciaId,
          nome: nomeDaCategoria(app, l.categoriaId),
          tipo: l.tipo,
          contaId: folha.id,
          categoriaId: l.categoriaId,
          tipoValor: l.repete,
          valor: l.repete === 'fixa' ? l.valor : null,
          periodicidade: 'mensal',
          dia: Number(data.slice(8, 10)),
          inicio: data,
        });
      }
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

  el('linhas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fora]');
    if (!b) return;
    const l = linhas.find((x) => x.chave === b.closest('[data-chave]').dataset.chave);
    if (!l) return;
    if (!l.ocorrencia && !l.fora) {
      // Linha acrescentada agora: "não veio" é simplesmente tirá-la.
      linhas = linhas.filter((x) => x !== l);
    } else {
      l.fora = !l.fora;
    }
    pintar();
  });

  el('b-acrescentar').addEventListener('click', acrescentar);
  el('novo-valor').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); acrescentar(); }
  });
  el('b-lancar').addEventListener('click', lancar);

  return { abrir };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
