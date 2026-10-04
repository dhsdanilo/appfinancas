// A janela de importar extrato e fatura (design/13 §3): escolher o arquivo,
// revisar linha por linha, e só então gravar. O arquivo é lido aqui mesmo —
// nada sai do aparelho.

import * as estado from '../core/estado.js';
import * as log from '../core/log.js';
import { novoId } from '../core/id.js';
import { formatar } from '../core/dinheiro.js';
import { diaCurto } from '../core/datas.js';
import { tipoDaTransferencia, nomeDaCategoria } from '../core/lancamentos.js';
import { saldoAte } from '../core/investimentos.js';
import { faturas } from '../core/previsto.js';
import {
  decodificar, lerOFX, lerCSV, linhasDoCSV, casar, chave, idDaRegra, deslocamentoParaFatura,
} from '../core/importar.js';
import { categoriaNaArea } from './areas.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const comSinal = (v) => `${v < 0 ? '−' : '+'}${formatar(Math.abs(v))}`;

const MARCACAO = `
<dialog id="dialogo-importar" class="dialogo-captura dialogo-importar" aria-labelledby="titulo-importar">
  <div class="cabecalho-dialogo">
    <strong id="titulo-importar">Importar extrato ou fatura</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples">
    <p class="nota">Baixe o extrato (ou a fatura) no app do banco, em <strong>OFX</strong> — ou CSV — e escolha aqui. O arquivo é lido neste aparelho e não vai para lugar nenhum.</p>
    <div class="linha-operacao">
      <label class="campo-simples"><span class="miudo">arquivo</span>
        <input type="file" data-imp="arquivo" accept=".ofx,.qfx,.csv,.txt"></label>
      <label class="campo-simples"><span class="miudo">conta</span>
        <select data-imp="conta"></select></label>
      <label class="campo-simples" data-imp="campo-fatura" hidden><span class="miudo">fatura</span>
        <select data-imp="fatura"></select></label>
    </div>
    <p class="nota" data-imp="lido"></p>
    <div data-imp="colunas" hidden></div>
    <div data-imp="revisao"></div>
    <p class="recado" data-imp="recado" hidden></p>
    <div class="acoes" data-imp="acoes" hidden><button type="button" class="principal" data-imp="b-importar">Importar</button></div>
    <div data-imp="resultado" hidden></div>
  </div>
</dialog>`;

let janela = null;
const repintar = new Set();

