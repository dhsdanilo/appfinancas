// Conferir o saldo com o mundo (03 §8).
//
//   Corrente: informo o saldo que o banco mostra. Bateu, a conta ganha
//   "conferida em". Não bateu, o app mostra a diferença e os candidatos —
//   previstos vencidos, duplicatas suspeitas — e nunca corrige sozinho.
//
//   Espécie: não há extrato pra conferir, então há AJUSTE DE CAIXA. Conferi a
//   carteira, tem R$ 80, o app diz R$ 115: entra um ajuste de −R$ 35, fora dos
//   relatórios de gasto. O furo fica visível em vez de virar gasto fantasma.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { hoje, diaCurto } from '../core/datas.js';
import { visiveis, saldoReal, nomeDaCategoria } from '../core/lancamentos.js';
import { ligarZonaDePerigo } from './zona-perigo.js';
import { areaDaConta, opcoesDeConta } from './areas.js';

const MARCACAO = `
  <div data-papel="conferir">
    <label class="campo-simples">
      <span class="miudo">conta</span>
      <select data-papel="conta" aria-label="Conta a conferir"></select>
    </label>
    <label class="campo-simples">
      <span class="miudo" data-papel="rotulo">saldo que o banco mostra hoje</span>
      <input type="text" inputmode="decimal" data-papel="saldo" autocomplete="off" aria-label="Saldo de verdade">
    </label>
    <p class="nota" data-papel="no-app"></p>
    <div class="acoes"><button type="button" class="principal" data-papel="b-conferir">Conferir</button></div>
    <div class="resultado-conferencia" data-papel="resultado" hidden></div>
  </div>
  <div data-papel="ajuste" hidden>
    <p class="nota" data-papel="sobre-ajuste"></p>
    <p class="zona-perigo" data-papel="perigo" hidden></p>
  </div>
`;

