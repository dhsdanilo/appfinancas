// Suíte de verificação da fundação.
//
// Roda no navegador, contra um banco PRÓPRIO ('appfinancas-teste'), porque
// apaga tudo que toca. O banco de verdade não é encostado.
//
// O teste mais importante daqui é "cache == recálculo do zero": se esses dois
// resultados divergirem, o estado consolidado está mentindo, e todo o resto do
// app passa a mentir junto.

import * as dinheiro from '../core/dinheiro.js';
import * as db from '../core/db.js';
import * as log from '../core/log.js';
import * as estado from '../core/estado.js';
import { promover, ErroDeFormato } from '../core/formato.js';
import * as lanc from '../core/lancamentos.js';
import * as listas from '../core/listas.js';
import * as cripto from '../core/cripto.js';
import * as sincronia from '../core/sincronia.js';
import { VERSAO_ESTADO } from '../core/redutores.js';
import * as cartao from '../core/cartao.js';
import * as previsto from '../core/previsto.js';
import * as datas from '../core/datas.js';

const BANCO_DE_TESTE = 'appfinancas-teste';

// ── mini arcabouço ────────────────────────────────────────────────────────

class Falha extends Error {}

function igual(obtido, esperado, nota = '') {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Falha(`${nota}\n  obtido:   ${a}\n  esperado: ${b}`);
}

function verdade(valor, nota = '') {
  if (!valor) throw new Falha(nota || 'esperava verdadeiro');
}

async function lanca(fn, Tipo, nota = '') {
  try {
    await fn();
  } catch (e) {
    if (Tipo && !(e instanceof Tipo)) {
      throw new Falha(`${nota}: lançou ${e.name}, esperava ${Tipo.name}`);
    }
    return e;
  }
  throw new Falha(nota || 'esperava que lançasse, e não lançou');
}

// ── casos ─────────────────────────────────────────────────────────────────

const casos = [];
const caso = (grupo, nome, fn) => casos.push({ grupo, nome, fn });

// dinheiro ─────────────────────────────────────────────────────────────────

caso('dinheiro', 'entrada estilo calculadora', () => {
  let v = 0;
  for (const d of '12740') v = dinheiro.acrescentarDigito(v, d);
  igual(v, 12740, 'digitar 1-2-7-4-0 deve dar R$ 127,40');
  igual(dinheiro.removerDigito(v), 1274);
  igual(dinheiro.deDigitos('R$ 1.274,0'), 12740, 'ignora tudo que não é dígito');
});

caso('dinheiro', 'texto humano para centavos', () => {
  igual(dinheiro.deTexto('1.234,56'), 123456);
  igual(dinheiro.deTexto('1234.56'), 123456);
  igual(dinheiro.deTexto('1234'), 123400, 'sem decimal = reais inteiros');
  igual(dinheiro.deTexto('12,5'), 1250, 'um decimal vira dois');
  igual(dinheiro.deTexto('-5,55'), -555);
  igual(dinheiro.deTexto(''), 0);
});

caso('dinheiro', 'sempre vírgula, dois dígitos e milhar', () => {
  igual(dinheiro.formatar(184250), 'R$ 1.842,50');
  igual(dinheiro.formatar(100), 'R$ 1,00', 'nunca "R$ 1"');
  igual(dinheiro.formatar(5), 'R$ 0,05');
  igual(dinheiro.formatar(-3060), '−R$ 30,60', 'negativo com sinal explícito');
  igual(dinheiro.formatar(100000000), 'R$ 1.000.000,00');
  igual(dinheiro.formatarEstimado(28700), '~R$ 287,00', 'estimativa leva ~');
});

caso('dinheiro', 'partes separadas para a tela', () => {
  igual(dinheiro.partes(184250), {
    negativo: false, sinal: '', reais: '1.842', centavos: '50',
  });
  igual(dinheiro.partes(5).centavos, '05', 'centavos sempre com dois dígitos');
});

caso('dinheiro', 'rateio nunca perde nem inventa centavo', () => {
  // O caso clássico: dividir 100 por 3.
  const r = dinheiro.ratear(100, [1, 1, 1]);
  igual(dinheiro.somar(r), 100, 'a soma tem de ser exatamente o total');
  igual(r, [34, 33, 33]);

  // Pesos desiguais, total ímpar, muitos participantes.
  for (const total of [1, 7, 101, 99999, 1234567]) {
    for (const pesos of [[1, 2], [3, 3, 3], [1, 1, 1, 1, 1, 1, 1], [8400, 1200, 3200, 4800]]) {
      const parts = dinheiro.ratear(total, pesos);
      igual(dinheiro.somar(parts), total, `ratear(${total}, [${pesos}]) deve fechar`);
      verdade(parts.every((p) => p >= 0), 'nenhuma parte pode ser negativa');
    }
  }
  igual(dinheiro.ratear(500, [0, 0]), [0, 0], 'pesos zerados não explodem');
});

caso('dinheiro', 'zero não é lançável', () => {
  verdade(!dinheiro.valorLancavel(0));
  verdade(!dinheiro.valorLancavel(-100));
  verdade(!dinheiro.valorLancavel(10.5), 'centavo fracionário não existe');
  verdade(dinheiro.valorLancavel(1));
});

// formato ──────────────────────────────────────────────────────────────────

caso('formato', 'evento na versão atual passa intacto', () => {
  const ev = { id: 'ev_1', v: 1, tipo: 'teste', dados: { a: 1 } };
  igual(promover(ev, { ate: 1 }), ev);
});

caso('formato', 'promove em cadeia, 1 → 2 → 3', () => {
  const tabela = {
    1: (ev) => ({ ...ev, v: 2, dados: { ...ev.dados, veioDa1: true } }),
    2: (ev) => ({ ...ev, v: 3, dados: { ...ev.dados, veioDa2: true } }),
  };
  const fora = promover({ id: 'ev_1', v: 1, dados: {} }, { migracoes: tabela, ate: 3 });
  igual(fora.v, 3);
  igual(fora.dados, { veioDa1: true, veioDa2: true }, 'as duas migrações rodaram, em ordem');
});

caso('formato', 'evento mais novo que o app é erro claro, não chute', async () => {
  const e = await lanca(
    () => promover({ id: 'ev_1', v: 9, dados: {} }, { ate: 1 }),
    ErroDeFormato,
    'formato futuro'
  );
  verdade(/formato 9/.test(e.message), 'a mensagem tem de dizer qual versão');
});

caso('formato', 'migração faltando é erro, não silêncio', async () => {
  await lanca(
    () => promover({ id: 'ev_1', v: 1, dados: {} }, { migracoes: {}, ate: 2 }),
    ErroDeFormato,
    'sem a migração 1→2'
  );
});

// log ──────────────────────────────────────────────────────────────────────

caso('log', 'sequência e relógio lógico só crescem', async () => {
  await limpar();
  await log.registrarAparelho('PC de teste');

  const a = await log.registrar('pessoa.criada', { id: 'p1', nome: 'Maria' });
  const b = await log.registrar('pessoa.criada', { id: 'p2', nome: 'João' });

  igual(a.seq, 1);
  igual(b.seq, 2, 'seq do aparelho incrementa');
  verdade(b.lc > a.lc, 'relógio lógico cresce');
  igual(a.ap, 'pc-de-teste', 'id do aparelho vem do nome, em slug');
  igual(a.v, 1, 'todo evento carrega a versão do formato');
});