export function criarImportacao({ aoSalvar } = {}) {
  if (aoSalvar) repintar.add(aoSalvar);
  if (janela) return janela;
  document.body.insertAdjacentHTML('beforeend', MARCACAO);
  const dlg = document.getElementById('dialogo-importar');
  const el = (p) => dlg.querySelector(`[data-imp="${p}"]`);
  dlg.querySelector('[data-fechar]').addEventListener('click', () => dlg.close());
  const recado = (t) => { el('recado').textContent = t; el('recado').hidden = !t; };

  let app = null;
  let arquivo = null;   // o que se leu: { formato, tipo, conta, linhas | csv, saldo }
  let csvMapa = null;
  let inverter = false;
  let decididas = [];   // as linhas, casadas, com a ação escolhida

  const contaAtual = () => app.contas[el('conta').value];
  const ehCartao = () => contaAtual()?.tipo === 'cartao';

  function linhasDoArquivo() {
    if (!arquivo) return [];
    return arquivo.formato === 'csv' ? linhasDoCSV(arquivo, csvMapa, { inverter }) : arquivo.linhas;
  }

  // ── conta e fatura ──────────────────────────────────────────────────────

  function pintarContas(preferida) {
    const contas = Object.values(app.contas)
      .filter((c) => !c.arquivada && ['corrente', 'especie', 'cartao'].includes(c.tipo))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const doArquivo = arquivo?.conta?.numero ? contas.find((c) => c.importId === arquivo.conta.numero) : null;
    const escolhida = doArquivo?.id ?? preferida ?? el('conta').value ?? contas[0]?.id;
    el('conta').innerHTML = contas.map((c) => `<option value="${esc(c.id)}"${c.id === escolhida ? ' selected' : ''}>${esc(c.nome)}${c.tipo === 'cartao' ? ' (cartão)' : ''}</option>`).join('');
  }

  function pintarFaturas() {
    el('campo-fatura').hidden = !ehCartao();
    if (!ehCartao()) return;
    const lista = faturas(app, contaAtual().id) ?? [];
    const linhas = linhasDoArquivo();
    // A fatura do arquivo: a primeira que fecha depois da compra mais nova dele.
    const maisNova = linhas.reduce((m, l) => (l.data > m ? l.data : m), '');
    const sugerida = lista.find((f) => f.fechamento >= maisNova) ?? lista[lista.length - 1];
    const antes = el('fatura').value;
    el('fatura').innerHTML = lista.map((f) => `<option value="${esc(f.fechamento)}">vence ${diaCurto(f.vencimento)}/${f.vencimento.slice(0, 4)} · fecha ${diaCurto(f.fechamento)}</option>`).join('');
    el('fatura').value = lista.some((f) => f.fechamento === antes) ? antes : sugerida?.fechamento ?? '';
  }

  // ── colunas do CSV ──────────────────────────────────────────────────────

  function pintarColunas() {
    const csv = arquivo?.formato === 'csv';
    el('colunas').hidden = !csv;
    if (!csv) return;
    const op = (campo, rotulo) => `<label class="campo-simples"><span class="miudo">${rotulo}</span>
      <select data-coluna="${campo}"><option value="-1">—</option>${arquivo.cabecalho.map((c, i) =>
        `<option value="${i}"${csvMapa[campo] === i ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`;
    el('colunas').innerHTML = `<p class="miudo titulo-linhas">colunas do arquivo · confira</p>
      <div class="linha-operacao">${op('data', 'data')}${op('texto', 'descrição')}${op('valor', 'valor')}${op('debito', 'débito')}${op('credito', 'crédito')}</div>
      <label class="cai-sozinha"><input type="checkbox" data-imp="inverter"${inverter ? ' checked' : ''}> <span>o arquivo traz as saídas (compras) como valores positivos — inverter</span></label>`;
  }

  // ── revisão ─────────────────────────────────────────────────────────────

  function decidir() {
    const linhas = linhasDoArquivo();
    const fatura = ehCartao() ? el('fatura').value || null : null;
    decididas = casar(app, contaAtual().id, linhas, { fatura }).map((x) => ({ ...x, acao: { ...x.sugestao } }));
  }

  function opcoesDeCategoria(tipo, escolhida) {
    const natureza = tipo === 'receita' ? 'receita' : 'despesa';
    const conta = contaAtual();
    const cats = Object.values(app.categorias)
      .filter((c) => !c.arquivada && (c.natureza ?? 'despesa') === natureza && categoriaNaArea(c, conta))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return `<option value="">escolha a categoria</option>${cats.map((c) => `<option value="${esc(c.id)}"${c.id === escolhida ? ' selected' : ''}>${esc(nomeDaCategoria(app, c.id))}</option>`).join('')}`;
  }

  function opcoesDeConta(escolhida) {
    return `<option value="">de/para qual conta?</option>${Object.values(app.contas)
      .filter((c) => !c.arquivada && c.id !== contaAtual().id)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((c) => `<option value="${esc(c.id)}"${c.id === escolhida ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}`;
  }

  function linhaNova(x, i) {
    const cartao = ehCartao();
    const tipos = cartao
      ? [['despesa', 'compra'], ['estorno', 'devolução'], ['transferencia', 'pagamento da fatura'], ['ignorar', 'ignorar']]
      : [['despesa', 'despesa'], ['receita', 'receita'], ['transferencia', 'transferência'], ['ignorar', 'ignorar']];
    const a = x.acao;
    const segundo = a.tipo === 'transferencia'
      ? `<select data-i="${i}" data-campo="contaOutra">${opcoesDeConta(a.contaOutra ?? (cartao ? contaAtual().pagaCom : null))}</select>`
      : a.tipo === 'ignorar' ? '<span></span>'
        : `<select data-i="${i}" data-campo="categoriaId">${opcoesDeCategoria(a.tipo === 'estorno' ? 'despesa' : a.tipo, a.categoriaId)}</select>`;
    const falta = (a.tipo === 'despesa' || a.tipo === 'receita' || a.tipo === 'estorno') && !a.categoriaId;
    return `<li class="linha-imp ${falta ? 'falta' : ''}">
      <span class="quando">${diaCurto(x.data)}</span>
      <span class="texto-imp">${esc(x.texto || '—')}${x.sugestao.regraId && a.categoriaId === x.sugestao.categoriaId ? '<span class="fino">pela regra</span>' : ''}</span>
      <span class="valor-imp ${x.valor < 0 ? 'sai' : 'entra'}">${comSinal(x.valor)}</span>
      <select data-i="${i}" data-campo="tipo">${tipos.map(([v, r]) => `<option value="${v}"${v === a.tipo ? ' selected' : ''}>${r}</option>`).join('')}</select>
      ${segundo}
    </li>`;
  }

  function linhaCasada(x) {
    const l = x.lancamento ?? x.ocorrencia;
    const como = x.situacao === 'importada' ? 'já importada' : x.situacao === 'ignorada' ? 'ignorada antes'
      : x.situacao === 'prevista' ? 'a prevista vira lançada' : l?.automatico ? 'a parcela automática' : 'já lançada';
    const nome = l ? app.detalhes?.[l.detalheId]?.nome ?? nomeDaCategoria(app, l.categoriaId) ?? app.contas[l.contaDestinoId]?.nome ?? l.tipo : '';
    return `<li class="linha-imp casada"><span class="quando">${diaCurto(x.data)}</span>
      <span class="texto-imp">${esc(x.texto || '—')}${nome ? `<span class="fino">${esc(como)} · ${esc(nome)}${l ? ` · ${diaCurto(l.dataCaixa ?? l.dataCompetencia)}` : ''}</span>` : `<span class="fino">${esc(como)}</span>`}</span>
      <span class="valor-imp ${x.valor < 0 ? 'sai' : 'entra'}">${comSinal(x.valor)}</span><span></span><span></span></li>`;
  }

  function pintarRevisao() {
    const novas = decididas.map((x, i) => ({ x, i })).filter(({ x }) => x.situacao === 'nova');
    const casadas = decididas.filter((x) => x.situacao === 'lancada' || x.situacao === 'prevista');
    const ja = decididas.filter((x) => x.situacao === 'importada' || x.situacao === 'ignorada');
    if (!decididas.length) { el('revisao').innerHTML = '<p class="nota">Nenhum movimento no arquivo.</p>'; el('acoes').hidden = true; return; }
    el('revisao').innerHTML = `<p class="resumo-imp"><strong>${novas.length}</strong> ${novas.length === 1 ? 'nova' : 'novas'} · <strong>${casadas.length}</strong> já no app · <strong>${ja.length}</strong> já importadas</p>
      ${novas.length ? `<p class="miudo titulo-linhas">novas · o que cada uma vira</p><ol class="lista-imp">${novas.map(({ x, i }) => linhaNova(x, i)).join('')}</ol>` : ''}
      ${casadas.length ? `<details class="detalhes-imp"><summary>${casadas.length} já estão no app — não duplicam</summary><ol class="lista-imp">${casadas.map(linhaCasada).join('')}</ol></details>` : ''}
      ${ja.length ? `<details class="detalhes-imp"><summary>${ja.length} já importadas antes</summary><ol class="lista-imp">${ja.map(linhaCasada).join('')}</ol></details>` : ''}`;
    pintarBotao();
  }

  function pintarBotao() {
    const novas = decididas.filter((x) => x.situacao === 'nova');
    const casadas = decididas.filter((x) => x.situacao === 'lancada' || x.situacao === 'prevista');
    const faltam = novas.filter((x) => ['despesa', 'receita', 'estorno'].includes(x.acao.tipo) && !x.acao.categoriaId).length
      + novas.filter((x) => x.acao.tipo === 'transferencia' && !x.acao.contaOutra && !(ehCartao() && contaAtual().pagaCom)).length;
    const gravar = novas.filter((x) => x.acao.tipo !== 'ignorar').length + casadas.length;
    el('acoes').hidden = !decididas.length;
    el('b-importar').disabled = faltam > 0 || !(gravar || novas.length);
    el('b-importar').textContent = gravar ? `Importar ${gravar}` : 'Importar';
    recado(faltam ? `Falta escolher em ${faltam} ${faltam === 1 ? 'linha' : 'linhas'} — ou marque "ignorar".` : '');
  }

  // ── gravar ──────────────────────────────────────────────────────────────

  async function gravar() {
    const conta = contaAtual();
    const cartao = conta.tipo === 'cartao';
    const fatura = cartao ? el('fatura').value || null : null;
    const ap = await log.aparelho();
    let criados = 0;
    let casados = 0;
    const ignorar = [];
    const regras = new Map();

    for (const x of decididas) {
      const textoBanco = x.texto || null;
      if (x.situacao === 'lancada') {
        if (x.lancamento.automatico) { casados += 1; continue; }
        const mudar = { id: x.lancamento.id, fitid: x.fitid, textoBanco };
        // O agendado que o banco mostra como feito: agora é feito, no dia do banco.
        if (!x.lancamento.confirmado) { mudar.confirmado = true; if (!cartao) mudar.dataCaixa = x.data; }
        await estado.aplicarEvento('lancamento.alterado', mudar);
        casados += 1;
        continue;
      }
      if (x.situacao === 'prevista') {
        const o = x.ocorrencia;
        await estado.aplicarEvento('lancamento.registrado', {
          id: novoId('lan'), tipo: o.tipo === 'transferencia' ? tipoDaTransferencia(app, o.contaDestinoId) : o.tipo,
          valor: Math.abs(x.valor), contaId: o.contaId, contaDestinoId: o.contaDestinoId ?? null,
          categoriaId: o.categoriaId ?? null, detalheId: o.detalheId ?? null, etiquetas: o.etiquetas ?? [],
          recorrenciaId: o.recorrenciaId ?? null, parcelaDe: o.parcelaDe ?? null,
          dataCompetencia: cartao ? o.dataCompetencia : x.data, dataCaixa: cartao ? o.dataCompetencia : x.data,
          confirmado: true, fitid: x.fitid, textoBanco, lancadoPor: ap?.id ?? null,
        });
        casados += 1;
        continue;
      }
      if (x.situacao !== 'nova') continue;
      const a = x.acao;
      if (a.tipo === 'ignorar') { ignorar.push(x.fitid); continue; }
      const comum = {
        id: novoId('lan'), valor: Math.abs(x.valor), dataCompetencia: x.data, dataCaixa: x.data,
        confirmado: true, fitid: x.fitid, textoBanco, lancadoPor: ap?.id ?? null,
      };
      if (a.tipo === 'transferencia') {
        const outra = a.contaOutra ?? (cartao ? conta.pagaCom : null);
        const [de, para] = x.valor < 0 ? [conta.id, outra] : [outra, conta.id];
        await estado.aplicarEvento('lancamento.registrado', {
          ...comum, tipo: tipoDaTransferencia(app, para), contaId: de, contaDestinoId: para, categoriaId: null,
        });
        if (!a.pagamento) regras.set(chave(x.texto), { transferePara: outra });
      } else {
        await estado.aplicarEvento('lancamento.registrado', {
          ...comum, tipo: a.tipo, contaId: conta.id, categoriaId: a.categoriaId,
          detalheId: a.detalheId ?? null, etiquetas: a.etiquetas ?? [],
          faturaDesloca: cartao ? deslocamentoParaFatura(conta, x.data, fatura) : 0,
        });
        regras.set(chave(x.texto), { categoriaId: a.categoriaId, detalheId: a.detalheId ?? null, etiquetas: a.etiquetas ?? [] });
      }
      criados += 1;
    }

    if (ignorar.length) await estado.aplicarEvento('importacao.ignorada', { contaId: conta.id, fitids: ignorar });
    // O que você decidiu ensina: a regra do texto passa a ser esta (design/13 §2).
    for (const [padrao, r] of regras) {
      if (!padrao) continue;
      const atual = app.regras?.[idDaRegra(padrao)];
      if (atual && atual.categoriaId === (r.categoriaId ?? null) && atual.transferePara === (r.transferePara ?? null)) continue;
      await estado.aplicarEvento('regra.definida', { id: idDaRegra(padrao), padrao, ...r });
    }
    // O número da conta no arquivo: na próxima, ela já vem escolhida.
    if (arquivo.conta?.numero && conta.importId !== arquivo.conta.numero) {
      await estado.aplicarEvento('conta.alterada', { id: conta.id, importId: arquivo.conta.numero });
    }

    // O saldo do banco no fim do extrato, contra o do app no mesmo dia.
    app = await estado.calcular();
    let saldoHTML = '';
    if (arquivo.saldo && !cartao) {
      const doApp = saldoAte(app, conta.id, arquivo.saldo.data);
      const bateu = doApp === arquivo.saldo.valor;
      if (bateu) await estado.aplicarEvento('conta.conferida', { id: conta.id, data: arquivo.saldo.data, saldoInformado: arquivo.saldo.valor, bateu: true });
      saldoHTML = bateu
        ? `<p class="bateu">Saldo do banco em ${diaCurto(arquivo.saldo.data)}: ${formatar(arquivo.saldo.valor)} — bateu com o app ✓ A conta ficou conferida.</p>`
        : `<p class="nao-bateu">Saldo do banco em ${diaCurto(arquivo.saldo.data)}: ${formatar(arquivo.saldo.valor)}; o app tem ${formatar(doApp)} — diferença de ${formatar(Math.abs(arquivo.saldo.valor - doApp))}. Pode ser lançamento de antes deste extrato, ou um que ficou fora. A conferência da conta mostra e acerta.</p>`;
    }
    el('revisao').innerHTML = '';
    el('acoes').hidden = true;
    recado('');
    el('resultado').hidden = false;
    el('resultado').innerHTML = `<p class="titulo-rel">Importado: ${criados} ${criados === 1 ? 'novo' : 'novos'}, ${casados} casados com o que já estava${ignorar.length ? `, ${ignorar.length} ignorados` : ''}.</p>${saldoHTML}
      ${regras.size ? `<p class="nota">O app aprendeu ${regras.size} ${regras.size === 1 ? 'regra' : 'regras'}: da próxima vez, esses textos já vêm classificados. Ficam em Configurações › Regras.</p>` : ''}`;
    el('arquivo').value = '';
    arquivo = null;
    for (const fn of repintar) await fn();
  }

  // ── eventos ─────────────────────────────────────────────────────────────

  async function lerArquivo(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const texto = decodificar(bytes);
    el('resultado').hidden = true;
    if (/<OFX>|OFXHEADER/i.test(texto)) {
      arquivo = lerOFX(texto);
    } else {
      arquivo = lerCSV(texto);
      csvMapa = { ...arquivo.mapa };
      inverter = false;
    }
    pintarContas();
    // Fatura de cartão em CSV costuma trazer a compra positiva.
    if (arquivo.formato === 'csv' && ehCartao()) {
      const ls = linhasDoCSV(arquivo, csvMapa);
      inverter = ls.filter((l) => l.valor > 0).length > ls.length / 2;
    }
    const ls = linhasDoArquivo();
    const datas = ls.map((l) => l.data).sort();
    el('lido').textContent = ls.length
      ? `${arquivo.formato.toUpperCase()}${arquivo.conta?.numero ? ` · conta ${arquivo.conta.numero}` : ''} · ${ls.length} movimentos de ${diaCurto(datas[0])} a ${diaCurto(datas[datas.length - 1])}${arquivo.saldo ? ` · saldo do banco ${formatar(arquivo.saldo.valor)} em ${diaCurto(arquivo.saldo.data)}` : ''}`
      : 'Não achei movimentos no arquivo. Se for CSV, confira as colunas abaixo.';
    refazer();
  }

  function refazer() {
    pintarColunas();
    pintarFaturas();
    if (!arquivo) return;
    decidir();
    pintarRevisao();
  }

  el('arquivo').addEventListener('change', async () => {
    const f = el('arquivo').files?.[0];
    if (!f) return;
    app = await estado.calcular();
    try {
      await lerArquivo(f);
    } catch (e) {
      recado(`Não consegui ler o arquivo: ${e.message}`);
    }
  });
  el('conta').addEventListener('change', refazer);
  el('fatura').addEventListener('change', refazer);
  el('colunas').addEventListener('change', (e) => {
    const s = e.target.closest('[data-coluna]');
    if (s) csvMapa[s.dataset.coluna] = Number(s.value);
    if (e.target.matches('[data-imp="inverter"]')) inverter = e.target.checked;
    refazer();
  });
  el('revisao').addEventListener('change', (e) => {
    const s = e.target.closest('[data-i]');
    if (!s) return;
    const x = decididas[Number(s.dataset.i)];
    const campo = s.dataset.campo;
    const valor = s.value || null;
    if (campo === 'tipo') {
      x.acao = { tipo: valor, categoriaId: null, contaOutra: null, pagamento: ehCartao() && valor === 'transferencia' };
    } else {
      x.acao[campo] = valor;
      // A mesma escolha vale para as outras linhas do mesmo texto que ainda não
      // têm nada — é o "aplicar a todas" sem botão.
      const k = chave(x.texto);
      for (const y of decididas) {
        if (y !== x && y.situacao === 'nova' && chave(y.texto) === k && y.acao.tipo === x.acao.tipo && !y.acao[campo]) y.acao[campo] = valor;
      }
    }
    pintarRevisao();
  });
  el('b-importar').addEventListener('click', async () => {
    el('b-importar').disabled = true;
    try {
      await gravar();
    } catch (e) {
      recado(`Não deu para importar: ${e.message}`);
      el('b-importar').disabled = false;
    }
  });

  janela = {
    async abrir(contaId = null) {
      app = await estado.calcular();
      arquivo = null;
      decididas = [];
      el('arquivo').value = '';
      el('lido').textContent = '';
      el('revisao').innerHTML = '';
      el('colunas').hidden = true;
      el('acoes').hidden = true;
      el('resultado').hidden = true;
      recado('');
      pintarContas(contaId);
      pintarFaturas();
      dlg.showModal();
    },
  };
  return janela;
}
