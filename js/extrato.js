// Extrato — R1. A base de tudo: lista única do que aconteceu.
// Lista, saldos, o diálogo de captura do PC e a correção pela própria linha.

import * as estado from './core/estado.js';
import { dinheiroHTML } from './app/dinheiro-html.js';
import { criarFormulario } from './app/formulario.js';
import { criarTransferencia } from './app/transferencia.js';
import { instalarServiceWorker } from './app/instalar.js';
import { iniciarSincronia } from './app/sincronia-viva.js';
import {
  visiveis, porDataDecrescente, estadoDoLancamento, saldoReal, nomeDaCategoria,
} from './core/lancamentos.js';

const $ = (id) => document.getElementById(id);

const NOME_DO_TIPO = {
  corrente: 'corrente',
  cartao: 'cartão',
  especie: 'espécie',
  investimento: 'investimento',
  divida: 'dívida',
  folha: 'folha',
};

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function pintar() {
  const app = await estado.calcular();

  const contas = Object.values(app.contas).filter((c) => !c.arquivada);
  $('saldos').innerHTML = contas.length
    ? contas
        .map((c) => {
          const saldo = saldoReal(app, c.id);
          // Vermelho onde ele informa: saldo negativo, fatura em aberto, dívida
          // (09-identidade §3). Nunca em toda despesa, que apagaria o sinal.
          return `<div class="saldo">
            <span class="miudo">${escapar(c.nome)}</span>
            <span class="quantia ${saldo < 0 ? 'negativo' : ''}">${dinheiroHTML(saldo)}</span>
            <span class="tipo">${escapar(NOME_DO_TIPO[c.tipo] ?? c.tipo)}</span>
          </div>`;
        })
        .join('')
    : '<p class="vazio">Nenhuma conta. Crie na bancada.</p>';

  const lancamentos = visiveis(app).sort(porDataDecrescente);
  $('lista').innerHTML = lancamentos.length
    ? lancamentos
        .map((l) => {
          const est = estadoDoLancamento(l);
          const conta = app.contas[l.contaId];
          const entrada = l.tipo === 'receita';
          const transferencia = l.tipo === 'transferencia';

          // Tipo tem código próprio: marca, cor e sinal (09-identidade §3).
          // A marca vem antes da cor — é ela que carrega o sentido em preto e
          // branco e pra quem não distingue vermelho de verde.
          const tom = transferencia ? 'transferencia' : entrada ? 'receita' : 'despesa';
          const marca = transferencia ? '→' : entrada ? '↑' : '↓';
          const sinal = transferencia ? '' : entrada ? '+' : '−';
          const nomeDoTom = transferencia ? 'Transferência' : entrada ? 'Receita' : 'Despesa';

          // Uma ação da vida real é UMA linha (08-telas §4): a transferência
          // aparece como origem → destino, nunca como despesa numa conta mais
          // receita na outra — duas linhas dobrariam o gasto do mês.
          const destino = app.contas[l.contaDestinoId];
          const oque = transferencia ? 'Transferência' : nomeDaCategoria(app, l.categoriaId) || l.tipo;
          const onde = transferencia
            ? `${conta?.nome ?? '—'} → ${destino?.nome ?? '—'}`
            : conta?.nome ?? '—';

          const etiquetas = (l.etiquetas ?? [])
            .map((t) => app.etiquetas?.[t]?.nome)
            .filter(Boolean);

          // A linha inteira é o botão de corrigir: no celular o alvo é o dedo,
          // e no PC o teclado chega nela sem mouse.
          return `<li><button type="button" class="linha ${tom} ${est === 'realizado' ? '' : est}"
              data-lanc="${escapar(l.id)}" data-tipo="${escapar(l.tipo)}"
              aria-label="Corrigir ${nomeDoTom.toLowerCase()} de ${escapar(l.dataCaixa)}">
            <span class="marca" title="${nomeDoTom}" aria-hidden="true">${marca}</span>
            <span class="quando">${escapar(l.dataCaixa.slice(8))}/${escapar(l.dataCaixa.slice(5, 7))}</span>
            <span class="oque">
              <span class="cat">${escapar(oque)}${etiquetas.length ? etiquetas.map((e) => `<span class="etiqueta">${escapar(e)}</span>`).join('') : ''}</span>
              <span class="onde">${escapar(onde)}${est === 'realizado' ? '' : ' · ' + est}</span>
            </span>
            <span class="quanto ${tom}">${dinheiroHTML(l.valor, { sinal })}</span>
          </button></li>`;
        })
        .join('')
    : '<li class="vazio">Nada lançado ainda.</li>';
}