caso('log', 'ordem canônica é (lc, aparelho), não horário', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');

  // Eventos de outro aparelho, com horário EMBARALHADO de propósito:
  // relógio de celular erra, e a ordem não pode depender dele.
  await log.absorver([
    { id: 'x1', ap: 'celular', seq: 1, lc: 3, t: '2030-01-01T00:00:00Z', v: 1, tipo: 'pessoa.criada', dados: { id: 'p3', nome: 'C' } },
    { id: 'x2', ap: 'celular', seq: 2, lc: 1, t: '2020-01-01T00:00:00Z', v: 1, tipo: 'pessoa.criada', dados: { id: 'p1', nome: 'A' } },
    { id: 'x3', ap: 'celular', seq: 3, lc: 2, t: '2025-01-01T00:00:00Z', v: 1, tipo: 'pessoa.criada', dados: { id: 'p2', nome: 'B' } },
  ]);

  const lidos = await log.ler();
  igual(lidos.map((e) => e.lc), [1, 2, 3], 'ordena por relógio lógico');
  igual(lidos.map((e) => e.dados.nome), ['A', 'B', 'C']);
});

caso('log', 'absorver o mesmo evento duas vezes não muda nada', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const lote = [
    { id: 'y1', ap: 'outro', seq: 1, lc: 1, t: '2026-01-01T00:00:00Z', v: 1, tipo: 'pessoa.criada', dados: { id: 'p1', nome: 'A' } },
  ];

  const primeira = await log.absorver(lote);
  const segunda = await log.absorver(lote);

  igual(primeira.novos, 1);
  igual(segunda.novos, 0, 'idempotente: sincronizar de novo é inofensivo');
  igual(await log.contar(), 1);
});

caso('log', 'relógio local sobe ao receber de fora', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await log.absorver([
    { id: 'z1', ap: 'outro', seq: 1, lc: 500, t: '2026-01-01T00:00:00Z', v: 1, tipo: 'pessoa.criada', dados: { id: 'p1', nome: 'A' } },
  ]);
  const meu = await log.registrar('pessoa.criada', { id: 'p2', nome: 'B' });
  verdade(meu.lc > 500, `lc local devia passar de 500, veio ${meu.lc}`);
});

caso('log', 'escritas simultâneas não colidem', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');

  // Dois toques rápidos no botão de lançar, ou um lançamento enquanto a
  // sincronização absorve: sem fila, estes disputariam o mesmo seq e o mesmo lc.
  const quantos = 20;
  const eventos = await Promise.all(
    Array.from({ length: quantos }, (_, i) =>
      log.registrar('conta.criada', { id: `c${i}`, nome: `Conta ${i}`, tipo: 'corrente' })
    )
  );

  igual(eventos.length, quantos);
  igual(await log.contar(), quantos, 'nenhum evento se perdeu');

  const seqs = eventos.map((e) => e.seq).sort((a, b) => a - b);
  igual(seqs, Array.from({ length: quantos }, (_, i) => i + 1), 'seq de 1 a 20, sem repetir');

  const lcs = new Set(eventos.map((e) => e.lc));
  igual(lcs.size, quantos, 'cada evento com relógio lógico próprio');

  const e = await estado.calcular();
  igual(Object.keys(e.contas).length, quantos, 'e todas as contas existem no estado');
});

// criptografia ─────────────────────────────────────────────────────────────

caso('cripto', 'o que sobe volta igual, e a frase errada não abre', async () => {
  const sal = cripto.novoSal();
  const chave = await cripto.derivarChave('a frase da casa', sal);

  const linha = JSON.stringify({ tipo: 'lancamento.registrado', valor: 12740, nome: 'Feira · açaí' });
  const cifrada = await cripto.cifrar(chave, linha);

  verdade(!cifrada.includes('12740'), 'o valor não pode aparecer no que sobe');
  verdade(!cifrada.includes('lancamento'), 'nem o tipo do evento');
  igual(await cripto.decifrar(chave, cifrada), linha, 'e volta byte a byte, com acento e tudo');

  const outra = await cripto.derivarChave('a frase errada', sal);
  await lanca(() => cripto.decifrar(outra, cifrada), null,
    'frase errada tem de FALHAR, nunca devolver lixo em silêncio');
});

caso('cripto', 'o selo detecta a frase errada antes de qualquer dado', async () => {
  const sal = cripto.novoSal();
  const certa = await cripto.derivarChave('frase certa', sal);
  const errada = await cripto.derivarChave('frase errada', sal);
  const selo = await cripto.criarSelo(certa);

  verdade(await cripto.seloConfere(certa, selo), 'a frase certa abre o selo');
  verdade(!(await cripto.seloConfere(errada, selo)),
    'a errada não abre — e o app avisa antes de tentar ler o histórico');
});

caso('cripto', 'cada linha tem nonce próprio: o mesmo texto nunca sobe igual', async () => {
  const chave = await cripto.derivarChave('frase', cripto.novoSal());
  const a = await cripto.cifrar(chave, 'mesma linha');
  const b = await cripto.cifrar(chave, 'mesma linha');

  verdade(a !== b, 'duas cifras iguais entregariam que o lançamento se repetiu');
  igual(await cripto.decifrar(chave, a), 'mesma linha');
  igual(await cripto.decifrar(chave, b), 'mesma linha');
});

caso('cripto', 'o mesmo sal e a mesma frase dão a mesma chave em qualquer aparelho', async () => {
  const sal = cripto.novoSal();
  const noPc = await cripto.derivarChave('frase da casa', sal);
  const noCelular = await cripto.derivarChave('frase da casa', sal);

  const cifradaNoPc = await cripto.cifrar(noPc, 'lançado no PC');
  igual(await cripto.decifrar(noCelular, cifradaNoPc), 'lançado no PC',
    'sem isto, um aparelho não leria o que o outro escreveu');
});

// sincronização ────────────────────────────────────────────────────────────
//
// O repositório é falso, de memória: o que se testa aqui é o ciclo, não a rede.
// Mesmo assim ele cobra o sha como o GitHub cobra, para o envio não passar por
// cima do que já está lá.

function repositorioFalso({ privado = true } = {}) {
  const arquivos = new Map();
  let n = 0;
  return {
    repo: 'teste/dados',
    arquivos,
    async informacoes() {
      return { privado, ramo: 'main' };
    },
    async listar(pasta) {
      return [...arquivos.entries()]
        .filter(([caminho]) => caminho.startsWith(pasta + '/'))
        .map(([caminho, v]) => ({ nome: caminho.slice(pasta.length + 1), caminho, sha: v.sha }));
    },
    async ler(caminho) {
      const a = arquivos.get(caminho);
      return a ? { texto: a.texto, sha: a.sha } : null;
    },
    async gravar(caminho, texto, { sha = null }) {
      const atual = arquivos.get(caminho);
      if (atual && atual.sha !== sha) throw new Falha('gravou sem o sha certo: passaria por cima');
      n += 1;
      arquivos.set(caminho, { texto, sha: 'sha' + n });
      return { sha: 'sha' + n };
    },
  };
}

const ACESSO = { repo: 'teste/dados', token: 'token-de-teste', frase: 'a frase da casa' };

async function lancarAlgo() {
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Banco', tipo: 'corrente', saldoInicial: 100000 });
  await estado.aplicarEvento('categoria.criada', { id: 'k1', nome: 'Supermercado', pai: null });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l1', tipo: 'despesa', valor: 12740, contaId: 'c1', categoriaId: 'k1',
    dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', confirmado: true,
  });
}

