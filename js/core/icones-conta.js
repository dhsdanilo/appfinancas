// O ícone de cada conta: um desenho da lista pequena ("i:cofre") ou a marca de um
// banco conhecido ("b:sicredi"). Sem escolha, vale a inicial com a cor do nome
// (js/core/ordem.js). Tudo é desenhado aqui, sem arquivo externo: funciona offline.
//
// ATENÇÃO: este é o ÚNICO arquivo que cita nomes de banco, de propósito (é um catálogo
// de marcas conhecidas, igual para todo mundo). O grep de segurança do commit o ignora.

import { iniciaisDaConta, corDaConta } from './ordem.js';

const SVG = (caminho) =>
  `<svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminho}</svg>`;

/** Os desenhos genéricos: id → [nome na lista, traço]. */
export const DESENHOS = {
  banco: ['Banco', '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'],
  carteira: ['Carteira', '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 7l11-3v3M16 14h2"/>'],
  cartao: ['Cartão', '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>'],
  cofrinho: ['Cofrinho', '<path d="M5 12a7 6 0 0 1 12-4h2v4l-1 3v3h-3v-2H9v2H6v-3a6 6 0 0 1-1-3z"/><path d="M13 5.5a2 2 0 0 0-3 0M15 12h.01"/>'],
  grafico: ['Investimento', '<path d="M4 19V5M4 19h16"/><path d="M8 15l3-4 3 2 4-6"/>'],
  casa: ['Casa', '<path d="M4 11 12 4l8 7M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>'],
  carro: ['Carro', '<path d="M5 16V12l2-5h10l2 5v4M3 16h18M7 16v2M17 16v2"/><path d="M7.5 12h9"/>'],
  moedas: ['Dinheiro', '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.6-.8-1.5-1-2.5-1-1.4 0-2.3.7-2.3 1.7 0 2.4 5 1 5 3.4 0 1-1 1.7-2.5 1.7-1 0-2-.3-2.6-1.1M12 6.5v11"/>'],
  escudo: ['Reserva', '<path d="M12 4l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z"/>'],
  familia: ['Família', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15 15.5a4.2 4.2 0 0 1 5.5 3.5"/>'],
  aviao: ['Viagem', '<path d="M3 13l18-8-6 15-3-6z"/><path d="M12 14l-1 5"/>'],
  estrela: ['Favorita', '<path d="M12 4l2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 7 19l1.1-5.5L4 9.7 9.6 9z"/>'],
};

/** As marcas conhecidas: id → [nome, cor de fundo, cor da letra, letras]. Desenho nosso, não o logotipo. */
export const BANCOS = {
  bb: ['Banco do Brasil', '#FCEB00', '#0B3C8C', 'BB'],
  caixa: ['Caixa', '#0F6DB5', '#FFFFFF', 'CX'],
  bradesco: ['Bradesco', '#CC092F', '#FFFFFF', 'Br'],
  itau: ['Itaú', '#EC7000', '#FFFFFF', 'It'],
  santander: ['Santander', '#EC0000', '#FFFFFF', 'S'],
  nubank: ['Nubank', '#820AD1', '#FFFFFF', 'Nu'],
  inter: ['Inter', '#FF7A00', '#FFFFFF', 'In'],
  c6: ['C6 Bank', '#242424', '#FFFFFF', 'C6'],
  btg: ['BTG Pactual', '#001E62', '#FFFFFF', 'BTG'],
  xp: ['XP', '#1B1B1B', '#FFD400', 'XP'],
  sicredi: ['Sicredi', '#3FA110', '#FFFFFF', 'Sc'],
  sicoob: ['Sicoob', '#00545F', '#FFFFFF', 'So'],
  banrisul: ['Banrisul', '#004B93', '#FFFFFF', 'Br'],
  picpay: ['PicPay', '#11C76F', '#FFFFFF', 'Pp'],
  mercadopago: ['Mercado Pago', '#009EE3', '#FFFFFF', 'MP'],
  neon: ['Neon', '#0DC2C2', '#FFFFFF', 'Ne'],
  pagbank: ['PagBank', '#41B26B', '#FFFFFF', 'Pg'],
  safra: ['Safra', '#0B2A5B', '#FFFFFF', 'Sf'],
};

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** O que mostrar dentro da bolinha: { fundo, cor, html } para um código de ícone ("i:banco", "b:itau"). */
export function marcaDoIcone(codigo, nome) {
  const [tipo, id] = String(codigo ?? '').split(':');
  if (tipo === 'i' && DESENHOS[id]) return { fundo: corDaConta(nome), cor: '#fff', html: SVG(DESENHOS[id][1]) };
  if (tipo === 'b' && BANCOS[id]) {
    const [, fundo, cor, letras] = BANCOS[id];
    return { fundo, cor, html: esc(letras) };
  }
  return { fundo: corDaConta(nome), cor: '#fff', html: esc(iniciaisDaConta(nome)) };
}

/** A bolinha pronta (`<span class="ic">`) de uma conta. */
export function bolinhaDaConta(conta) {
  const m = marcaDoIcone(conta.icone, conta.nome);
  return `<span class="ic" style="background:${m.fundo};color:${m.cor}">${m.html}</span>`;
}

/** As escolhas do "editar conta": a inicial, os desenhos e os bancos. */
export function escolhasDeIcone(nome) {
  const um = (codigo, rotulo) => {
    const m = marcaDoIcone(codigo, nome);
    return `<button type="button" class="escolha-icone" data-icone="${esc(codigo)}" title="${esc(rotulo)}" aria-label="${esc(rotulo)}" aria-pressed="false"><span class="ic" style="background:${m.fundo};color:${m.cor}">${m.html}</span></button>`;
  };
  return {
    inicial: um('', 'Inicial do nome'),
    desenhos: Object.entries(DESENHOS).map(([id, d]) => um(`i:${id}`, d[0])).join(''),
    bancos: Object.entries(BANCOS).map(([id, b]) => um(`b:${id}`, b[0])).join(''),
  };
}
