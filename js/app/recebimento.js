// "Lançar recebimento" — numa conta de folha de recebimentos avulsos (autônomo).
// Cada pagamento que chega é um mini contracheque: o bruto entra na folha, o
// imposto retido (se houver) sai dela, e o líquido segue para a conta que
// recebeu — a folha fecha em zero na hora, sem a conferência do mês.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { hoje } from '../core/datas.js';
import { opcoesDeConta, categoriaNaArea, areasParaConta } from './areas.js';

const NOVA = '__nova__';

const MARCACAO = `
  <p class="nota" data-papel="cabeca"></p>
  <label class="campo-simples"><span class="miudo">dia do recebimento</span>
    <input type="date" data-papel="data" aria-label="Dia do recebimento"></label>
  <label class="campo-simples"><span class="miudo">quem pagou</span>
    <input type="text" data-papel="quem" autocomplete="off" placeholder="cliente ou serviço" aria-label="Quem pagou"></label>
  <label class="campo-simples"><span class="miudo">valor bruto</span>
    <input type="text" inputmode="decimal" data-papel="bruto" autocomplete="off" placeholder="0,00" aria-label="Valor bruto"></label>
  <label class="campo-simples"><span class="miudo">categoria da entrada</span>
    <select data-papel="cat-entrada" aria-label="Categoria da entrada"></select>
    <input type="text" data-papel="nova-entrada" autocomplete="off" placeholder="nome da categoria nova" aria-label="Categoria nova da entrada" hidden></label>
  <label class="campo-simples"><span class="miudo">imposto retido <span class="fino">· opcional</span></span>
    <input type="text" inputmode="decimal" data-papel="retido" autocomplete="off" placeholder="0,00" aria-label="Imposto retido"></label>
  <label class="campo-simples" data-papel="campo-cat-retido" hidden><span class="miudo">categoria do imposto</span>
    <select data-papel="cat-retido" aria-label="Categoria do imposto"></select>
    <input type="text" data-papel="nova-retido" autocomplete="off" placeholder="nome da categoria nova" aria-label="Categoria nova do imposto" hidden></label>
  <div class="liquido-holerite">
    <span>→ líquido para</span>
    <select data-papel="destino" aria-label="Para onde vai o líquido"></select>
    <strong data-papel="valor-liquido"></strong>
  </div>
  <p class="recado" data-papel="recado" hidden></p>
  <div class="acoes">
    <button type="button" class="principal" data-papel="b-lancar">Lançar recebimento</button>
    <button type="button" data-papel="b-voltar">Voltar</button>
  </div>
`;

