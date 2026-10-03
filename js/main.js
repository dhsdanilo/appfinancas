// Página de verificação: ferramenta de obra, não tela do app.
//
// Mostra o que a fundação está fazendo, roda a suíte em banco separado e deixa
// recalcular o estado do zero — que é o teste que importa nesta arquitetura.
// Quem cria contas, categorias e etiquetas é a bancada (js/bancada.js).

import * as db from './core/db.js';
import * as log from './core/log.js';
import * as estado from './core/estado.js';
import { VERSAO_ATUAL, ErroDeFormato } from './core/formato.js';
import { formatar } from './core/dinheiro.js';
import { instalarServiceWorker } from './app/instalar.js';
import { iniciarSincronia } from './app/sincronia-viva.js';

const $ = (id) => document.getElementById(id);

async function pintar() {
  const ap = await log.aparelho();
  const e = await estado.calcular();

  $('f-formato').textContent = `versão ${VERSAO_ATUAL}`;
  $('f-aparelho').textContent = ap ? `${ap.nome}  (${ap.id})` : 'não registrado — registre na bancada';
  $('f-eventos').textContent = String(await log.contar());
  $('f-lc').textContent = String(e.ateLc);
  $('f-banco').textContent = db.bancoEmUso();
  $('f-lancamentos').textContent = String(Object.keys(e.lancamentos || {}).length);

  const desconhecidos = Object.entries(e.desconhecidos || {});
  $('f-desconhecidos').textContent = desconhecidos.length
    ? desconhecidos.map(([t, n]) => `${t} ×${n}`).join(', ')
    : 'nenhum';

  pintarEstado(e);
  await pintarEventos();
}

function pintarEstado(e) {
  const partes = [];

  const lista = (titulo, itens) => {
    partes.push(`<h3>${titulo}</h3>`);
    partes.push(
      itens.length
        ? `<ul>${itens.join('')}</ul>`
        : '<p class="vazio">Nenhuma ainda.</p>'
    );
  };

  lista('Pessoas', Object.values(e.pessoas).map((p) => `<li>${escapar(p.nome)}</li>`));

  lista(
    'Contas',
    Object.values(e.contas).map((c) => {
      const saldo = c.saldoInicial ? ` · inicial ${formatar(c.saldoInicial)}` : '';
      const arq = c.arquivada ? ' · arquivada' : '';
      return `<li class="${c.arquivada ? 'arquivada' : ''}">${escapar(c.nome)} <em>(${escapar(c.tipo)})</em>${saldo}${arq}</li>`;
    })
  );

  lista(
    'Categorias',
    Object.values(e.categorias).map(
      (c) => `<li class="${c.arquivada ? 'arquivada' : ''}">${escapar(c.nome)} <em>(${escapar(c.natureza ?? 'despesa')})</em></li>`
    )
  );

  lista(
    'Etiquetas',
    Object.values(e.etiquetas ?? {}).map(
      (t) => `<li class="${t.arquivada ? 'arquivada' : ''}">${escapar(t.nome)}</li>`
    )
  );

  $('estado-atual').innerHTML = partes.join('');
}

async function pintarEventos() {
  const eventos = await log.ler();
  const ultimos = eventos.slice(-12).reverse();
  $('eventos').innerHTML = ultimos.length
    ? ultimos
        .map((ev) => `<li>lc ${ev.lc} · ${escapar(ev.ap)} · <strong>${escapar(ev.tipo)}</strong> · ${escapar(resumir(ev.dados))}</li>`)
        .join('')
    : '<li class="vazio">Nada registrado ainda.</li>';
}

function resumir(dados) {
  if (!dados) return '';
  const texto = Object.entries(dados)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return texto.length > 90 ? texto.slice(0, 90) + '…' : texto;
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function avisar(mensagem) {
  const el = $('aviso');
  el.textContent = mensagem;
  el.hidden = !mensagem;
}

// ── ações ─────────────────────────────────────────────────────────────────

$('b-recalcular').addEventListener('click', async () => {
  const antes = JSON.stringify(semVolateis(await estado.calcular()));
  const depois = JSON.stringify(semVolateis(await estado.recalcular()));
  await pintar();
  avisar(
    antes === depois
      ? 'Recalculado do zero: resultado idêntico ao do cache. É o que tem de acontecer.'
      : 'ATENÇÃO: o recálculo deu resultado DIFERENTE do cache. Isso é um defeito grave.'
  );
});

$('b-zerar').addEventListener('click', async () => {
  if (!confirm('Apaga todos os eventos e o aparelho registrado. Confirma?')) return;
  await db.apagarTudo();
  estado.invalidarMemoria();
  await pintar();
  avisar('');
});

$('b-verificar').addEventListener('click', async () => {
  const botao = $('b-verificar');
  const placar = $('placar');
  const lista = $('resultados');

  botao.disabled = true;
  lista.innerHTML = '';
  placar.className = 'placar';
  placar.textContent = 'rodando…';

  const { rodar, quantidadeDeCasos } = await import('./dev/verificacao.js');

  const { resultados, total, passaram } = await rodar({
    aoAndar: (r, feitos) => {
      placar.textContent = `${feitos}/${quantidadeDeCasos}…`;
      lista.insertAdjacentHTML('beforeend', linhaDeResultado(r));
    },
  });
  void resultados;

  placar.className = 'placar ' + (passaram === total ? 'ok' : 'falhou');
  placar.textContent =
    passaram === total
      ? `${passaram} de ${total} passaram.`
      : `${total - passaram} de ${total} FALHARAM.`;

  botao.disabled = false;
  await pintar();
});

function linhaDeResultado(r) {
  const classe = r.passou ? 'passou' : 'falhou';
  const erro = r.passou ? '' : `<pre>${escapar(r.erro)}</pre>`;
  return `<li class="${classe}"><span class="grupo">${escapar(r.grupo)}</span> — ${escapar(r.nome)}${erro}</li>`;
}

function semVolateis(e) {
  const { aplicados, ...resto } = e;
  void aplicados;
  return resto;
}

// ── partida ───────────────────────────────────────────────────────────────

try {
  await pintar();
} catch (e) {
  if (e instanceof ErroDeFormato) {
    avisar(`Este app está desatualizado para os dados que encontrou. ${e.message}`);
  } else {
    avisar(`Falha ao abrir: ${e.name}: ${e.message}`);
    throw e;
  }
}

instalarServiceWorker();
await iniciarSincronia({ raiz: $('nuvem') });
