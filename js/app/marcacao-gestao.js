// A marcação da gestão de contas em cada área (o que era a bancada): o
// formulário de criar, numa janela, e as janelas de ciclo do cartão e de
// contrato da dívida. Uma vez aqui, em vez de repetida em cinco páginas.

export const NOVA_CONTA = `
<dialog id="dialogo-nova-conta" class="dialogo-ciclo dialogo-nova-conta" aria-labelledby="titulo-nova-conta">
  <form class="formulario" id="f-conta">
    <p class="titulo-bloco" id="titulo-nova-conta">nova conta</p>
    <div class="campo largo">
      <label for="conta-nome">Nome</label>
      <input type="text" id="conta-nome" name="nome" autocomplete="off"
             placeholder="Conta do dia a dia">
    </div>
    <div class="campo">
      <label for="conta-tipo">Tipo</label>
      <select id="conta-tipo" name="tipo">
        <option value="corrente">conta corrente</option>
        <option value="cartao">cartão de crédito</option>
        <option value="especie">dinheiro em espécie</option>
        <option value="investimento">investimento</option>
        <option value="divida">dívida</option>
        <option value="folha">folha</option>
      </select>
    </div>
    <div class="campo">
      <label for="conta-dono">Dono</label>
      <input type="text" id="conta-dono" name="dono" autocomplete="off" list="donos"
             placeholder="de quem é">
      <datalist id="donos"></datalist>
    </div>
    <div class="campo">
      <label for="conta-saldo" id="rotulo-saldo">Saldo de hoje</label>
      <input type="text" id="conta-saldo" name="saldo" inputmode="decimal"
             autocomplete="off" placeholder="0,00">
    </div>
    <div class="campo">
      <label for="conta-data">Conferido em</label>
      <input type="date" id="conta-data" name="data">
    </div>

    <div class="so-cartao" id="campos-cartao" hidden>
      <div class="campo">
        <label for="conta-limite">Limite</label>
        <input type="text" id="conta-limite" name="limite" inputmode="decimal"
               autocomplete="off" placeholder="0,00">
      </div>
      <div class="campo estreito">
        <label for="conta-fechamento">Fecha dia</label>
        <input type="number" id="conta-fechamento" name="fechamento" min="1" max="31">
      </div>
      <div class="campo estreito">
        <label for="conta-vencimento">Vence dia</label>
        <input type="number" id="conta-vencimento" name="vencimento" min="1" max="31">
      </div>
      <div class="campo">
        <label for="conta-paga-com">Paga com</label>
        <select id="conta-paga-com" name="pagaCom" data-papel="paga-com"></select>
      </div>
    </div>

    <!-- O contrato de um empréstimo (design/10 §4): o app gera as parcelas e
         estima o saldo devedor entre uma foto do banco e outra. -->
    <div class="so-cartao" id="campos-divida" hidden>
      <div class="campo">
        <label for="div-tomado">Valor tomado</label>
        <input type="text" id="div-tomado" name="tomado" inputmode="decimal" autocomplete="off" placeholder="0,00">
      </div>
      <div class="campo">
        <label for="div-data-contrato">Contratado em</label>
        <input type="date" id="div-data-contrato" name="dataContrato">
      </div>
      <div class="campo estreito">
        <label for="div-parcelas">Parcelas</label>
        <input type="number" id="div-parcelas" name="parcelas" min="1" max="600">
      </div>
      <div class="campo">
        <label for="div-valor-parcela">Valor da parcela</label>
        <input type="text" id="div-valor-parcela" name="valorParcela" inputmode="decimal" autocomplete="off" placeholder="0,00">
      </div>
      <div class="campo">
        <label for="div-primeira">Primeira parcela</label>
        <input type="date" id="div-primeira" name="primeira">
      </div>
      <div class="campo estreito">
        <label for="div-ja-pagas">Já pagas</label>
        <input type="number" id="div-ja-pagas" name="jaPagas" min="0" max="600" data-papel="ja-pagas">
      </div>
      <div class="campo estreito">
        <label for="div-taxa">Taxa % a.m.</label>
        <input type="text" id="div-taxa" name="taxa" inputmode="decimal" autocomplete="off" placeholder="opcional">
      </div>
      <div class="campo">
        <label for="div-paga">Paga com</label>
        <select id="div-paga" name="pagaComDivida" data-papel="paga-divida"></select>
      </div>
      <p class="conferencia-contrato" data-papel="conferencia-contrato" hidden></p>
    </div>

    <div class="campo acao">
      <button type="submit" class="principal" id="b-criar-conta">Criar conta</button>
    </div>
    <div class="campo acao">
      <button type="button" id="b-cancelar-conta">Cancelar</button>
    </div>

    <p class="dica" id="dica-conta">
      <strong>O saldo é o de hoje</strong>, não o de quando a conta foi aberta no banco: é o
      marco zero, e dali pra frente o app cuida sozinho.
    </p>
  </form>
</dialog>`;