caso('sincronia', '★ o que o PC lança chega no celular, e o que sobe é ilegível', async () => {
  const nuvem = repositorioFalso();

  // ── o PC
  await limpar();
  await log.registrarAparelho('pc');
  await lancarAlgo();
  const pareado = await sincronia.parear({ ...ACESSO, aparelho: 'pc' }, { cliente: nuvem });
  verdade(pareado.primeiro, 'o primeiro aparelho cria o sal e o selo');
  const ida = await sincronia.sincronizar({ cliente: nuvem });
  igual(ida.enviados, 3, 'os três eventos do PC subiram');

  const subiu = nuvem.arquivos.get('log/pc.ndjson').texto;
  verdade(!subiu.includes('Supermercado'), 'o nome da categoria não pode estar legível lá');
  verdade(!subiu.includes('12740'), 'nem o valor');
  verdade(!subiu.includes('lancamento.registrado'), 'nem o tipo do evento');

  // ── o celular, que nunca viu nada disto
  await limpar();
  await sincronia.parear({ ...ACESSO, aparelho: 'celular' }, { cliente: nuvem });
  const volta = await sincronia.sincronizar({ cliente: nuvem });
  igual(volta.recebidos, 3, 'o celular absorveu os três');

  const e = await estado.calcular();
  igual(e.contas.c1.nome, 'Banco');
  igual(lanc.saldoReal(e, 'c1'), 87260, 'e o saldo bate com o do PC: 100.000 − 12.740');
});

caso('sincronia', 'sincronizar de novo não duplica nada', async () => {
  const nuvem = repositorioFalso();
  await limpar();
  await log.registrarAparelho('pc');
  await lancarAlgo();
  await sincronia.parear({ ...ACESSO, aparelho: 'pc' }, { cliente: nuvem });

  await sincronia.sincronizar({ cliente: nuvem });
  const segunda = await sincronia.sincronizar({ cliente: nuvem });
  igual(segunda.enviados, 0, 'o que já subiu não sobe de novo');

  const QUEBRA = String.fromCharCode(10);
  const linhas = nuvem.arquivos.get('log/pc.ndjson').texto.trim().split(QUEBRA);
  igual(linhas.length, 3, 'e o arquivo continua com três linhas');
});

caso('sincronia', '★ repositório PÚBLICO: nada sobe, e o aviso é grave', async () => {
  const nuvem = repositorioFalso({ privado: false });
  await limpar();
  await log.registrarAparelho('pc');
  await lancarAlgo();

  const erro = await lanca(
    () => sincronia.parear({ ...ACESSO, aparelho: 'pc' }, { cliente: nuvem }),
    sincronia.ErroDeSincronia,
    'parear com repositório público tem de falhar'
  );
  verdade(erro.grave, 'e falhar como alerta GRAVE — é o pior cenário do projeto');
  igual(nuvem.arquivos.size, 0, 'nenhum byte foi enviado');
});

caso('sincronia', 'frase errada não pareia, e não encosta no que está lá', async () => {
  const nuvem = repositorioFalso();
  await limpar();
  await log.registrarAparelho('pc');
  await lancarAlgo();
  await sincronia.parear({ ...ACESSO, aparelho: 'pc' }, { cliente: nuvem });
  await sincronia.sincronizar({ cliente: nuvem });
  const antes = nuvem.arquivos.get('log/pc.ndjson').texto;

  await limpar();
  await lanca(
    () => sincronia.parear({ ...ACESSO, frase: 'frase errada', aparelho: 'celular' }, { cliente: nuvem }),
    sincronia.ErroDeSincronia,
    'frase que não bate com o selo tem de ser recusada'
  );
  igual(nuvem.arquivos.get('log/pc.ndjson').texto, antes, 'e o arquivo do outro aparelho fica intacto');
});

caso('sincronia', 'esquecer o aparelho apaga o token e a chave', async () => {
  const nuvem = repositorioFalso();
  await limpar();
  await log.registrarAparelho('pc');
  await sincronia.parear({ ...ACESSO, aparelho: 'pc' }, { cliente: nuvem });
  verdade(await sincronia.configuracao(), 'pareado');

  await sincronia.esquecerAparelho();
  igual(await sincronia.configuracao(), null, 'nada de token guardado');
  await lanca(() => sincronia.sincronizar({ cliente: nuvem }), sincronia.ErroDeSincronia,
    'e sincronizar passa a pedir pareamento de novo');
});

// estado ───────────────────────────────────────────────────────────────────

caso('estado', 'eventos viram estado', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');

  await estado.aplicarEvento('pessoa.criada', { id: 'p1', nome: 'Maria' });
  await estado.aplicarEvento('conta.criada', {
    id: 'c1', nome: 'Banco', tipo: 'corrente', titular: 'p1',
    saldoInicial: 491050, dataInicial: '2026-10-01',
  });
  await estado.aplicarEvento('conta.alterada', { id: 'c1', nome: 'Banco da Maria' });

  const e = await estado.calcular();
  igual(e.pessoas.p1.nome, 'Maria');
  igual(e.contas.c1.nome, 'Banco da Maria', 'a edição posterior venceu');
  igual(e.contas.c1.saldoInicial, 491050);
  igual(e.contas.c1.arquivada, false);
});

caso('estado', 'remoção é evento, não ausência de dado', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Carteira', tipo: 'especie' });
  await estado.aplicarEvento('conta.removida', { id: 'c1' });

  const e = await estado.calcular();
  igual(e.contas.c1, undefined, 'a conta saiu do estado');
  igual(await log.contar(), 2, 'mas os dois eventos continuam no registro');

  const refeito = await estado.recalcular();
  igual(refeito.contas.c1, undefined, 'e ela não ressuscita no recálculo');
});

caso('estado', 'toda gravação avisa quem está ouvindo', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');

  const motivos = [];
  const parar = estado.aoAplicar((motivo) => motivos.push(motivo));

  await estado.aplicarEvento('categoria.criada', { id: 'k1', nome: 'Supermercado', pai: null });
  await estado.aplicarEvento('categoria.alterada', { id: 'k1', nome: 'Mercado' });
  igual(motivos, ['local', 'local'], 'é por este aviso que a sincronização acontece sozinha');

  parar();
  await estado.aplicarEvento('categoria.arquivada', { id: 'k1' });
  igual(motivos.length, 2, 'e quem sai de cena para de ser avisado');
});

caso('estado', '★ cache e recálculo do zero dão o MESMO resultado', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');

  await estado.aplicarEvento('pessoa.criada', { id: 'p1', nome: 'Maria' });
  await estado.aplicarEvento('pessoa.criada', { id: 'p2', nome: 'João' });
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Banco', tipo: 'corrente', titular: 'p1' });
  await estado.aplicarEvento('conta.criada', { id: 'c2', nome: 'Tesouro', tipo: 'investimento', titular: 'p1', risco: 'baixo' });
  await estado.aplicarEvento('conta.criada', { id: 'c3', nome: 'Carteira', tipo: 'especie', titular: 'p2' });
  await estado.aplicarEvento('conta.arquivada', { id: 'c3', arquivada: true });
  await estado.aplicarEvento('conta.alterada', { id: 'c2', liquidez: 1 });

  const comCache = limpo(await estado.calcular());
  const doZero = limpo(await estado.recalcular());

  igual(comCache, doZero, 'se estes dois divergirem, o cache está mentindo');
});

caso('estado', 'cache é descartável: apagar e refazer não perde nada', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Outro banco', tipo: 'corrente' });

  const antes = limpo(await estado.calcular());
  await db.limparConsolidado();
  estado.invalidarMemoria();
  const depois = limpo(await estado.calcular());

  igual(depois, antes);
});