// ── o diálogo ──────────────────────────────────────────────────────────────

const dialogo = $('dialogo');

const formulario = await criarFormulario({
  raiz: $('formulario'),
  acoes: [
    { id: 'nova', rotulo: 'Salvar e nova', principal: true, fecha: false },
    { id: 'fechar', rotulo: 'Salvar e fechar', fecha: true },
  ],
  aoSalvar: pintar,
  aoFechar: () => dialogo.close(),
});

// Corrigir e apagar são do andar de cima, nunca do térreo (D11) — então vivem
// aqui, no extrato, e não na captura. O formulário é o mesmo (design/03 §9).
const dialogoEdicao = $('dialogo-edicao');

const edicao = await criarFormulario({
  raiz: $('formulario-edicao'),
  acoes: [{ id: 'salvar', rotulo: 'Salvar', principal: true, fecha: true }],
  aoSalvar: pintar,
  aoFechar: () => dialogoEdicao.close(),
});

// Transferir é outro formulário, porque é outra pergunta: de onde sai, pra onde
// vai e quanto — sem categoria (design/03 §3.1).
const dialogoTransferencia = $('dialogo-transferencia');

const transferencia = await criarTransferencia({
  raiz: $('formulario-transferencia'),
  aoSalvar: pintar,
  aoFechar: () => dialogoTransferencia.close(),
});

$('lista').addEventListener('click', async (e) => {
  const linha = e.target.closest('[data-lanc]');
  if (!linha) return;
  const app = await estado.calcular();
  const l = app.lancamentos[linha.dataset.lanc];
  if (!l || l.removido) return;

  // Cada tipo volta pro formulário que sabe falar dele.
  if (l.tipo === 'transferencia') {
    await transferencia.carregar(l);
    dialogoTransferencia.showModal();
    return;
  }
  await edicao.carregar(l);
  dialogoEdicao.showModal();
});

function abrirTransferencia() {
  transferencia.limpar();
  transferencia.recarregar();
  dialogoTransferencia.showModal();
  transferencia.focar();
}

$('b-transferir').addEventListener('click', abrirTransferencia);
$('b-fechar-edicao').addEventListener('click', () => dialogoEdicao.close());
$('b-fechar-transferencia').addEventListener('click', () => dialogoTransferencia.close());

function abrir() {
  formulario.limpar();
  formulario.recarregar();
  dialogo.showModal();
  formulario.focar();
}

$('b-novo').addEventListener('click', abrir);
$('b-fechar').addEventListener('click', () => dialogo.close());

// Atalho global: lançar sem tirar a mão do teclado é o ponto do PC.
document.addEventListener('keydown', (e) => {
  if (dialogo.open || dialogoEdicao.open || dialogoTransferencia.open) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // O alvo pode ser o próprio document (que não tem `matches`), então a
  // verificação precisa ser à prova disso antes de perguntar o que ele é.
  const alvo = e.target;
  if (alvo instanceof Element && alvo.closest('input, textarea, [contenteditable]')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); abrir(); }
  if (e.key === 't' || e.key === 'T') { e.preventDefault(); abrirTransferencia(); }
});

await pintar();
instalarServiceWorker();

// Sincroniza ao abrir e a cada alteração, em segundo plano (design/06 §3).
await iniciarSincronia({ raiz: $('nuvem') });
estado.aoAplicar(() => pintar());
