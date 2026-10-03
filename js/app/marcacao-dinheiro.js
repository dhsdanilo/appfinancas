// A marcação das telas de dinheiro — Início, Lançamentos e as cinco áreas — e
// das janelas que todas usam. Uma vez aqui, em vez de repetida em sete páginas:
// janela copiada é janela que diverge no terceiro ajuste.

export const BARRA = `
  <div class="barra-acoes" id="barra-acoes">
    <div class="acoes-topo">
      <button type="button" class="principal" id="b-novo">Novo lançamento</button>
      <button type="button" id="b-transferir">Transferir</button>
      <span class="atalho"><kbd>N</kbd> lança · <kbd>T</kbd> transfere</span>
    </div>
  </div>`;

export const PRINCIPAL = `
  <!-- A fila de pendências (R16): a única parte do app que cobra — e cobra
       pendência, nunca comportamento (design/08-telas §6). -->
  <section class="cartao pendencias" id="pendencias" hidden></section>

  <div class="abas" role="tablist" aria-label="Natureza das contas" id="abas" hidden></div>

  <section class="cartao painel" id="painel">
    <div class="filtros" id="filtros" hidden>
      <input type="search" id="filtro-busca" placeholder="buscar: categoria, detalhe, conta, observação" aria-label="Buscar lançamentos" autocomplete="off">
      <select id="filtro-area" aria-label="Área"></select>
      <select id="filtro-conta" aria-label="Conta"></select>
      <select id="filtro-categoria" aria-label="Categoria"></select>
    </div>

    <div class="subabas" role="group" aria-label="Conta" id="subabas"></div>

    <div class="periodo" id="periodo">
      <button type="button" class="passo" id="p-antes" aria-label="Mês anterior">‹</button>
      <strong class="rotulo-periodo" id="p-rotulo"></strong>
      <button type="button" class="passo" id="p-depois" aria-label="Mês seguinte">›</button>
      <button type="button" class="elo" id="p-modo" aria-expanded="false">período</button>
      <span class="intervalo" id="p-intervalo" hidden>
        <input type="date" id="p-de" aria-label="Do dia">
        <span>até</span>
        <input type="date" id="p-ate" aria-label="Até o dia">
      </span>
    </div>

    <div class="resumo" id="resumo"></div>

    <div id="parte-lista">
      <div class="cabeca-lista">
        <h2>Lançamentos</h2>
        <p class="totais" id="totais"></p>
      </div>
      <p class="nota">Toque num lançamento para corrigir ou apagar; num previsto, para resolver.</p>
      <ol id="lista" class="lista"></ol>
    </div>
  </section>`;

export const DIALOGOS = `
<dialog id="dialogo" class="dialogo-captura" aria-label="Novo lançamento">
  <div class="cabecalho-dialogo">
    <strong>Novo lançamento</strong>
    <button type="button" class="elo" id="b-fechar">fechar</button>
  </div>
  <div class="captura" id="formulario"></div>
  <p class="atalhos">
    <kbd>Enter</kbd> salva e abre a próxima · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> salva e fecha ·
    <kbd>Esc</kbd> fecha
  </p>
</dialog>

<dialog id="dialogo-edicao" class="dialogo-captura" aria-label="Corrigir lançamento">
  <div class="cabecalho-dialogo">
    <strong>Corrigir lançamento</strong>
    <button type="button" class="elo" id="b-fechar-edicao">fechar</button>
  </div>
  <div class="captura" id="formulario-edicao"></div>
  <p class="atalhos"><kbd>Enter</kbd> salva e fecha · <kbd>Esc</kbd> sai sem salvar</p>
</dialog>

<dialog id="dialogo-transferencia" class="dialogo-captura" aria-label="Transferência">
  <div class="cabecalho-dialogo">
    <strong id="titulo-transferencia">Transferência</strong>
    <button type="button" class="elo" id="b-fechar-transferencia">fechar</button>
  </div>
  <div class="captura" id="formulario-transferencia"></div>
  <p class="atalhos">Sacar, depositar, aportar e resgatar são isto: o dinheiro trocando de bolso.</p>
</dialog>

<dialog id="dialogo-devolucao" class="dialogo-captura" aria-label="Devolução">
  <div class="cabecalho-dialogo">
    <strong>Devolução</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples" id="formulario-devolucao"></div>
</dialog>

<dialog id="dialogo-conferencia" class="dialogo-captura" aria-label="Conferir saldo">
  <div class="cabecalho-dialogo">
    <strong id="titulo-conferencia">Conferir saldo</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples" id="formulario-conferencia"></div>
</dialog>

<dialog id="dialogo-holerite" class="dialogo-captura dialogo-holerite" aria-label="Contracheque">
  <div class="cabecalho-dialogo">
    <strong>Contracheque</strong>
    <button type="button" class="elo" data-fechar>fechar</button>
  </div>
  <div class="form-simples" id="formulario-holerite"></div>
</dialog>`;