caso('estado', 'sobrevive a fechar e reabrir', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Caixa', tipo: 'corrente', saldoInicial: 100000 });
  const antes = limpo(await estado.calcular());

  // Simula o app fechando: tudo que estava em memória vai embora, e a próxima
  // leitura tem de sair exclusivamente do IndexedDB.
  estado.invalidarMemoria();
  db.usarBanco(BANCO_DE_TESTE);

  const depois = limpo(await estado.calcular());
  igual(depois, antes, 'o estado tem de vir inteiro do disco');
  igual(depois.contas.c1.saldoInicial, 100000);
});

caso('estado', 'evento atrasado da sincronização força recálculo', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');

  // Primeiro, o relógio local sobe por causa de um evento vindo de fora (lc 5).
  await estado.absorverEventos([
    { id: 'remoto5', ap: 'celular', seq: 1, lc: 5, t: '2026-01-01T00:00:00Z', v: 1,
      tipo: 'conta.criada', dados: { id: 'c5', nome: 'Veio de fora', tipo: 'corrente' } },
  ]);
  // Agora um evento local, que nasce depois (lc 6).
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Primeira', tipo: 'corrente' });
  const consolidado = await estado.calcular();
  verdade(consolidado.ateLc >= 6, `ateLc devia ser 6 ou mais, veio ${consolidado.ateLc}`);

  // Só então chega o atrasado, com lc 3 — menor que o já consolidado. É o caso
  // dos dois aparelhos offline no mesmo dia: a ordem muda, o cache não serve.
  const r = await estado.absorverEventos([
    { id: 'atrasado', ap: 'celular', seq: 2, lc: 3, t: '2026-01-01T00:00:00Z', v: 1,
      tipo: 'conta.criada', dados: { id: 'c0', nome: 'Chegou atrasada', tipo: 'especie' } },
  ]);

  verdade(r.recalculado, 'devia ter recalculado do zero');
  igual(r.estado.contas.c0.nome, 'Chegou atrasada');
  igual(r.estado.contas.c1.nome, 'Primeira', 'e o que já existia continua lá');

  // E a ordem final tem de ser por lc: 3, 5, 6.
  const ordem = (await log.ler()).map((e) => e.lc);
  igual(ordem, [3, 5, 6], 'o atrasado entrou no lugar certo da fila');
});

caso('estado', 'tipo de evento desconhecido é contado, não derruba o app', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await log.absorver([
    { id: 'w1', ap: 'futuro', seq: 1, lc: 1, t: '2026-01-01T00:00:00Z', v: 1,
      tipo: 'coisa.que.ainda.nao.existe', dados: {} },
  ]);

  const e = await estado.calcular();
  igual(e.desconhecidos['coisa.que.ainda.nao.existe'], 1, 'fica visível em vez de sumir');
});

// lançamento ───────────────────────────────────────────────────────────────

caso('lançamento', 'o estado vem da confirmação e da data, nunca de um campo', () => {
  const dia = '2027-03-15';
  const em = (confirmado, dataCaixa) => lanc.estadoDoLancamento({ confirmado, dataCaixa }, dia);

  igual(em(true, '2027-03-15'), 'realizado');
  igual(em(true, '2027-01-02'), 'realizado', 'confirmado é realizado em qualquer data');
  igual(em(false, '2027-04-10'), 'previsto', 'data futura e não confirmado');
  igual(em(false, '2027-03-10'), 'vencido', 'passou da data e ninguém confirmou');
  igual(em(false, '2027-03-15'), 'vencido', 'vence hoje e não foi confirmado');
});

caso('lançamento', 'confirmado nasce da origem e da data', () => {
  const dia = '2027-03-15';
  verdade(lanc.nasceConfirmado({ manual: true, dataCaixa: '2027-03-15' }, dia), 'manual hoje');
  verdade(lanc.nasceConfirmado({ manual: true, dataCaixa: '2027-03-14' }, dia), 'manual ontem');
  verdade(!lanc.nasceConfirmado({ manual: true, dataCaixa: '2027-03-20' }, dia),
    'manual com data futura é compromisso, não gasto');
  verdade(!lanc.nasceConfirmado({ manual: false, dataCaixa: '2027-03-01' }, dia),
    'recorrência nasce não confirmada mesmo com data passada');
});

caso('lançamento', 'saldo real conta só o que se moveu', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', {
    id: 'c1', nome: 'Banco', tipo: 'corrente', saldoInicial: 100000,
  });
  const comum = { tipo: 'despesa', contaId: 'c1', dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10' };

  await estado.aplicarEvento('lancamento.registrado', { id: 'l1', ...comum, valor: 25000, confirmado: true });
  await estado.aplicarEvento('lancamento.registrado', { id: 'l2', ...comum, valor: 90000, confirmado: false });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l3', tipo: 'receita', contaId: 'c1', valor: 5000,
    dataCompetencia: '2027-03-11', dataCaixa: '2027-03-11', confirmado: true,
  });

  const e = await estado.calcular();
  igual(lanc.saldoReal(e, 'c1'), 80000,
    '100.000 − 25.000 + 5.000. O previsto de 90.000 NÃO entra: o saldo real é o que bate com o banco');
});

caso('lançamento', 'remover é marcar, e o saldo volta', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Banco', tipo: 'corrente', saldoInicial: 100000 });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l1', tipo: 'despesa', contaId: 'c1', valor: 25000,
    dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', confirmado: true,
  });
  await estado.aplicarEvento('lancamento.removido', { id: 'l1' });

  const e = await estado.calcular();
  igual(lanc.saldoReal(e, 'c1'), 100000, 'o saldo voltou');
  igual(lanc.visiveis(e).length, 0, 'sumiu da lista');
  verdade(e.lancamentos.l1.removido, 'mas continua no estado, marcado — senão a sincronização o ressuscita');
});

caso('lançamento', 'corrigir grava só o que mudou', () => {
  const l = {
    id: 'l1', tipo: 'despesa', valor: 12740, categoriaId: 'k1', contaId: 'c1',
    dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', dataVencimento: '2027-03-10',
    confirmado: true,
  };
  const pedido = { valor: 13000, tipo: 'despesa', categoriaId: 'k1', contaId: 'c2', dataCaixa: '2027-03-10' };

  igual(lanc.correcao(l, pedido, '2027-03-20'), { valor: 13000, contaId: 'c2' },
    'o evento diz "mudou o valor e a conta", não "regravou o lançamento"');

  igual(lanc.correcao(l, { valor: 12740, contaId: 'c1' }, '2027-03-20'), {},
    'abriu, olhou e fechou: não existe evento "salvou igual"');
});

caso('lançamento', 'corrigir a data move as três quando elas são a mesma', () => {
  const comum = {
    valor: 1000, confirmado: true,
    dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', dataVencimento: '2027-03-10',
  };
  igual(lanc.correcao(comum, { dataCaixa: '2027-03-08' }, '2027-03-20'), {
    dataCaixa: '2027-03-08', dataCompetencia: '2027-03-08', dataVencimento: '2027-03-08',
  }, 'no lançamento comum as três datas são a mesma coisa');

  // Datas que divergem sem ser cartão (boleto pago atrasado): só o caixa anda.
  const divergentes = {
    valor: 1000, confirmado: true,
    dataCompetencia: '2027-03-10', dataCaixa: '2027-04-10', dataVencimento: '2027-04-10',
  };
  igual(lanc.correcao(divergentes, { dataCaixa: '2027-04-12' }, '2027-05-01'), {
    dataCaixa: '2027-04-12', dataVencimento: '2027-04-12',
  }, 'a competência fica onde estava');
});