export function criarConferencia({ janela, titulo, raiz, aoSalvar }) {
  raiz.innerHTML = MARCACAO;
  const el = (papel) => raiz.querySelector(`[data-papel="${papel}"]`);

  let app = null;
  let ajuste = null;

  const conferiveis = () =>
    Object.values(app.contas).filter((c) => !c.arquivada && (c.tipo === 'corrente' || c.tipo === 'especie'));

  const perigo = ligarZonaDePerigo(el('perigo'), {
    rotulo: 'apagar ajuste',
    descricao: () => formatar(ajuste.valor),
    apagar: async () => {
      await estado.aplicarEvento('lancamento.removido', { id: ajuste.id });
      if (aoSalvar) await aoSalvar();
      janela.close();
    },
  });

  function pintarConta() {
    const conta = app.contas[el('conta').value];
    const especie = conta?.tipo === 'especie';
    el('rotulo').textContent = especie ? 'quanto tem de verdade' : 'saldo que o banco mostra hoje';
    el('no-app').textContent = conta
      ? `No app: ${formatar(saldoReal(app, conta.id))}${conta.conferidaEm ? ` · conferida em ${diaCurto(conta.conferidaEm)}` : ''}.`
      : '';
    janela.dataset.area = areaDaConta(conta) || 'caixa';
    el('resultado').hidden = true;
  }

  async function abrir(contaId = null) {
    app = await estado.calcular();
    ajuste = null;
    titulo.textContent = 'Conferir saldo';
    el('conferir').hidden = false;
    el('ajuste').hidden = true;
    const contas = conferiveis();
    el('conta').innerHTML = opcoesDeConta(contas, contaId ?? contas[0]?.id);
    el('saldo').value = '';
    pintarConta();
    janela.showModal();
    el('saldo').focus();
  }

  /** O ajuste lançado: dá pra ver o que é e apagar, nada mais. */
  async function mostrarAjuste(l) {
    app = await estado.calcular();
    ajuste = l;
    const conta = app.contas[l.contaId ?? l.contaDestinoId];
    titulo.textContent = 'Ajuste de caixa';
    el('conferir').hidden = true;
    el('ajuste').hidden = false;
    el('sobre-ajuste').textContent = `${l.contaId ? '−' : '+'}${formatar(l.valor)} em ${conta?.nome ?? ''}, no dia ${diaCurto(l.dataCaixa)}: a diferença entre o que o app dizia e o que havia de verdade. Fica fora dos relatórios de gasto.`;
    perigo.mostrar(true);
    janela.dataset.area = areaDaConta(conta) || 'caixa';
    janela.showModal();
  }

  async function conferir() {
    const conta = app.contas[el('conta').value];
    if (!conta) return;
    const texto = el('saldo').value.trim();
    if (!texto) return;
    const informado = deTexto(texto);
    const noApp = saldoReal(app, conta.id);
    const diferenca = informado - noApp;
    const dia = hoje();

    if (diferenca === 0) {
      await estado.aplicarEvento('conta.conferida', { id: conta.id, data: dia, saldoInformado: informado, bateu: true });
      return mostrarResultado(`<p class="bateu">Bateu. ${escapar(conta.nome)} conferida hoje.</p>`, true);
    }

    if (conta.tipo === 'especie') {
      const ap = await log.aparelho();
      await estado.aplicarEvento('lancamento.registrado', {
        id: novoId('lan'),
        tipo: 'ajuste_caixa',
        valor: Math.abs(diferenca),
        // Faltou dinheiro: sai da carteira. Sobrou: entra nela.
        contaId: diferenca < 0 ? conta.id : null,
        contaDestinoId: diferenca > 0 ? conta.id : null,
        categoriaId: null,
        dataCompetencia: dia,
        dataCaixa: dia,
        confirmado: true,
        lancadoPor: ap?.id ?? null,
      });
      await estado.aplicarEvento('conta.conferida', { id: conta.id, data: dia, saldoInformado: informado, bateu: true });
      return mostrarResultado(
        `<p class="bateu">Ajuste de ${escapar(formatar(diferenca, { comSinal: true }))} lançado em ${escapar(conta.nome)}. O furo fica visível, fora dos relatórios de gasto.</p>`,
        true
      );
    }

    await estado.aplicarEvento('conta.conferida', { id: conta.id, data: dia, saldoInformado: informado, bateu: false });
    mostrarResultado(diferencaHTML(conta, diferenca), false);
  }

  /** Não bateu: a diferença e o que pode explicá-la. O app não corrige sozinho. */
  function diferencaHTML(conta, diferenca) {
    const daConta = visiveis(app).filter((l) => l.contaId === conta.id || l.contaDestinoId === conta.id);
    const vencidos = daConta.filter((l) => !l.confirmado && l.dataCaixa <= hoje());
    const vistos = new Map();
    const duplicadas = [];
    for (const l of daConta) {
      const chave = [l.tipo, l.valor, l.dataCaixa, l.categoriaId, l.contaId, l.contaDestinoId].join('|');
      if (vistos.has(chave)) duplicadas.push(l);
      else vistos.set(chave, l);
    }
    const linha = (l) =>
      `<li>${diaCurto(l.dataCaixa)} · ${escapar(nomeDaCategoria(app, l.categoriaId) || 'transferência')} · ${escapar(formatar(l.valor))}</li>`;
    return `
      <p class="nao-bateu">O banco tem ${escapar(formatar(Math.abs(diferenca)))} ${diferenca > 0 ? 'a mais' : 'a menos'} que o app.</p>
      ${vencidos.length ? `<p class="miudo">vencidos sem confirmar — pagaram?</p><ul>${vencidos.map(linha).join('')}</ul>` : ''}
      ${duplicadas.length ? `<p class="miudo">possíveis duplicados</p><ul>${duplicadas.map(linha).join('')}</ul>` : ''}
      <p class="nota">${vencidos.length || duplicadas.length ? 'Se nada disso explica, ' : 'Nenhum candidato no app: '}falta lançar algo, ou o saldo inicial da conta está errado — ele se corrige na <a href="bancada.html#contas">bancada</a>.</p>`;
  }

  async function mostrarResultado(html, fechaDepois) {
    el('resultado').innerHTML = html;
    el('resultado').hidden = false;
    if (aoSalvar) await aoSalvar();
    app = await estado.calcular();
    if (fechaDepois) setTimeout(() => janela.open && janela.close(), 2200);
  }

  el('conta').addEventListener('change', pintarConta);
  el('b-conferir').addEventListener('click', conferir);
  el('saldo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); conferir(); }
  });

  return { abrir, mostrarAjuste };
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