export const CICLO = `
<dialog id="dialogo-ciclo" class="dialogo-ciclo" data-area="cartoes" aria-labelledby="titulo-ciclo">
  <form class="formulario" id="f-ciclo" method="dialog">
    <p class="titulo-bloco" id="titulo-ciclo">cartão</p>
    <div class="campo estreito">
      <label for="ciclo-fechamento">Fecha dia</label>
      <input type="number" id="ciclo-fechamento" name="fechamento" min="1" max="31">
    </div>
    <div class="campo estreito">
      <label for="ciclo-vencimento">Vence dia</label>
      <input type="number" id="ciclo-vencimento" name="vencimento" min="1" max="31">
    </div>
    <div class="campo">
      <label for="ciclo-limite">Limite</label>
      <input type="text" id="ciclo-limite" name="limite" inputmode="decimal" autocomplete="off" placeholder="0,00">
    </div>
    <div class="campo">
      <label for="ciclo-paga-com">Paga com</label>
      <select id="ciclo-paga-com" name="pagaCom" data-papel="paga-com"></select>
    </div>
    <p class="dica">
      Mudar o dia de fechamento ou de vencimento refaz só as faturas que ainda não fecharam.
      A fatura fechada fica como o banco a fechou.
    </p>
    <div class="campo acao">
      <button type="submit" class="principal" value="salvar">Salvar</button>
    </div>
    <div class="campo acao">
      <button type="submit" value="cancelar" formnovalidate>Cancelar</button>
    </div>
  </form>
</dialog>`;

export const CONTRATO = `
<dialog id="dialogo-contrato" class="dialogo-ciclo" data-area="dividas" aria-labelledby="titulo-contrato">
  <form class="formulario" id="f-contrato" method="dialog">
    <p class="titulo-bloco" id="titulo-contrato">contrato</p>
      <div class="campo largo">
        <label for="ct-nome">Nome</label>
        <input type="text" id="ct-nome" name="nome" autocomplete="off">
      </div>
      <div class="campo">
        <label for="ct-tomado">Valor tomado</label>
        <input type="text" id="ct-tomado" name="tomado" inputmode="decimal" autocomplete="off" placeholder="0,00">
      </div>
      <div class="campo">
        <label for="ct-data-contrato">Contratado em</label>
        <input type="date" id="ct-data-contrato" name="dataContrato">
      </div>
      <div class="campo estreito">
        <label for="ct-parcelas">Parcelas</label>
        <input type="number" id="ct-parcelas" name="parcelas" min="1" max="600">
      </div>
      <div class="campo">
        <label for="ct-valor-parcela">Valor da parcela</label>
        <input type="text" id="ct-valor-parcela" name="valorParcela" inputmode="decimal" autocomplete="off" placeholder="0,00">
      </div>
      <div class="campo">
        <label for="ct-primeira">Primeira parcela</label>
        <input type="date" id="ct-primeira" name="primeira">
      </div>
      <div class="campo estreito">
        <label for="ct-ja-pagas">Já pagas</label>
        <input type="number" id="ct-ja-pagas" name="jaPagas" min="0" max="600" data-papel="ja-pagas">
      </div>
      <div class="campo estreito">
        <label for="ct-taxa">Taxa % a.m.</label>
        <input type="text" id="ct-taxa" name="taxa" inputmode="decimal" autocomplete="off" placeholder="opcional">
      </div>
      <div class="campo">
        <label for="ct-paga">Paga com</label>
        <select id="ct-paga" name="pagaComDivida" data-papel="paga-divida"></select>
      </div>
      <p class="conferencia-contrato" data-papel="conferencia-contrato" hidden></p>
    <div class="campo">
      <label for="ct-foto">Saldo devedor hoje</label>
      <input type="text" id="ct-foto" name="foto" inputmode="decimal" autocomplete="off" placeholder="o que o banco mostra">
    </div>
    <p class="dica">
      Sem a taxa, o app usa a que está embutida no contrato (valor, parcelas e prestação), ou a
      observada entre duas fotos do saldo. O saldo que o banco mostra, quando informado, manda.
    </p>
    <p class="aviso erro" id="aviso-contrato" hidden></p>
    <div class="campo acao">
      <button type="submit" class="principal" value="salvar">Salvar</button>
    </div>
    <div class="campo acao">
      <button type="submit" value="cancelar" formnovalidate>Cancelar</button>
    </div>
    <!-- Quitado, arquiva com a história; cadastrado errado, exclui com tudo
         que gerou (design/10 §4.4). -->
    <p class="zona-perigo fim-contrato" id="fim-contrato">
      <button type="button" class="elo" id="b-arquivar-divida"></button>
      <button type="button" class="elo perigo" id="b-excluir-divida">excluir empréstimo</button>
      <span id="confirma-exclusao" hidden>
        <span id="texto-exclusao"></span>
        <button type="button" class="perigo" id="b-excluir-sim">excluir</button>
        <button type="button" class="elo" id="b-excluir-nao">não</button>
      </span>
    </p>
  </form>
</dialog>`;