caso('lançamento', 'data no futuro devolve o lançamento a previsto, e o contrário não vale', () => {
  const dia = '2027-03-20';
  const realizado = { valor: 1000, confirmado: true, dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', dataVencimento: '2027-03-10' };
  const m = lanc.correcao(realizado, { dataCaixa: '2027-04-02' }, dia);
  igual(m.confirmado, false, 'data no futuro é compromisso, não gasto (D2)');

  const vencido = { valor: 1000, confirmado: false, dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', dataVencimento: '2027-03-10' };
  igual(lanc.correcao(vencido, { valor: 1200, dataCaixa: '2027-03-11' }, dia),
    { valor: 1200, dataCaixa: '2027-03-11', dataCompetencia: '2027-03-11', dataVencimento: '2027-03-11' },
    'corrigir um vencido NÃO o promove a realizado: confirmar é ação própria, e o saldo não muda sozinho');
});

caso('estado', 'editar é evento novo: o passado continua lá', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Banco', tipo: 'corrente', saldoInicial: 100000 });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l1', tipo: 'despesa', contaId: 'c1', valor: 25000,
    dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', confirmado: true,
  });
  await estado.aplicarEvento('lancamento.alterado', { id: 'l1', valor: 13000 });

  const e = await estado.calcular();
  igual(e.lancamentos.l1.valor, 13000, 'a correção venceu');
  igual(lanc.saldoReal(e, 'c1'), 87000, 'e o saldo seguiu a correção');

  const eventos = await log.ler();
  const registro = eventos.find((ev) => ev.tipo === 'lancamento.registrado');
  igual(registro.dados.valor, 25000,
    'o evento original continua dizendo 25.000 — nada reescreve o passado');

  const refeito = await estado.recalcular();
  igual(refeito.lancamentos.l1.valor, 13000, 'e o recálculo do zero chega no mesmo lugar');
});

caso('lançamento', 'transferência é uma linha e mexe nas duas contas', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Banco', tipo: 'corrente', saldoInicial: 100000 });
  await estado.aplicarEvento('conta.criada', { id: 'c2', nome: 'Reserva', tipo: 'investimento', saldoInicial: 0 });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l1', tipo: 'transferencia', valor: 50000, contaId: 'c1', contaDestinoId: 'c2',
    categoriaId: null, dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', confirmado: true,
  });

  const e = await estado.calcular();
  igual(lanc.saldoReal(e, 'c1'), 50000, 'saiu da origem');
  igual(lanc.saldoReal(e, 'c2'), 50000, 'entrou no destino');
  igual(lanc.visiveis(e).length, 1,
    'UMA linha, nunca uma despesa numa conta mais uma receita na outra — duas dobrariam o gasto do mês');
  igual(e.lancamentos.l1.categoriaId, null, 'sem categoria: o dinheiro não saiu da vida, trocou de bolso');
});

caso('lançamento', 'corrigir etiqueta é lista, e a ordem não é informação', () => {
  const l = {
    valor: 1000, confirmado: true, etiquetas: ['t1', 't2'],
    dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', dataVencimento: '2027-03-10',
  };
  igual(lanc.correcao(l, { etiquetas: ['t2', 't1'] }, '2027-03-20'), {},
    'as mesmas etiquetas em outra ordem não são uma mudança');
  igual(lanc.correcao(l, { etiquetas: ['t1'] }, '2027-03-20'), { etiquetas: ['t1'] });
  igual(lanc.correcao(l, { etiquetas: [] }, '2027-03-20'), { etiquetas: [] }, 'tirar todas também é mudança');
});

caso('lançamento', 'a compra parcelada é N parcelas iguais, sem linha-mãe', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Cartão', tipo: 'cartao' });

  // 10× de R$ 299,00 — o valor digitado é o da PARCELA (03-alimentacao §6.1).
  const compraId = 'cmp1';
  for (let i = 0; i < 10; i += 1) {
    const mes = String(10 + i).padStart(2, '0');
    const ano = 2027 + (10 + i > 12 ? 1 : 0);
    const dia = `${ano}-${String(((9 + i) % 12) + 1).padStart(2, '0')}-05`;
    await estado.aplicarEvento('lancamento.registrado', {
      id: 'l' + i, tipo: 'despesa', valor: 29900, contaId: 'c1', categoriaId: 'k1',
      dataCompetencia: dia, dataCaixa: dia, confirmado: i === 0,
      parcela: { compraId, numero: i + 1, total: 10 },
    });
    void mes;
  }

  const e = await estado.calcular();
  const daCompra = lanc.visiveis(e).filter((l) => l.parcela?.compraId === compraId);
  igual(daCompra.length, 10, 'dez parcelas, e nenhuma linha-mãe com o total');
  igual(daCompra.reduce((t, l) => t + l.valor, 0), 299000, 'o total é a soma, não um campo');
  igual(lanc.saldoReal(e, 'c1'), -29900,
    'só a parcela confirmada mexeu no saldo — as nove seguintes são compromisso, não gasto');
  verdade(
    new Set(daCompra.map((l) => l.dataCompetencia.slice(0, 7))).size === 10,
    'cada parcela no SEU mês de competência, senão a R2 veria um pico que não houve'
  );
});

caso('estado', 'a recorrência é entidade separada do lançamento que ela gera', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('recorrencia.criada', {
    id: 'r1', nome: 'Energia', tipo: 'despesa', contaId: 'c1', categoriaId: 'k1',
    tipoValor: 'variavel', periodicidade: 'mensal', dia: 10, inicio: '2027-03-10',
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l1', tipo: 'despesa', valor: 28700, contaId: 'c1', categoriaId: 'k1',
    dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', confirmado: true,
    recorrenciaId: 'r1',
  });

  const e = await estado.calcular();
  igual(e.recorrencias.r1.tipoValor, 'variavel', 'estimada = média das últimas 3 (E2)');
  igual(e.recorrencias.r1.valor, null, 'variável não trava valor');
  igual(e.lancamentos.l1.recorrenciaId, 'r1', 'e o lançamento sabe de que série nasceu');

  // Apagar o lançamento não apaga a série: ela existe sozinha, e é o que
  // permite projetar o mês que vem mesmo sem ninguém ter lançado nada.
  await estado.aplicarEvento('lancamento.removido', { id: 'l1' });
  const depois = await estado.calcular();
  verdade(depois.recorrencias.r1, 'a série continua de pé');
});

caso('lançamento', 'as três datas existem mesmo quando são iguais', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l1', tipo: 'despesa', contaId: 'c1', valor: 1000, dataCompetencia: '2027-03-10',
  });
  const l = (await estado.calcular()).lancamentos.l1;
  igual([l.dataCompetencia, l.dataCaixa, l.dataVencimento],
    ['2027-03-10', '2027-03-10', '2027-03-10'],
    'as três sempre preenchidas: é o que faz a visão dupla do cartão não ter caso especial');
});

caso('lançamento', 'o detalhe é sugerido pela categoria, do mais usado ao menos', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('categoria.criada', { id: 'k1', nome: 'Supermercado', pai: null });
  await estado.aplicarEvento('categoria.criada', { id: 'k2', nome: 'Combustível', pai: null });
  await estado.aplicarEvento('detalhe.criado', { id: 'd1', nome: 'Mercado do bairro' });
  await estado.aplicarEvento('detalhe.criado', { id: 'd2', nome: 'Atacadão' });
  await estado.aplicarEvento('detalhe.criado', { id: 'd3', nome: 'Posto da estrada' });

  const compra = (id, categoriaId, detalheId) =>
    estado.aplicarEvento('lancamento.registrado', {
      id, tipo: 'despesa', valor: 1000, contaId: 'c1', categoriaId, detalheId,
      dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', confirmado: true,
    });

  await compra('l1', 'k1', 'd2');
  await compra('l2', 'k1', 'd1');
  await compra('l3', 'k1', 'd1');
  await compra('l4', 'k2', 'd3');

  const e = await estado.calcular();
  igual(lanc.detalhesDaCategoria(e, 'k1').map((d) => d.nome), ['Mercado do bairro', 'Atacadão'],
    'em Supermercado aparecem os mercados, o mais usado na frente');
  igual(lanc.detalhesDaCategoria(e, 'k2').map((d) => d.nome), ['Posto da estrada'],
    'e o posto não polui a lista do supermercado — é isso que a E3 pede');
});