export function criarRecebimento({ janela, raiz, aoSalvar }) {
  raiz.innerHTML = MARCACAO;
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);
  let app = null;
  let folha = null;

  const recadar = (t) => { el('recado').textContent = t; el('recado').hidden = !t; };
  const bruto = () => Math.abs(deTexto(el('bruto').value));
  const retido = () => Math.abs(deTexto(el('retido').value));

  /** As categorias da folha de uma natureza, mais "nova…" no fim. */
  function opcoesDeCategoria(natureza, escolhida) {
    const lista = Object.values(app.categorias)
      .filter((c) => !c.arquivada && c.natureza === natureza && c.pai !== null && categoriaNaArea(c, folha) && (c.areas ?? []).includes('folha'))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return lista.map((c) => `<option value="${esc(c.id)}"${c.id === escolhida ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')
      + `<option value="${NOVA}">+ nova categoria…</option>`;
  }

  function pintar() {
    const liquido = bruto() - retido();
    el('valor-liquido').textContent = formatar(Math.max(0, liquido));
    el('valor-liquido').classList.toggle('negativo', liquido < 0);
    el('campo-cat-retido').hidden = retido() <= 0;
    el('nova-entrada').hidden = el('cat-entrada').value !== NOVA;
    el('nova-retido').hidden = el('cat-retido').value !== NOVA;
  }

  async function abrir(folhaId) {
    app = await estado.calcular();
    folha = app.contas[folhaId];
    if (!folha) return;
    el('cabeca').innerHTML = `<strong>${esc(folha.nome)}</strong> · um pagamento que chegou. O líquido vai para a conta e a folha fecha em zero.`;
    el('data').value = hoje();
    el('quem').value = '';
    el('bruto').value = '';
    el('retido').value = '';
    el('nova-entrada').value = '';
    el('nova-retido').value = '';
    el('cat-entrada').innerHTML = opcoesDeCategoria('receita');
    el('cat-retido').innerHTML = opcoesDeCategoria('despesa');
    const caixa = Object.values(app.contas).filter((c) => !c.arquivada && (c.tipo === 'corrente' || c.tipo === 'especie'));
    el('destino').innerHTML = opcoesDeConta(caixa, folha.liquidoPara ?? caixa[0]?.id);
    recadar('');
    pintar();
    janela.dataset.area = 'folha';
    janela.showModal();
    el('bruto').focus();
  }

  /** A categoria escolhida; se for "nova…", cria na folha e devolve o id. */
  async function categoriaDe(papelSelect, papelNova, natureza, extra = {}) {
    const valor = el(papelSelect).value;
    if (valor !== NOVA) return valor || null;
    const nome = el(papelNova).value.trim();
    if (!nome) return undefined;
    const igual = Object.values(app.categorias).find((c) => c.natureza === natureza && c.nome.trim().toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'));
    if (igual) return igual.id;
    const id = novoId('cat');
    await estado.aplicarEvento('categoria.criada', { id, nome, pai: null, natureza, areas: areasParaConta(folha), ...extra });
    return id;
  }

  async function lancar() {
    const data = el('data').value;
    const valorBruto = bruto();
    const valorRetido = retido();
    const destino = el('destino').value;
    if (!data) return recadar('Falta o dia do recebimento.');
    if (!valorBruto) return recadar('Digite o valor bruto.');
    if (valorRetido > valorBruto) return recadar('O imposto retido passa do valor bruto.');
    const liquido = valorBruto - valorRetido;
    if (liquido > 0 && !destino) return recadar('Escolha para onde vai o líquido.');

    const categoriaEntrada = await categoriaDe('cat-entrada', 'nova-entrada', 'receita');
    if (categoriaEntrada === undefined || categoriaEntrada === null) return recadar('Escolha ou dê nome à categoria da entrada.');
    let categoriaRetido = null;
    if (valorRetido > 0) {
      categoriaRetido = await categoriaDe('cat-retido', 'nova-retido', 'despesa', { obrigatoria: true });
      if (!categoriaRetido) return recadar('Escolha ou dê nome à categoria do imposto.');
    }

    const ap = await log.aparelho();
    const comum = { contaId: folha.id, dataCompetencia: data, dataCaixa: data, confirmado: data <= hoje(), lancadoPor: ap?.id ?? null };
    const quem = el('quem').value.trim();
    await estado.aplicarEvento('lancamento.registrado', {
      id: novoId('lan'), ...comum, tipo: 'receita', valor: valorBruto, categoriaId: categoriaEntrada, observacao: quem,
    });
    if (valorRetido > 0) {
      await estado.aplicarEvento('lancamento.registrado', {
        id: novoId('lan'), ...comum, tipo: 'despesa', valor: valorRetido, categoriaId: categoriaRetido, observacao: quem,
      });
    }
    if (liquido > 0) {
      await estado.aplicarEvento('lancamento.registrado', {
        id: novoId('lan'), ...comum, tipo: 'transferencia', valor: liquido, contaDestinoId: destino, categoriaId: null, observacao: quem,
      });
    }
    if (destino && destino !== folha.liquidoPara) await estado.aplicarEvento('conta.alterada', { id: folha.id, liquidoPara: destino });
    if (aoSalvar) await aoSalvar();
    janela.close();
  }

  raiz.addEventListener('input', pintar);
  raiz.addEventListener('change', pintar);
  el('b-lancar').addEventListener('click', lancar);
  el('b-voltar').addEventListener('click', () => janela.close());
  el('bruto').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lancar(); } });

  return { abrir };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