// Editar uma conta que já existe: o que era a lista "Suas contas" embaixo de
// cada tela (pedido dele, 03/10/2026). Abre pelo "editar" do canto de cima.
export const EDITAR_CONTA = `
<dialog id="dialogo-editar-conta" class="dialogo-ciclo" aria-labelledby="titulo-editar-conta">
  <form class="formulario" id="f-editar-conta" method="dialog">
    <p class="titulo-bloco" id="titulo-editar-conta">conta</p>
    <div class="campo largo">
      <label for="ec-nome">Nome</label>
      <input type="text" id="ec-nome" name="nome" autocomplete="off">
    </div>
    <div class="so-cartao" id="ec-cartao" hidden>
      <div class="campo estreito">
        <label for="ec-fechamento">Fecha dia</label>
        <input type="number" id="ec-fechamento" name="fechamento" min="1" max="31">
      </div>
      <div class="campo estreito">
        <label for="ec-vencimento">Vence dia</label>
        <input type="number" id="ec-vencimento" name="vencimento" min="1" max="31">
      </div>
      <div class="campo">
        <label for="ec-limite">Limite</label>
        <input type="text" id="ec-limite" name="limite" inputmode="decimal" autocomplete="off" placeholder="0,00">
      </div>
      <div class="campo">
        <label for="ec-paga-com">Paga com</label>
        <select id="ec-paga-com" name="pagaCom" data-papel="paga-com"></select>
      </div>
    </div>
    <div class="campo" id="ec-campo-saldo">
      <label for="ec-saldo" id="ec-rotulo-saldo">Saldo inicial</label>
      <input type="text" id="ec-saldo" name="saldo" inputmode="decimal" autocomplete="off" placeholder="0,00">
    </div>
    <div class="campo" id="ec-campo-data">
      <label for="ec-data">Conferido em</label>
      <input type="date" id="ec-data" name="data">
    </div>
    <p class="dica" id="ec-dica"></p>
    <p class="aviso erro" id="aviso-editar-conta" hidden></p>
    <div class="campo acao">
      <button type="submit" class="principal" value="salvar">Salvar</button>
    </div>
    <div class="campo acao">
      <button type="submit" value="cancelar" formnovalidate>Cancelar</button>
    </div>
    <p class="zona-perigo fim-contrato">
      <button type="button" class="elo" id="b-arquivar-conta"></button>
      <button type="button" class="elo perigo" id="b-excluir-conta">excluir</button>
      <span id="confirma-exclusao-conta" hidden>
        <span id="texto-exclusao-conta"></span>
        <button type="button" class="perigo" id="b-excluir-conta-sim">excluir</button>
        <button type="button" class="elo" id="b-excluir-conta-nao">não</button>
      </span>
    </p>
  </form>
</dialog>`;