caso('lançamento', 'categoria com grupo mostra o caminho', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('categoria.criada', { id: 'g1', nome: 'Alimentação', pai: null });
  await estado.aplicarEvento('categoria.criada', { id: 'k1', nome: 'Supermercado', pai: 'g1' });
  await estado.aplicarEvento('categoria.criada', { id: 'k2', nome: 'Sem grupo ainda', pai: null });

  const e = await estado.calcular();
  igual(lanc.nomeDaCategoria(e, 'k1'), 'Alimentação · Supermercado');
  igual(lanc.nomeDaCategoria(e, 'k2'), 'Sem grupo ainda');
});

caso('estado', 'apagar um grupo não deixa as filhas penduradas', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('categoria.criada', { id: 'g1', nome: 'Alimentação', pai: null });
  await estado.aplicarEvento('categoria.criada', { id: 'k1', nome: 'Supermercado', pai: 'g1' });
  await estado.aplicarEvento('categoria.removida', { id: 'g1' });

  const e = await estado.calcular();
  igual(e.categorias.g1, undefined);
  igual(e.categorias.k1.pai, null, 'a filha volta a ser categoria solta, não aponta pro vazio');
  igual(lanc.nomeDaCategoria(e, 'k1'), 'Supermercado');
});

caso('listas', 'o uso de cada item fica à vista', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Banco', tipo: 'corrente' });
  await estado.aplicarEvento('categoria.criada', { id: 'k1', nome: 'Supermercado', pai: null });
  await estado.aplicarEvento('etiqueta.criada', { id: 't1', nome: 'carro' });
  const comum = { tipo: 'despesa', contaId: 'c1', categoriaId: 'k1', dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10' };

  await estado.aplicarEvento('lancamento.registrado', { id: 'l1', ...comum, valor: 1000, etiquetas: ['t1'] });
  await estado.aplicarEvento('lancamento.registrado', { id: 'l2', ...comum, valor: 2000 });
  await estado.aplicarEvento('lancamento.registrado', { id: 'l3', ...comum, valor: 3000 });
  await estado.aplicarEvento('lancamento.removido', { id: 'l3' });

  const u = listas.usos(await estado.calcular());
  igual(u.categorias.get('k1'), 2, 'o que foi apagado não conta no uso');
  igual(u.contas.get('c1'), 2);
  igual(u.etiquetas.get('t1'), 1);
});

caso('listas', 'o dono da conta vira pessoa, e "Maria" não é outro que "maria"', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('pessoa.criada', { id: 'p1', nome: 'Maria' });

  const e = await estado.calcular();
  igual(listas.acharPorNome(e.pessoas, 'maria')?.id, 'p1', 'caixa diferente é a mesma pessoa');
  igual(listas.acharPorNome(e.pessoas, '  Maria  ')?.id, 'p1', 'espaço nas pontas não cria outra');
  igual(listas.acharPorNome(e.pessoas, 'Bruna'), null);
  igual(listas.acharPorNome(e.pessoas, '   '), null, 'nome vazio não acha ninguém');
});

caso('listas', 'item com histórico não se apaga — arquiva', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('categoria.criada', { id: 'k1', nome: 'Usada', pai: null });
  await estado.aplicarEvento('categoria.criada', { id: 'k2', nome: 'Nunca usada', pai: null });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l1', tipo: 'despesa', contaId: 'c1', categoriaId: 'k1', valor: 1000, dataCompetencia: '2027-03-10',
  });

  const e = await estado.calcular();
  igual(listas.podeRemover(e, 'categorias', 'k1'), { pode: false, motivo: 'tem histórico', usos: 1 },
    'apagar deixaria lançamento órfão');
  igual(listas.podeRemover(e, 'categorias', 'k2'), { pode: true, usos: 0 },
    'o que nunca foi usado sai sem cerimônia');
});

caso('listas', 'conta com saldo não se arquiva antes de resolver o saldo', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Banco', tipo: 'corrente', saldoInicial: 50000 });
  await estado.aplicarEvento('conta.criada', { id: 'c2', nome: 'Vazia', tipo: 'corrente', saldoInicial: 0 });

  const e = await estado.calcular();
  igual(listas.podeArquivarConta(e, 'c1').pode, false, 'conta guardada com dinheiro dentro faz o total mentir');
  igual(listas.podeArquivarConta(e, 'c1').saldo, 50000);
  igual(listas.podeArquivarConta(e, 'c2').pode, true);

  // Mas ela sai inteira enquanto ninguém a usou: nada fica órfão, e quem errou
  // o cadastro na primeira semana não fica num beco sem saída.
  igual(listas.podeRemover(e, 'contas', 'c1').pode, true);
});

caso('estado', 'etiqueta é lista própria, com a mesma manutenção das outras', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('etiqueta.criada', { id: 't1', nome: 'caro' });
  await estado.aplicarEvento('etiqueta.alterada', { id: 't1', nome: 'carro' });
  await estado.aplicarEvento('etiqueta.criada', { id: 't2', nome: 'casa' });
  await estado.aplicarEvento('etiqueta.arquivada', { id: 't2' });

  const e = await estado.calcular();
  igual(e.etiquetas.t1.nome, 'carro', 'renomear vale no passado inteiro: o lançamento aponta pro id');
  verdade(e.etiquetas.t2.arquivada, 'arquivada sai das telas de lançamento e segue nos relatórios');
});

caso('estado', 'corrigir o saldo inicial move o saldo dali pra frente', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Banco', tipo: 'corrente', saldoInicial: 100000 });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l1', tipo: 'despesa', contaId: 'c1', valor: 25000,
    dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', confirmado: true,
  });
  igual(lanc.saldoReal(await estado.calcular(), 'c1'), 75000);

  await estado.aplicarEvento('conta.saldoInicialCorrigido', { id: 'c1', saldoInicial: 120000 });
  igual(lanc.saldoReal(await estado.calcular(), 'c1'), 95000, 'o marco zero mudou, e todo o resto junto');

  // E não é a mesma porta do renomear: alterar a conta não mexe no marco zero.
  await estado.aplicarEvento('conta.alterada', { id: 'c1', nome: 'Banco da Maria', saldoInicial: 1 });
  const e = await estado.calcular();
  igual(e.contas.c1.nome, 'Banco da Maria');
  igual(e.contas.c1.saldoInicial, 120000, 'saldo histórico só muda por evento deliberado');
});

caso('estado', 'cache de forma antiga é descartado, não usado torto', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('categoria.criada', { id: 'k1', nome: 'Supermercado', pai: null });

  // Simula um cache gravado por uma versão anterior do app: forma antiga, sem
  // os campos que os redutores de hoje produzem. Aceitá-lo faria o app quebrar
  // num campo inexistente — foi exatamente o que aconteceu na vida real.
  const atual = await estado.calcular();
  await db.gravarMeta('consolidado', {
    formato: 1,
    formatoEstado: VERSAO_ESTADO - 1,
    ateLc: atual.ateLc,
    aplicados: atual.aplicados,
    estado: { pessoas: {}, contas: {}, desconhecidos: {} }, // sem categorias nem lançamentos
  });
  estado.invalidarMemoria();

  const e = await estado.calcular();
  igual(e.categorias.k1?.nome, 'Supermercado', 'recalculou do zero em vez de usar a forma velha');
  verdade(e.lancamentos !== undefined, 'e o estado veio completo');
});


