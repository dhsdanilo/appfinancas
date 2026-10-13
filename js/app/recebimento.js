// "Lançar recebimento" — numa conta de folha de recebimentos avulsos (autônomo).
// Os lançamentos (entradas e descontos) se cadastram na folha como qualquer
// outro, em lotes, quando convém; o recebimento é só o que leva o dinheiro da
// folha para a conta que o recebe: uma transferência, por padrão do que está
// na folha agora.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { deTexto, formatar } from '../core/dinheiro.js';
import { umaVez } from './uma-vez.js';
import { hoje } from '../core/datas.js';
import { saldoReal } from '../core/lancamentos.js';
import { opcoesDeConta } from './areas.js';

const MARCACAO = `
  <p class="nota" data-papel="cabeca"></p>
  <label class="campo-simples"><span class="miudo">dia</span>
    <input type="date" data-papel="data" aria-label="Dia do recebimento"></label>
  <label class="campo-simples"><span class="miudo">valor</span>
    <input type="text" inputmode="decimal" data-papel="valor" autocomplete="off" placeholder="0,00" aria-label="Valor a receber"></label>
  <div class="liquido-holerite">
    <span>→ para</span>
    <select data-papel="destino" aria-label="Conta que recebe"></select>
    <strong data-papel="na-folha"></strong>
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
  let naFolha = 0;

  const recadar = (t) => { el('recado').textContent = t; el('recado').hidden = !t; };

  async function abrir(folhaId) {
    app = await estado.calcular();
    folha = app.contas[folhaId];
    if (!folha) return;
    naFolha = saldoReal(app, folha.id);
    el('cabeca').innerHTML = `<strong>${esc(folha.nome)}</strong> · leva o dinheiro da folha para a conta que recebe. As entradas e os descontos se lançam na folha, como qualquer lançamento.`;
    el('data').value = hoje();
    el('valor').value = naFolha > 0 ? formatar(naFolha, { comPrefixo: false }) : '';
    el('na-folha').textContent = `na folha ${formatar(naFolha)}`;
    const caixa = Object.values(app.contas).filter((c) => !c.arquivada && (c.tipo === 'corrente' || c.tipo === 'especie'));
    el('destino').innerHTML = opcoesDeConta(caixa, folha.liquidoPara ?? caixa[0]?.id);
    recadar('');
    janela.dataset.area = 'folha';
    janela.showModal();
    el('valor').focus();
  }

  const lancar = umaVez(lancarAgora);

  async function lancarAgora() {
    const data = el('data').value;
    const valor = Math.abs(deTexto(el('valor').value));
    const destino = el('destino').value;
    if (!data) return recadar('Falta o dia.');
    if (!valor) return recadar('Digite o valor.');
    if (!destino) return recadar('Escolha a conta que recebe.');
    if (valor > naFolha) return recadar(`Há ${formatar(Math.max(0, naFolha))} na folha: lance antes as entradas que faltam.`);

    const ap = await log.aparelho();
    await estado.aplicarEvento('lancamento.registrado', {
      id: novoId('lan'), contaId: folha.id, tipo: 'transferencia', valor, contaDestinoId: destino, categoriaId: null,
      dataCompetencia: data, dataCaixa: data, confirmado: data <= hoje(), lancadoPor: ap?.id ?? null,
    });
    if (destino !== folha.liquidoPara) await estado.aplicarEvento('conta.alterada', { id: folha.id, liquidoPara: destino });
    if (aoSalvar) await aoSalvar();
    janela.close();
  }

  el('b-lancar').addEventListener('click', lancar);
  el('b-voltar').addEventListener('click', () => janela.close());
  el('valor').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lancar(); } });

  return { abrir };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