// cartão ───────────────────────────────────────────────────────────────────

caso('cartão', 'a compra cai na fatura pelo dia do fechamento', () => {
  const fecha3 = { tipo: 'cartao', diaFechamento: 3, diaVencimento: 10 };
  igual(cartao.cicloDaCompra(fecha3, '2027-03-02'), { fechamento: '2027-03-03', vencimento: '2027-03-10' },
    'antes do fechamento: a fatura que fecha neste mês');
  igual(cartao.cicloDaCompra(fecha3, '2027-03-03'), { fechamento: '2027-04-03', vencimento: '2027-04-10' },
    'no dia do fechamento já é a seguinte — como os bancos fazem');
  igual(cartao.cicloDaCompra(fecha3, '2027-12-20'), { fechamento: '2028-01-03', vencimento: '2028-01-10' },
    'e atravessa o ano');

  const fecha28 = { tipo: 'cartao', diaFechamento: 28, diaVencimento: 5 };
  igual(cartao.cicloDaCompra(fecha28, '2027-03-10'), { fechamento: '2027-03-28', vencimento: '2027-04-05' },
    'vencimento menor que o fechamento vence no mês seguinte');

  const fecha31 = { tipo: 'cartao', diaFechamento: 31, diaVencimento: 8 };
  igual(cartao.cicloDaCompra(fecha31, '2027-02-15').fechamento, '2027-02-28',
    'dia 31 em fevereiro é o último dia de fevereiro');
  igual(cartao.cicloDaCompra(fecha31, '2027-02-28').fechamento, '2027-03-31');
});

caso('cartão', 'a compra guarda as três datas, e a parcela vai para as faturas seguintes', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', {
    id: 'c1', nome: 'Cartão', tipo: 'cartao', diaFechamento: 3, diaVencimento: 10,
  });
  // Como a captura sempre gravou: data da compra + i meses, e parcela futura
  // "não confirmada". É o cálculo do estado que põe cada uma na sua fatura.
  for (let i = 0; i < 3; i += 1) {
    const dia = datas.somarMeses('2027-03-20', i);
    await estado.aplicarEvento('lancamento.registrado', {
      id: 'l' + i, tipo: 'despesa', valor: 29900, contaId: 'c1', categoriaId: 'k1',
      dataCompetencia: dia, dataCaixa: dia, confirmado: i === 0,
      parcela: { compraId: 'cmp1', numero: i + 1, total: 3 },
    });
  }
  const e = await estado.calcular();
  const l0 = e.lancamentos.l0;
  igual([l0.dataCompetencia, l0.cicloFatura, l0.dataCaixa, l0.dataVencimento],
    ['2027-03-20', '2027-04-03', '2027-04-10', '2027-04-10'],
    'competência é a compra; caixa e vencimento são da fatura (D4)');
  igual(['l0', 'l1', 'l2'].map((id) => e.lancamentos[id].cicloFatura),
    ['2027-04-03', '2027-05-03', '2027-06-03'], 'uma parcela por fatura, em sequência');
  verdade(['l0', 'l1', 'l2'].every((id) => e.lancamentos[id].confirmado),
    'a parcela é realizada: a compra aconteceu, o que falta é o pagamento');
  igual(lanc.saldoReal(e, 'c1'), -89700, 'a dívida do cartão é a compra inteira');
});

caso('cartão', 'compra lançada antes do ciclo cai na fatura quando o ciclo é definido', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'c1', nome: 'Cartão', tipo: 'cartao' });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'l1', tipo: 'despesa', valor: 5000, contaId: 'c1', categoriaId: 'k1',
    dataCompetencia: '2027-03-20', dataCaixa: '2027-03-20', confirmado: true,
  });
  let e = await estado.calcular();
  igual([e.lancamentos.l1.cicloFatura, e.lancamentos.l1.dataCaixa], [null, '2027-03-20'],
    'sem ciclo, a compra pesa no dia em que foi feita');

  await estado.aplicarEvento('conta.alterada', { id: 'c1', diaFechamento: 3, diaVencimento: 10 });
  e = await estado.calcular();
  igual([e.lancamentos.l1.cicloFatura, e.lancamentos.l1.dataCaixa], ['2027-04-03', '2027-04-10'],
    'definido o ciclo, ela vai pra fatura certa sem evento novo nela');

  const doZero = await estado.recalcular();
  igual(doZero.lancamentos.l1, e.lancamentos.l1, 'e o recálculo do zero chega no mesmo lugar');
});

caso('cartão', 'mudar o fechamento refaz só as faturas que ainda não fecharam', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', {
    id: 'c1', nome: 'Cartão', tipo: 'cartao', diaFechamento: 3, diaVencimento: 10,
  });
  const compra = (id, dia) => estado.aplicarEvento('lancamento.registrado', {
    id, tipo: 'despesa', valor: 1000, contaId: 'c1', categoriaId: 'k1',
    dataCompetencia: dia, dataCaixa: dia, confirmado: true,
  });
  await compra('antiga', '2020-01-10');
  await compra('futura', '2099-01-10');
  await estado.aplicarEvento('conta.alterada', { id: 'c1', diaFechamento: 15, diaVencimento: 22 });

  const e = await estado.calcular();
  igual(e.lancamentos.antiga.cicloFatura, '2020-02-03', 'fatura fechada é passado: o banco também não a refaz');
  igual(e.lancamentos.futura.cicloFatura, '2099-01-15', 'a que ainda não fechou segue o ciclo novo');
  const antiga = previsto.faturas(e, 'c1', '2050-01-01').find((f) => f.fechamento === '2020-02-03');
  igual(antiga.vencimento, '2020-02-10', 'e a fatura fechada continua vencendo quando vencia, não no dia novo');
});

caso('cartão', 'corrigir a data no cartão corrige a compra', () => {
  const l = {
    valor: 1000, confirmado: true, cicloFatura: '2027-04-03',
    dataCompetencia: '2027-03-20', dataCaixa: '2027-04-10', dataVencimento: '2027-04-10',
  };
  igual(lanc.correcao(l, { dataCaixa: '2027-03-21' }, '2027-03-25'), { dataCompetencia: '2027-03-21' },
    'a data que se vê no cartão é a da compra; caixa e vencimento o ciclo refaz');
  igual(lanc.correcao(l, { dataCaixa: '2027-03-20' }, '2027-03-25'), {}, 'mesma compra, nada mudou');
});

caso('cartão', 'o pagamento quita a fatura mais antiga primeiro', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'k1', nome: 'Corrente', tipo: 'corrente', saldoInicial: 100000 });
  await estado.aplicarEvento('conta.criada', {
    id: 'c1', nome: 'Cartão', tipo: 'cartao', diaFechamento: 3, diaVencimento: 10, pagaCom: 'k1',
  });
  const compra = (id, dia, valor) => estado.aplicarEvento('lancamento.registrado', {
    id, tipo: 'despesa', valor, contaId: 'c1', categoriaId: 'x',
    dataCompetencia: dia, dataCaixa: dia, confirmado: true,
  });
  await compra('a', '2027-02-20', 10000); // fecha 03/03
  await compra('b', '2027-03-20', 5000); // fecha 03/04

  let e = await estado.calcular();
  let f = previsto.faturas(e, 'c1', '2027-03-25');
  igual(f.map((c) => [c.fechamento, c.situacao, c.aPagar]),
    [['2027-03-03', 'fechada', 10000], ['2027-04-03', 'aberta', 5000]]);

  await estado.aplicarEvento('lancamento.registrado', {
    id: 'p1', tipo: lanc.tipoDaTransferencia(e, 'c1'), valor: 6000, contaId: 'k1', contaDestinoId: 'c1',
    dataCompetencia: '2027-03-08', dataCaixa: '2027-03-08', confirmado: true,
  });
  e = await estado.calcular();
  igual(e.lancamentos.p1.tipo, 'pagamento_fatura', 'transferir para o cartão é pagar a fatura');
  f = previsto.faturas(e, 'c1', '2027-03-25');
  igual(f.map((c) => c.aPagar), [4000, 5000], 'pagou menos que a fechada: o resto continua nela (rotativo)');
  const r = previsto.resumoDoCartao(e, 'c1', '2027-03-25');
  igual([r.fechada.aPagar, r.fechada.atrasada, r.aberta.aPagar], [4000, true, 5000]);

  await estado.aplicarEvento('lancamento.registrado', {
    id: 'p2', tipo: 'pagamento_fatura', valor: 6000, contaId: 'k1', contaDestinoId: 'c1',
    dataCompetencia: '2027-03-26', dataCaixa: '2027-03-26', confirmado: true,
  });
  e = await estado.calcular();
  f = previsto.faturas(e, 'c1', '2027-03-26');
  igual(f.map((c) => c.aPagar), [0, 3000], 'pagou mais: a sobra abate a aberta');
  igual(lanc.saldoReal(e, 'k1'), 88000, 'pagamento mexe na corrente e não é despesa');
});

caso('cartão', 'o saldo já na fatura quando o cartão entrou no app conta como dívida', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', {
    id: 'c1', nome: 'Cartão', tipo: 'cartao', diaFechamento: 3, diaVencimento: 10,
    saldoInicial: -45000, dataInicial: '2027-03-10',
  });
  const f = previsto.faturas(await estado.calcular(), 'c1', '2027-03-12');
  igual(f.map((c) => [c.fechamento, c.aPagar]), [['2027-04-03', 45000]], 'entra na fatura aberta do dia');
});

caso('previsto', 'saldo previsto = real − faturas − recorrentes e agendados', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const dia = '2027-03-10';
  await estado.aplicarEvento('conta.criada', { id: 'k1', nome: 'Corrente', tipo: 'corrente', saldoInicial: 100000 });
  await estado.aplicarEvento('conta.criada', {
    id: 'c1', nome: 'Cartão', tipo: 'cartao', diaFechamento: 3, diaVencimento: 10, pagaCom: 'k1',
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'compra', tipo: 'despesa', valor: 20000, contaId: 'c1', categoriaId: 'x',
    dataCompetencia: '2027-03-05', dataCaixa: '2027-03-05', confirmado: true,
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'boleto', tipo: 'despesa', valor: 5000, contaId: 'k1', categoriaId: 'x',
    dataCompetencia: '2027-03-20', dataCaixa: '2027-03-20', confirmado: false,
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'salario', tipo: 'receita', valor: 300000, contaId: 'k1', categoriaId: 'y',
    dataCompetencia: '2027-03-30', dataCaixa: '2027-03-30', confirmado: false,
  });
  await estado.aplicarEvento('recorrencia.criada', {
    id: 'r1', nome: 'Plano', tipo: 'despesa', contaId: 'k1', categoriaId: 'x',
    tipoValor: 'fixa', valor: 15000, dia: 25, inicio: '2027-01-25',
  });

  let e = await estado.calcular();
  let p = previsto.saldoPrevisto(e, 'k1', dia);
  igual([p.real, p.faturas.map((f) => f.valor), p.aSair, p.previsto, p.ate],
    [100000, [20000], 20000, 60000, '2027-03-31'],
    'a fatura aberta pesa mesmo vencendo em abril; receita futura não entra');

  // Lançada a ocorrência do mês, ela deixa de ser prevista.
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'plano-mar', tipo: 'despesa', valor: 15000, contaId: 'k1', categoriaId: 'x',
    dataCompetencia: '2027-03-25', dataCaixa: '2027-03-25', confirmado: false, recorrenciaId: 'r1',
  });
  e = await estado.calcular();
  p = previsto.saldoPrevisto(e, 'k1', dia);
  igual(p.aSair, 20000, 'virou agendado: conta uma vez só, não duas');
  igual(previsto.ocorrenciasPrevistas(e, '2027-03-01', '2027-04-30', dia).map((o) => o.dataCaixa),
    ['2027-04-25'], 'e a próxima ocorrência é a de abril');
});

caso('previsto', 'recorrência estimada projeta a média das últimas 3', () => {
  const r = { tipoValor: 'variavel', valor: null };
  const serie = [
    { valor: 30000, dataCompetencia: '2027-01-10' },
    { valor: 27000, dataCompetencia: '2027-02-10' },
    { valor: 28000, dataCompetencia: '2027-03-10' },
    { valor: 99999, dataCompetencia: '2026-12-10' },
  ];
  igual(previsto.valorDaSerie(r, serie), { valor: 28333, estimado: true },
    'só as três mais recentes, e sempre marcada como estimativa');
  igual(previsto.valorDaSerie({ tipoValor: 'fixa', valor: 15000 }, serie), { valor: 15000, estimado: false });
});

caso('previsto', 'mês que passou sem lançamento não é projetado', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'k1', nome: 'Corrente', tipo: 'corrente' });
  await estado.aplicarEvento('recorrencia.criada', {
    id: 'r1', nome: 'Plano', tipo: 'despesa', contaId: 'k1', categoriaId: 'x',
    tipoValor: 'fixa', valor: 15000, dia: 5, inicio: '2027-01-05',
  });
  const e = await estado.calcular();
  igual(previsto.ocorrenciasPrevistas(e, '2027-01-01', '2027-03-31', '2027-03-10').map((o) => o.dataCaixa),
    ['2027-03-05'], 'janeiro e fevereiro são assunto da fila de vencidos, não da projeção');
});

// ── apoio ─────────────────────────────────────────────────────────────────

async function limpar() {
  db.usarBanco(BANCO_DE_TESTE);
  await db.apagarTudo();
  estado.invalidarMemoria();
}

/** Tira do estado o que muda a cada execução, pra poder comparar. */
function limpo(e) {
  const { aplicados, ...resto } = e;
  void aplicados;
  return resto;
}

// ── execução ──────────────────────────────────────────────────────────────

export async function rodar({ aoAndar } = {}) {
  const bancoReal = db.bancoEmUso();
  const resultados = [];

  for (const c of casos) {
    const inicio = performance.now();
    try {
      await c.fn();
      resultados.push({ ...c, passou: true, ms: performance.now() - inicio });
    } catch (e) {
      resultados.push({
        ...c, passou: false, ms: performance.now() - inicio,
        erro: e instanceof Falha ? e.message : `${e.name}: ${e.message}`,
      });
    }
    if (aoAndar) aoAndar(resultados[resultados.length - 1], resultados.length, casos.length);
  }

  // Deixa o banco de teste fora do caminho e devolve o app ao banco de verdade.
  db.usarBanco(BANCO_DE_TESTE);
  await db.apagarTudo();
  db.usarBanco(bancoReal);
  estado.invalidarMemoria();

  return {
    resultados,
    total: resultados.length,
    passaram: resultados.filter((r) => r.passou).length,
  };
}

export const quantidadeDeCasos = casos.length;
