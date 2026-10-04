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
import * as pendencias from '../core/pendencias.js';
import { categoriaNaArea, areasParaConta } from '../app/areas.js';
import * as holerite from '../core/holerite.js';
import * as divida from '../core/divida.js';
import * as investimentos from '../core/investimentos.js';
import * as envelopes from '../core/envelopes.js';
import * as relatorios from '../core/relatorios.js';
import * as automaticas from '../core/automaticas.js';

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
  igual(previsto.valorDaSerie(r, serie), { valor: 28333, estimado: true, origem: 'estimado_media' },
    'só as três mais recentes, e sempre marcada como estimativa');
  igual(previsto.valorDaSerie({ tipoValor: 'fixa', valor: 15000 }, serie), { valor: 15000, estimado: false, origem: 'digitado' });
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


// estorno, fusão, pendências ───────────────────────────────────────────────

caso('estorno', 'devolução abate a compra no mês dela e sobe o saldo quando voltou', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'k1', nome: 'Corrente', tipo: 'corrente', saldoInicial: 100000 });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'compra', tipo: 'despesa', valor: 30000, contaId: 'k1', categoriaId: 'x',
    dataCompetencia: '2027-10-20', dataCaixa: '2027-10-20', confirmado: true,
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'dev', tipo: 'estorno', valor: 12000, contaId: 'k1', categoriaId: 'x', estornoDe: 'compra',
    dataCompetencia: '2027-10-20', dataCaixa: '2027-11-05', devolvidoEm: '2027-11-05', confirmado: true,
  });
  const e = await estado.calcular();
  igual([e.lancamentos.dev.dataCompetencia, e.lancamentos.dev.dataCaixa], ['2027-10-20', '2027-11-05'],
    'competência da compra (outubro volta a ser verdade), caixa de quando voltou');
  igual(lanc.saldoReal(e, 'k1'), 82000, 'o saldo sobe com o que voltou');
  igual(lanc.estornado(e, 'compra'), 12000);
  igual(lanc.restanteEstornavel(e, 'compra'), 18000, 'nunca mais que a compra');
});

caso('estorno', 'no cartão a devolução cai na fatura em formação', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', {
    id: 'c1', nome: 'Cartão', tipo: 'cartao', diaFechamento: 3, diaVencimento: 10,
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'compra', tipo: 'despesa', valor: 30000, contaId: 'c1', categoriaId: 'x',
    dataCompetencia: '2027-10-20', dataCaixa: '2027-10-20', confirmado: true,
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'dev', tipo: 'estorno', valor: 30000, contaId: 'c1', categoriaId: 'x', estornoDe: 'compra',
    dataCompetencia: '2027-10-20', dataCaixa: '2027-11-15', devolvidoEm: '2027-11-15', confirmado: true,
  });
  const e = await estado.calcular();
  igual(e.lancamentos.dev.cicloFatura, '2027-12-03', 'a fatura de quando o dinheiro voltou, não a da compra');
  const f = previsto.faturas(e, 'c1', '2027-11-20');
  igual(f.map((c) => [c.fechamento, c.aPagar]), [['2027-11-03', 0], ['2027-12-03', 0]],
    'a fechada ficou paga pelo crédito da devolução');
});

caso('fusão', 'fundir categoria leva o histórico e se desfaz', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('categoria.criada', { id: 'a', nome: 'Mercado' });
  await estado.aplicarEvento('categoria.criada', { id: 'b', nome: 'Supermercado' });
  for (const id of ['l1', 'l2']) {
    await estado.aplicarEvento('lancamento.registrado', {
      id, tipo: 'despesa', valor: 1000, contaId: 'k', categoriaId: 'a',
      dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', confirmado: true,
    });
  }
  await estado.aplicarEvento('categoria.fundida', { id: 'f1', de: 'a', para: 'b' });
  let e = await estado.calcular();
  verdade(!e.categorias.a, 'a de origem some');
  igual([e.lancamentos.l1.categoriaId, e.lancamentos.l2.categoriaId], ['b', 'b'], 'o histórico vai junto');

  await estado.aplicarEvento('fusao.desfeita', { id: 'f1' });
  e = await estado.calcular();
  igual(e.categorias.a?.nome, 'Mercado', 'desfazer devolve a categoria');
  igual([e.lancamentos.l1.categoriaId, e.lancamentos.l2.categoriaId], ['a', 'a'], 'e os lançamentos dela');
  const doZero = await estado.recalcular();
  igual(doZero.lancamentos.l1.categoriaId, 'a', 'e o recálculo do zero concorda');
});

caso('fusão', 'fundir etiqueta não duplica quem já tinha as duas', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('etiqueta.criada', { id: 'a', nome: 'carro' });
  await estado.aplicarEvento('etiqueta.criada', { id: 'b', nome: 'Carro' });
  const lanca = (id, etiquetas) => estado.aplicarEvento('lancamento.registrado', {
    id, tipo: 'despesa', valor: 1000, contaId: 'k', categoriaId: 'x', etiquetas,
    dataCompetencia: '2027-03-10', dataCaixa: '2027-03-10', confirmado: true,
  });
  await lanca('so-a', ['a']);
  await lanca('as-duas', ['a', 'b']);
  await estado.aplicarEvento('etiqueta.fundida', { id: 'f1', de: 'a', para: 'b' });
  let e = await estado.calcular();
  igual([e.lancamentos['so-a'].etiquetas, e.lancamentos['as-duas'].etiquetas], [['b'], ['b']]);
  await estado.aplicarEvento('fusao.desfeita', { id: 'f1' });
  e = await estado.calcular();
  igual([e.lancamentos['so-a'].etiquetas, [...e.lancamentos['as-duas'].etiquetas].sort()], [['a'], ['a', 'b']],
    'desfazer devolve cada um como era');
});

caso('previsto', 'receita estimada pelo piso, despesa pela média (E2)', () => {
  const serie = [
    { valor: 500000, dataCompetencia: '2027-01-05' },
    { valor: 420000, dataCompetencia: '2027-02-05' },
    { valor: 610000, dataCompetencia: '2027-03-05' },
  ];
  igual(previsto.valorDaSerie({ tipo: 'receita', tipoValor: 'variavel' }, serie).valor, 420000,
    'receita: a menor das últimas — subestimar a entrada é prudência');
  igual(previsto.valorDaSerie({ tipo: 'despesa', tipoValor: 'variavel' }, serie).valor, 510000,
    'despesa: a média');
});

caso('pendências', 'a fila junta vencidos, ocorrências esquecidas, fatura vencida e conta sem conferir', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const dia = '2027-03-20';
  await estado.aplicarEvento('conta.criada', {
    id: 'k1', nome: 'Corrente', tipo: 'corrente', saldoInicial: 100000, dataInicial: '2027-01-01',
  });
  await estado.aplicarEvento('conta.criada', {
    id: 'c1', nome: 'Cartão', tipo: 'cartao', diaFechamento: 3, diaVencimento: 10, pagaCom: 'k1',
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'boleto', tipo: 'despesa', valor: 5000, contaId: 'k1', categoriaId: 'x',
    dataCompetencia: '2027-03-15', dataCaixa: '2027-03-15', confirmado: false,
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'compra', tipo: 'despesa', valor: 8000, contaId: 'c1', categoriaId: 'x',
    dataCompetencia: '2027-02-10', dataCaixa: '2027-02-10', confirmado: true,
  });
  await estado.aplicarEvento('recorrencia.criada', {
    id: 'r1', nome: 'Plano', tipo: 'despesa', contaId: 'k1', categoriaId: 'x',
    tipoValor: 'fixa', valor: 15000, dia: 5, inicio: '2027-02-05',
  });
  let e = await estado.calcular();
  let fila = pendencias.pendencias(e, dia);
  igual(fila.map((i) => i.tipo), ['conferir', 'ocorrencia', 'ocorrencia', 'fatura', 'vencido'],
    'da mais antiga para a mais nova');

  // Resolver cada um tira da fila.
  await estado.aplicarEvento('recorrencia.pulada', { id: 'r1', mes: '2027-02' });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'plano-mar', tipo: 'despesa', valor: 15000, contaId: 'k1', categoriaId: 'x', recorrenciaId: 'r1',
    dataCompetencia: '2027-03-05', dataCaixa: '2027-03-05', confirmado: true,
  });
  await estado.aplicarEvento('lancamento.alterado', { id: 'boleto', confirmado: true });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'pag', tipo: 'pagamento_fatura', valor: 8000, contaId: 'k1', contaDestinoId: 'c1',
    dataCompetencia: '2027-03-18', dataCaixa: '2027-03-18', confirmado: true,
  });
  await estado.aplicarEvento('conta.conferida', { id: 'k1', data: dia, saldoInformado: 72000, bateu: true });
  e = await estado.calcular();
  fila = pendencias.pendencias(e, dia);
  igual(fila, [], 'nada mais a fazer');
  igual(e.contas.k1.conferidaEm, dia, 'conferida em');
});


caso('categoria', 'a categoria aparece só nas áreas dela (D26)', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('categoria.criada', { id: 'mer', nome: 'Supermercado' });
  await estado.aplicarEvento('categoria.criada', {
    id: 'ir', nome: 'IR', natureza: 'despesa', areas: ['folha'], obrigatoria: true,
  });
  await estado.aplicarEvento('categoria.criada', { id: 'sau', nome: 'Saúde', areas: ['caixa', 'cartoes', 'folha'] });
  const e = await estado.calcular();
  const corrente = { tipo: 'corrente' };
  const folha = { tipo: 'folha' };
  igual(e.categorias.mer.areas, ['caixa', 'cartoes'], 'categoria antiga, ou criada sem dizer, é do dia a dia');
  igual(['mer', 'ir', 'sau'].filter((id) => categoriaNaArea(e.categorias[id], corrente)), ['mer', 'sau'],
    'na corrente, IR não existe');
  igual(['mer', 'ir', 'sau'].filter((id) => categoriaNaArea(e.categorias[id], folha)), ['ir', 'sau'],
    'na folha, supermercado não existe');
  verdade(e.categorias.ir.obrigatoria, 'IR é obrigatória: fora de gasto');
  igual(areasParaConta(folha), ['folha'], 'criada lançando na folha, é da folha');

  await estado.aplicarEvento('categoria.alterada', { id: 'mer', areas: ['caixa'] });
  igual((await estado.calcular()).categorias.mer.areas, ['caixa'], 'e muda quando se muda');
});


caso('folha', 'o holerite traz as linhas do mês, e o líquido zera a folha', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const ev = (t, d) => estado.aplicarEvento(t, d);
  await ev('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente' });
  await ev('conta.criada', { id: 'emp', nome: 'Consignado', tipo: 'divida' });
  await ev('conta.criada', { id: 'fo', nome: 'Folha', tipo: 'folha', liquidoPara: 'cc' });
  await ev('categoria.criada', { id: 'sal', nome: 'Salário base', natureza: 'receita', areas: ['folha'] });
  await ev('categoria.criada', { id: 'ir', nome: 'IR', natureza: 'despesa', areas: ['folha'], obrigatoria: true });
  await ev('categoria.criada', { id: 'sau', nome: 'Saúde', natureza: 'despesa', areas: ['caixa', 'folha'] });
  const serie = (id, d) => ev('recorrencia.criada', { id, contaId: 'fo', tipoValor: 'fixa', dia: 1, inicio: '2027-01-01', ...d });
  await serie('r-con', { tipo: 'transferencia', contaDestinoId: 'emp', valor: 60000 });
  await serie('r-sau', { tipo: 'despesa', categoriaId: 'sau', valor: 40000 });
  await serie('r-ir', { tipo: 'despesa', categoriaId: 'ir', valor: 100000 });
  await serie('r-sal', { tipo: 'receita', categoriaId: 'sal', valor: 820000 });

  let e = await estado.calcular();
  const linhas = holerite.linhasDoHolerite(e, 'fo', '2027-03', '2027-03-05');
  igual(linhas.map((l) => l.recorrenciaId), ['r-sal', 'r-ir', 'r-sau', 'r-con'],
    'a ordem do papel: entra, obrigatório, o resto, outras contas');
  igual(holerite.liquido(linhas), 620000, '8.200 − 1.000 − 400 − 600');

  for (const l of linhas) {
    await ev('lancamento.registrado', { ...l, id: 'l-' + l.recorrenciaId, confirmado: true, projetado: undefined });
  }
  await ev('lancamento.registrado', {
    id: 'liq', tipo: 'transferencia', valor: 620000, contaId: 'fo', contaDestinoId: 'cc',
    dataCompetencia: '2027-03-01', dataCaixa: '2027-03-01', confirmado: true,
  });
  e = await estado.calcular();
  igual(lanc.saldoReal(e, 'fo'), 0, 'a folha zera: é a conferência (D25)');
  igual(lanc.saldoReal(e, 'cc'), 620000, 'na corrente, uma linha só: o líquido');
  igual(holerite.linhasDoHolerite(e, 'fo', '2027-03', '2027-03-05'), [], 'nada mais a lançar em março');
  igual(holerite.rendaDisponivel(e, lanc.visiveis(e)), 720000,
    'renda disponível desconta só o obrigatório: o plano de saúde é gasto, não imposto');
});


caso('dívida', 'a taxa embutida no contrato sai do valor, das parcelas e da prestação', () => {
  const pv = 5000000;
  const i = 0.0182;
  const n = 42;
  const pmt = Math.round((pv * i) / (1 - (1 + i) ** -n));
  const achada = divida.taxaImplicita(pv, n, pmt);
  verdade(Math.abs(achada - i) < 0.00001, `achou ${achada}, esperava ${i}`);
  igual(divida.taxaImplicita(pv, n, Math.floor(pv / n)), 0, 'parcela que nem paga o valor não tem taxa');
});

caso('dívida', 'o saldo devedor: estimado pelo contrato, e a foto do banco manda', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const contrato = {
    valorTomado: 1200000, data: '2027-01-01', parcelas: 12, valorParcela: 110000, primeira: '2027-01-10', taxa: null,
  };
  await estado.aplicarEvento('conta.criada', { id: 'emp', nome: 'Empréstimo', tipo: 'divida', contrato });
  let e = await estado.calcular();
  let s = divida.situacao(e, 'emp', '2027-04-15');
  igual([s.parcelasPagas, s.restantes, s.somaRestante], [4, 8, 880000], '4 parcelas venceram, faltam 8');
  igual(s.origemTaxa, 'implicita', 'sem taxa informada nem fotos, a embutida no contrato');
  verdade(s.estimado && s.saldoDevedor > 0 && s.saldoDevedor < 1200000, 'estimado pelo calendário');
  igual(s.termina, '2027-12-10');
  igual(s.jurosFuturos, s.somaRestante - s.saldoDevedor, 'os dois quanto-falta da D22');

  await estado.aplicarEvento('conta.fotografada', { id: 'emp', data: '2027-04-15', valor: 900000 });
  e = await estado.calcular();
  s = divida.situacao(e, 'emp', '2027-04-15');
  igual([s.saldoDevedor, s.estimado], [900000, false], 'no dia da foto, o número do banco, sem ~');
  const depois = divida.situacao(e, 'emp', '2027-05-15');
  verdade(depois.estimado && depois.saldoDevedor < 900000, 'depois da foto, estima a partir dela');
});

caso('dívida', 'a taxa observada entre duas fotos (D24)', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', saldoInicial: 1000000 });
  await estado.aplicarEvento('conta.criada', {
    id: 'emp', nome: 'Empréstimo', tipo: 'divida', foto: { data: '2027-01-01', valor: 1000000 },
    contrato: { valorTomado: 1000000, data: '2027-01-01', parcelas: 10, valorParcela: 120000, primeira: '2027-02-01', taxa: null },
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'p1', tipo: 'transferencia', valor: 120000, contaId: 'cc', contaDestinoId: 'emp',
    dataCompetencia: '2027-02-01', dataCaixa: '2027-02-01', confirmado: true,
  });
  // Pagou 1.200, o saldo caiu 1.000: 200 foram juros, em um mês sobre 10.000 → 2%.
  await estado.aplicarEvento('conta.fotografada', { id: 'emp', data: '2027-02-01', valor: 900000 });
  const e = await estado.calcular();
  const s = divida.situacao(e, 'emp', '2027-02-01');
  igual(s.origemTaxa, 'observada');
  verdade(Math.abs(s.taxa - 0.02) < 0.001, `taxa ${s.taxa}`);
});


caso('previsto', 'reajuste: cada mês com o valor que valia nele', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'k1', nome: 'Corrente', tipo: 'corrente' });
  await estado.aplicarEvento('recorrencia.criada', {
    id: 'alug', nome: 'Aluguel', tipo: 'despesa', contaId: 'k1', categoriaId: 'x',
    tipoValor: 'fixa', valor: 60000, dia: 5, inicio: '2027-01-05',
  });
  await estado.aplicarEvento('recorrencia.reajustada', { id: 'alug', desde: '2027-04-05', valor: 70000 });
  let e = await estado.calcular();
  const valores = () => previsto
    .ocorrenciasPrevistas(e, '2027-01-01', '2027-06-30', '2027-01-01')
    .map((o) => o.valor / 100);
  igual(valores(), [600, 600, 600, 700, 700, 700], 'antes do reajuste, o valor antigo; depois, o novo');
  igual(e.recorrencias.alug.valores.map((v) => v.desde), ['2027-01-05', '2027-04-05'], 'a história fica guardada');

  await estado.aplicarEvento('recorrencia.alterada', { id: 'alug', valor: 72000 });
  e = await estado.calcular();
  igual(valores(), [600, 600, 600, 720, 720, 720], 'corrigir mexe no valor vigente, não na história');
});

caso('dívida', 'os juros de cada parcela, pelo contrato', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', {
    id: 'emp', nome: 'Empréstimo', tipo: 'divida',
    contrato: { valorTomado: 1000000, data: '2027-01-01', parcelas: 12, valorParcela: 94560, primeira: '2027-02-01', taxa: 0.02 },
  });
  const e = await estado.calcular();
  igual(divida.jurosDaParcela(e, 'emp', 1), 20000, 'a primeira: 2% sobre os R$ 10.000,00 tomados');
  verdade(divida.jurosDaParcela(e, 'emp', 12) < divida.jurosDaParcela(e, 'emp', 2), 'e diminui conforme a dívida cai');
});

// O empréstimo das verificações abaixo: 12 parcelas de R$ 1.000,00 a partir de
// 10/10/2024, incluído no app em 15/01/2025 — tudo no passado, para o teste
// não depender do dia em que roda. O mês da inclusão conta inteiro: a parcela
// de 10/01 cai.
const EMPRESTIMO = {
  valorTomado: 1000000, data: '2024-09-10', parcelas: 12, valorParcela: 100000,
  primeira: '2024-10-10', taxa: 0.02, incluidoEm: '2025-01-15',
};

async function comEmprestimo(pagaCom = 'cc', extra = {}) {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', saldoInicial: 2000000, dataInicial: '2025-01-01' });
  await estado.aplicarEvento('conta.criada', {
    id: 'emp', nome: 'Empréstimo', tipo: 'divida', dataInicial: '2025-01-15', pagaCom, contrato: { ...EMPRESTIMO, ...extra },
  });
  return estado.calcular();
}

caso('dívida', 'a parcela cai sozinha, e o que venceu antes do mês da inclusão não mexe em conta nenhuma', async () => {
  const e = await comEmprestimo();
  const doEmp = lanc.visiveis(e, '2025-12-31').filter((l) => l.contaDestinoId === 'emp');
  igual(doEmp.map((l) => l.parcelaDe.k), [4, 5, 6, 7, 8, 9, 10, 11, 12],
    'as 3 de out a dez/2024 ficam fora das contas; a de 10/01 cai — o mês da inclusão (15/01) conta inteiro');
  verdade(doEmp.every((l) => l.confirmado && l.automatico), 'realizadas sem ninguém confirmar');
  igual(lanc.saldoReal(e, 'cc'), 2000000 - 9 * 100000, 'a corrente perdeu só as 9 do mês da inclusão em diante');
  igual(Object.keys(e.lancamentos).length, 0, 'e nada foi gravado: a parcela sai do contrato');
  igual(pendencias.pendencias(e, '2025-12-31').filter((p) => p.tipo !== 'conferir'), [],
    'parcela automática nunca vira pendência');
  const s = divida.situacao(e, 'emp', '2025-06-01');
  igual([s.parcelasPagas, s.antesDoApp, s.restantes], [8, 3, 4], 'a análise conta as anteriores como pagas');
  igual([s.totalDoContrato, s.jurosDoContrato], [1200000, 200000], '12 × 1.000 = 12.000, sobre 10.000 tomados');
});

caso('dívida', 'a parcela que ainda vai cair é prevista, e no dia vira realizada', async () => {
  const e = await comEmprestimo();
  const previstas = previsto.ocorrenciasPrevistas(e, '2025-06-01', '2025-06-30', '2025-06-01');
  igual(previstas.map((o) => [o.parcelaDe.k, o.projetado, o.confirmado]), [[9, true, false]], 'junho: a 9ª, prevista');
  const realizada = lanc.visiveis(e, '2025-06-10').find((l) => l.parcelaDe?.k === 9);
  verdade(realizada?.confirmado, 'no dia 10, ela já aconteceu');
  igual(previsto.ocorrenciasPrevistas(e, '2025-06-01', '2025-06-30', '2025-06-10'), [], 'e sai da projeção');
});

caso('dívida', 'paga com o cartão: a parcela é compra na fatura do mês dela', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'ct', nome: 'Cartão', tipo: 'cartao', diaFechamento: 3, diaVencimento: 10, dataInicial: '2025-01-01' });
  await estado.aplicarEvento('conta.criada', { id: 'emp', nome: 'Empréstimo', tipo: 'divida', pagaCom: 'ct', contrato: EMPRESTIMO });
  const e = await estado.calcular();
  const p = lanc.visiveis(e, '2025-03-15').find((l) => l.parcelaDe?.k === 6);
  igual([p.contaId, p.dataCompetencia, p.cicloFatura, p.dataCaixa], ['ct', '2025-03-10', '2025-04-03', '2025-04-10'],
    'compra de 10/03 fecha em 03/04 e vence em 10/04');
});

caso('dívida', 'a exceção, pela linha: corrigir uma parcela, ou dizer que não foi debitada', async () => {
  let e = await comEmprestimo();
  await estado.aplicarEvento('divida.parcelaCorrigida', { id: 'emp', k: 6, valor: 105000, data: '2025-03-12', contaId: 'cc' });
  await estado.aplicarEvento('divida.parcelaPulada', { id: 'emp', k: 7 });
  e = await estado.calcular();
  const ks = lanc.visiveis(e, '2025-12-31').filter((l) => l.contaDestinoId === 'emp').map((l) => l.parcelaDe.k).sort((a, b) => a - b);
  igual(ks, [4, 5, 6, 8, 9, 10, 11, 12], 'a 7ª não caiu');
  const sexta = lanc.visiveis(e, '2025-12-31').find((l) => l.parcelaDe?.k === 6);
  igual([sexta.valor, sexta.dataCaixa, sexta.automatico, sexta.corrigida], [105000, '2025-03-12', true, true],
    'a 6ª corrigida continua automática, com o valor e o dia do banco');
  igual(Object.keys(e.lancamentos).length, 0, 'e nada virou lançamento gravado — nem pendência quando a data passar');
  igual(lanc.saldoReal(e, 'cc'), 2000000 - 7 * 100000 - 105000, 'só aquela parcela mudou de valor');
  igual(divida.situacao(e, 'emp', '2025-12-31').parcelasTotal, 12, 'o contrato continua igual');
  verdade(!lanc.visiveis(e, '2025-03-11').some((l) => l.parcelaDe?.k === 6), 'no dia 11 ainda não tinha caído');

  await estado.aplicarEvento('divida.parcelaCorrigida', { id: 'emp', k: 6, desfazer: true });
  await estado.aplicarEvento('divida.parcelaPulada', { id: 'emp', k: 7, pulada: false });
  e = await estado.calcular();
  igual(lanc.saldoReal(e, 'cc'), 2000000 - 9 * 100000, 'desfeitas as duas, as automáticas voltam');
});

caso('dívida', 'amortizar: reduzir prazo e reduzir parcela, lado a lado', async () => {
  const e = await comEmprestimo();
  const sim = divida.simularAmortizacao(e, 'emp', 200000, '2025-05-15');
  verdade(!sim.quita, 'R$ 2.000 não quitam');
  verdade(sim.prazo.restantes < 5 && sim.prazo.mesesAMenos >= 1, `prazo: ${sim.prazo.restantes} restantes`);
  verdade(sim.parcela.parcela < 100000, `parcela: cai para ${sim.parcela.parcela}`);
  verdade(sim.prazo.economia > sim.parcela.economia, 'reduzir prazo economiza mais juros que reduzir parcela');

  await estado.aplicarEvento('lancamento.registrado', {
    id: 'am', tipo: 'transferencia', valor: 200000, contaId: 'cc', contaDestinoId: 'emp',
    dataCompetencia: '2025-05-15', dataCaixa: '2025-05-15', confirmado: true, observacao: 'amortização',
  });
  await estado.aplicarEvento('divida.amortizada', {
    id: 'emp', lancamentoId: 'am', data: '2025-05-15', valor: 200000, modo: 'parcela', parcela: sim.parcela.parcela,
  });
  let depois = await estado.calcular();
  const parcelas = lanc.visiveis(depois, '2025-12-31').filter((l) => l.automatico && l.contaDestinoId === 'emp');
  igual(parcelas.filter((l) => l.dataCompetencia > '2025-05-15').map((l) => l.valor),
    Array(4).fill(sim.parcela.parcela), 'reduzir parcela: as 4 que faltam com o valor novo');
  igual(parcelas.filter((l) => l.dataCompetencia < '2025-05-15').map((l) => l.valor), Array(5).fill(100000),
    'as de antes não mudam');

  await estado.aplicarEvento('lancamento.removido', { id: 'am' });
  depois = await estado.calcular();
  igual(divida.situacao(depois, 'emp', '2025-06-01').valorParcela, 100000, 'apagada a transferência, a amortização some junto');
});

caso('dívida', 'amortizar reduzindo prazo encurta o calendário', async () => {
  let e = await comEmprestimo();
  const sim = divida.simularAmortizacao(e, 'emp', 200000, '2025-05-15');
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'am', tipo: 'transferencia', valor: 200000, contaId: 'cc', contaDestinoId: 'emp',
    dataCompetencia: '2025-05-15', dataCaixa: '2025-05-15', confirmado: true,
  });
  await estado.aplicarEvento('divida.amortizada', {
    id: 'emp', lancamentoId: 'am', data: '2025-05-15', valor: 200000, modo: 'prazo', restantes: sim.prazo.restantes, ultima: sim.prazo.ultima,
  });
  e = await estado.calcular();
  const s = divida.situacao(e, 'emp', '2025-05-16');
  igual([s.parcelasTotal, s.termina], [8 + sim.prazo.restantes, sim.prazo.termina], 'termina antes, como simulado');
  const quita = divida.simularAmortizacao(e, 'emp', 99999999, '2025-05-16');
  verdade(quita.quita && quita.valor === s.saldoDevedor, 'valor acima do saldo: quita pelo saldo');
});

caso('dívida', 'no mesmo dia, a foto tirada antes de amortizar não apaga a amortização', async () => {
  let e = await comEmprestimo();
  await estado.aplicarEvento('conta.fotografada', { id: 'emp', data: '2025-05-15', valor: 500000 });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'am', tipo: 'transferencia', valor: 100000, contaId: 'cc', contaDestinoId: 'emp',
    dataCompetencia: '2025-05-15', dataCaixa: '2025-05-15', confirmado: true,
  });
  await estado.aplicarEvento('divida.amortizada', { id: 'emp', lancamentoId: 'am', data: '2025-05-15', valor: 100000, modo: 'prazo', restantes: 3 });
  e = await estado.calcular();
  let s = divida.situacao(e, 'emp', '2025-05-15');
  igual([s.saldoDevedor, s.estimado, s.amortizouDepois], [400000, true, true], 'foto − amortização, com ~');
  await estado.aplicarEvento('conta.fotografada', { id: 'emp', data: '2025-05-15', valor: 395000 });
  e = await estado.calcular();
  s = divida.situacao(e, 'emp', '2025-05-15');
  igual([s.saldoDevedor, s.estimado], [395000, false], 'a foto tirada depois já inclui a amortização, e manda');
});

caso('dívida', 'consignado: a parcela já vem pronta no holerite, e conta no líquido', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const ev = (t, d) => estado.aplicarEvento(t, d);
  await ev('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente' });
  await ev('conta.criada', { id: 'fo', nome: 'Folha', tipo: 'folha', liquidoPara: 'cc' });
  await ev('conta.criada', {
    id: 'emp', nome: 'Consignado', tipo: 'divida', pagaCom: 'fo',
    contrato: { valorTomado: 1000000, data: '2027-01-01', parcelas: 24, valorParcela: 60000, primeira: '2027-02-05', taxa: null, incluidoEm: '2027-01-01' },
  });
  await ev('categoria.criada', { id: 'sal', nome: 'Salário base', natureza: 'receita', areas: ['folha'] });
  await ev('recorrencia.criada', { id: 'r-sal', tipo: 'receita', contaId: 'fo', categoriaId: 'sal', tipoValor: 'fixa', valor: 500000, dia: 5, inicio: '2027-01-05' });
  const e = await estado.calcular();
  const linhas = holerite.linhasDoHolerite(e, 'fo', '2027-03', '2027-03-01');
  igual(linhas.map((l) => [l.recorrenciaId, Boolean(l.automatico)]), [['r-sal', false], [null, true]],
    'o salário a lançar, e a parcela que cai sozinha');
  igual(holerite.liquido(linhas), 440000, '5.000 − 600 do consignado');

  // Lançado o mês: a renda líquida desconta o consignado, e o líquido que
  // vai para a corrente não desconta — ele é a própria renda líquida.
  await ev('categoria.criada', { id: 'ir', nome: 'IR', natureza: 'despesa', areas: ['folha'], obrigatoria: true });
  await ev('lancamento.registrado', { id: 's', tipo: 'receita', valor: 500000, contaId: 'fo', categoriaId: 'sal', recorrenciaId: 'r-sal', dataCompetencia: '2027-03-05', confirmado: true });
  await ev('lancamento.registrado', { id: 'i', tipo: 'despesa', valor: 50000, contaId: 'fo', categoriaId: 'ir', dataCompetencia: '2027-03-05', confirmado: true });
  await ev('lancamento.registrado', { id: 'q', tipo: 'transferencia', valor: 390000, contaId: 'fo', contaDestinoId: 'cc', dataCompetencia: '2027-03-05', confirmado: true });
  const depois = await estado.calcular();
  const doMes = lanc.visiveis(depois, '2027-03-31').filter((l) => l.dataCompetencia.slice(0, 7) === '2027-03');
  igual(holerite.rendaDaFolha(depois, doMes, new Set(['fo'])), { bruta: 500000, descontos: 50000, emprestimos: 60000, liquida: 390000 },
    'bruta 5.000; descontos 500 de IR; empréstimos 600 do consignado; líquida 3.900');
});

caso('dívida', 'a série que a primeira versão criava não projeta mais nem repete o mês já lançado', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', dataInicial: '2025-01-01' });
  await estado.aplicarEvento('recorrencia.criada', {
    id: 'velha', nome: 'Parcela', tipo: 'transferencia', contaId: 'cc', contaDestinoId: 'emp', tipoValor: 'fixa', valor: 100000, dia: 10, inicio: '2025-02-10',
  });
  await estado.aplicarEvento('conta.criada', {
    id: 'emp', nome: 'Empréstimo', tipo: 'divida', pagaCom: 'cc', contrato: { ...EMPRESTIMO, recorrenciaId: 'velha' },
  });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'pela-serie', tipo: 'transferencia', valor: 100000, contaId: 'cc', contaDestinoId: 'emp',
    dataCompetencia: '2025-02-10', dataCaixa: '2025-02-10', confirmado: true, recorrenciaId: 'velha',
  });
  const e = await estado.calcular();
  igual(previsto.ocorrenciasPrevistas(e, '2025-03-01', '2025-03-31', '2025-03-01').map((o) => o.id), ['auto:emp:6'],
    'março: só a parcela do contrato, não a da série velha');
  const fev = lanc.visiveis(e, '2025-02-28').filter((l) => l.contaDestinoId === 'emp' && l.dataCompetencia >= '2025-02-01');
  igual(fev.map((l) => l.id), ['pela-serie'], 'fevereiro já lançado pela série: não cai de novo');
});

caso('cartão', 'a compra pode cair na fatura vizinha, sem mudar a data dela', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'ct', nome: 'Cartão', tipo: 'cartao', diaFechamento: 25, diaVencimento: 5 });
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'c1', tipo: 'despesa', valor: 10000, contaId: 'ct', dataCompetencia: '2027-03-24', confirmado: true,
  });
  let e = await estado.calcular();
  igual([e.lancamentos.c1.cicloFatura, e.lancamentos.c1.dataCaixa], ['2027-03-25', '2027-04-05'], 'pela data: fecha 25/03');
  await estado.aplicarEvento('lancamento.alterado', { id: 'c1', faturaDesloca: 1 });
  e = await estado.calcular();
  igual([e.lancamentos.c1.dataCompetencia, e.lancamentos.c1.cicloFatura, e.lancamentos.c1.dataCaixa],
    ['2027-03-24', '2027-04-25', '2027-05-05'], 'movida: a data fica, a fatura é a seguinte');
  await estado.aplicarEvento('lancamento.alterado', { id: 'c1', faturaDesloca: -1 });
  e = await estado.calcular();
  igual(e.lancamentos.c1.cicloFatura, '2027-02-25', 'e para trás também');
});

caso('previsto', 'o mês seguinte de uma conta fixa vem com as etiquetas e a descrição do último', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  await estado.aplicarEvento('conta.criada', { id: 'k1', nome: 'Corrente', tipo: 'corrente' });
  await estado.aplicarEvento('recorrencia.criada', {
    id: 'alug', nome: 'Aluguel', tipo: 'despesa', contaId: 'k1', categoriaId: 'x',
    tipoValor: 'fixa', valor: 60000, dia: 5, inicio: '2027-01-05', etiquetas: ['casa'],
  });
  let e = await estado.calcular();
  igual(previsto.ocorrenciasPrevistas(e, '2027-01-01', '2027-01-31', '2027-01-01')[0].etiquetas, ['casa'],
    'antes de lançar: as da série');
  await estado.aplicarEvento('lancamento.registrado', {
    id: 'jan', tipo: 'despesa', valor: 60000, contaId: 'k1', categoriaId: 'x', recorrenciaId: 'alug',
    dataCompetencia: '2027-01-05', confirmado: true, etiquetas: ['casa', 'apto'], detalheId: 'imob',
  });
  e = await estado.calcular();
  const fev = previsto.ocorrenciasPrevistas(e, '2027-02-01', '2027-02-28', '2027-01-10')[0];
  igual([fev.etiquetas, fev.detalheId], [['casa', 'apto'], 'imob'], 'depois: as do último lançado');
});

caso('investimento', 'no banco: aplicar sai da corrente, resgatar volta, e o ganho é rendimento', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const ev = (t, d) => estado.aplicarEvento(t, d);
  await ev('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', saldoInicial: 1000000 });
  await ev('conta.criada', { id: 'inv', nome: 'Investimentos do banco', tipo: 'investimento', caixaEm: 'cc' });
  await ev('ativo.criado', { id: 'cdb', contaId: 'inv', nome: 'CDB', classe: 'renda_fixa' });
  await ev('lancamento.registrado', { id: 'a1', tipo: 'aplicacao', valor: 500000, contaId: 'cc', ativoId: 'cdb', dataCompetencia: '2025-01-10', confirmado: true });
  let e = await estado.calcular();
  igual(lanc.saldoReal(e, 'cc'), 500000, 'a aplicação saiu da corrente');
  let p = investimentos.posicao(e, 'cdb', '2025-02-01');
  igual([p.valorAtual, p.rendeu, p.estimado], [500000, 0, true], 'sem valor informado: vale o aplicado, com ~');

  await ev('ativo.avaliado', { id: 'cdb', data: '2025-06-01', valor: 510000 });
  e = await estado.calcular();
  p = investimentos.posicao(e, 'cdb', '2025-06-01');
  igual([p.valorAtual, p.rendeu, p.estimado], [510000, 10000, false], 'o valor do banco manda');

  await ev('lancamento.registrado', { id: 'r1', tipo: 'resgate', valor: 518000, contaId: 'cc', ativoId: 'cdb', dataCompetencia: '2025-07-01', confirmado: true });
  await ev('lancamento.registrado', { id: 'j1', tipo: 'provento', valor: 5000, contaId: 'cc', ativoId: 'cdb', dataCompetencia: '2025-07-01', confirmado: true });
  e = await estado.calcular();
  p = investimentos.posicao(e, 'cdb', '2025-07-01');
  igual([p.valorAtual, p.rendeu, p.encerrado], [0, 23000, true], 'resgate total: rendeu 180 + 50 de provento');
  igual(lanc.saldoReal(e, 'cc'), 1000000 - 500000 + 518000 + 5000, 'resgate e provento voltaram para a corrente');
  const r = investimentos.resumoDaConta(e, e.contas.inv, '2025-07-01');
  igual([r.valorAtual, r.rendeu, r.caixa], [0, 23000, 0], 'no banco não há caixa parado');
  const doMes = lanc.visiveis(e, '2025-07-31');
  igual(holerite.rendaDaFolha(e, doMes, new Set(['cc'])).bruta, 0, 'provento não é receita');
});

caso('investimento', 'na própria corretora: aporte vira caixa parado, aplicar tira dele', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const ev = (t, d) => estado.aplicarEvento(t, d);
  await ev('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', saldoInicial: 1000000 });
  await ev('conta.criada', { id: 'cor', nome: 'Corretora', tipo: 'investimento' });
  await ev('ativo.criado', { id: 'tes', contaId: 'cor', nome: 'Tesouro', classe: 'tesouro' });
  await ev('lancamento.registrado', { id: 't1', tipo: 'transferencia', valor: 300000, contaId: 'cc', contaDestinoId: 'cor', dataCompetencia: '2025-01-05', confirmado: true });
  await ev('lancamento.registrado', { id: 'a1', tipo: 'aplicacao', valor: 200000, contaId: 'cor', ativoId: 'tes', dataCompetencia: '2025-01-06', confirmado: true });
  await ev('ativo.avaliado', { id: 'tes', data: '2025-03-01', valor: 210000 });
  const e = await estado.calcular();
  const r = investimentos.resumoDaConta(e, e.contas.cor, '2025-03-01');
  igual([r.caixa, r.valorAtual, r.investido, r.rendeu], [100000, 310000, 300000, 10000],
    'caixa 1.000 + tesouro 2.100; aportado 3.000; rendeu 100');
});

caso('investimento', 'conta sem ativos: o valor informado mostra quanto rendeu', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const ev = (t, d) => estado.aplicarEvento(t, d);
  await ev('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', saldoInicial: 1000000 });
  await ev('conta.criada', { id: 'poup', nome: 'Poupança', tipo: 'investimento' });
  await ev('lancamento.registrado', { id: 't1', tipo: 'transferencia', valor: 100000, contaId: 'cc', contaDestinoId: 'poup', dataCompetencia: '2025-01-05', confirmado: true });
  await ev('conta.fotografada', { id: 'poup', data: '2025-02-05', valor: 101000 });
  await ev('lancamento.registrado', { id: 't2', tipo: 'transferencia', valor: 50000, contaId: 'cc', contaDestinoId: 'poup', dataCompetencia: '2025-02-10', confirmado: true });
  const e = await estado.calcular();
  const r = investimentos.resumoDaConta(e, e.contas.poup, '2025-02-20');
  igual([r.valorAtual, r.investido, r.rendeu], [151000, 150000, 1000], 'o rendimento da foto acompanha o aporte de depois');
});

caso('investimento', 'ação: preço médio da B3, venda pelas compras mais antigas, valor pela cotação', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const ev = (t, d) => estado.aplicarEvento(t, d);
  await ev('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', saldoInicial: 2000000 });
  await ev('conta.criada', { id: 'inv', nome: 'Banco', tipo: 'investimento', caixaEm: 'cc' });
  await ev('ativo.criado', { id: 'petr', contaId: 'inv', nome: 'PETR4', classe: 'acoes', unidade: 'cotas' });
  const op = (id, tipo, data, quantidade, preco, taxas = 0) => ev('lancamento.registrado', {
    id, tipo, contaId: 'cc', ativoId: 'petr', dataCompetencia: data, confirmado: true, quantidade, preco, taxas,
    valor: tipo === 'aplicacao' ? Math.round(quantidade * preco) + taxas : Math.round(quantidade * preco) - taxas,
  });
  await op('c1', 'aplicacao', '2025-02-01', 100, 3000, 500);
  await op('c2', 'aplicacao', '2025-03-01', 100, 4000);
  await op('v1', 'resgate', '2025-04-01', 50, 4500);
  await ev('ativo.avaliado', { id: 'petr', data: '2025-04-05', preco: 4200 });
  const e = await estado.calcular();
  const p = investimentos.posicao(e, 'petr', '2025-04-05');
  igual([p.quantidade, Math.round(p.precoMedio * 10) / 10], [150, 3502.5], '150 na mão; médio (3.005 + 4.000) / 200');
  igual(p.custo, 525375, 'a venda tira 50 ao preço médio, sem mudar o médio');
  igual(p.valorAtual, 630000, '150 × R$ 42,00');
  igual(p.rendeu, 630000 + 225000 - 700500, 'valor + o que voltou − o que foi pago');
  igual(p.lotes.map((l) => [l.data, l.resta]), [['2025-02-01', 50], ['2025-03-01', 100]], 'a venda consumiu a compra mais antiga');
  igual(Math.round(p.lotes[0].variacao * 100), 40, 'a primeira compra, de R$ 30, subiu 40%');
  igual(lanc.saldoReal(e, 'cc'), 2000000 - 300500 - 400000 + 225000, 'compra e venda pela corrente');
});

caso('investimento', 'aplicação de antes de a conta entrar no app não mexe nela, e o período aparece', async () => {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const ev = (t, d) => estado.aplicarEvento(t, d);
  await ev('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', saldoInicial: 1000000, dataInicial: '2026-09-01' });
  await ev('conta.criada', { id: 'inv', nome: 'Banco', tipo: 'investimento', caixaEm: 'cc' });
  let e = await estado.calcular();
  igual(investimentos.contaDaOperacao(e, e.contas.inv, '2025-03-01'), null, 'antes do marco da corrente: conta nenhuma');
  igual(investimentos.contaDaOperacao(e, e.contas.inv, '2026-09-15'), 'cc', 'depois: a corrente');
  await ev('ativo.criado', { id: 'cdb', contaId: 'inv', nome: 'CDB', classe: 'renda_fixa' });
  await ev('lancamento.registrado', { id: 'a0', tipo: 'aplicacao', valor: 1000000, contaId: null, ativoId: 'cdb', dataCompetencia: '2025-09-01', confirmado: true });
  await ev('ativo.avaliado', { id: 'cdb', data: '2026-09-01', valor: 1120000 });
  e = await estado.calcular();
  igual(lanc.saldoReal(e, 'cc'), 1000000, 'a corrente não perdeu nada');
  const p = investimentos.posicao(e, 'cdb', '2026-09-01');
  igual([p.desde, p.rendeu, Math.round(p.aoAno * 1000)], ['2025-09-01', 120000, 120], 'um ano: rendeu 12%, 12% ao ano');
});

// ── envelopes (design/11) ─────────────────────────────────────────────────

/** Uma corrente, um banco com CDB e os envelopes do exemplo dele. */
async function baseDeEnvelopes() {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const ev = (t, d) => estado.aplicarEvento(t, d);
  await ev('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', saldoInicial: 500000 });
  await ev('conta.criada', { id: 'inv', nome: 'Banco', tipo: 'investimento', caixaEm: 'cc' });
  await ev('ativo.criado', { id: 'cdb', contaId: 'inv', nome: 'CDB', classe: 'renda_fixa' });
  for (const [id, nome] of [['res', 'Reserva'], ['ipva', 'IPVA 2027'], ['via', 'Viagem']]) {
    await ev('envelope.criado', { id, nome });
  }
  return ev;
}

const aporte = (id, lugarId, para, valor, data, de = null) =>
  estado.aplicarEvento('envelope.alocado', { id, lugarId, de, para, valor, data });

caso('envelope', '★ distribuir: aportes do sem dono, e o rendimento segue a fração', async () => {
  const ev = await baseDeEnvelopes();
  await ev('lancamento.registrado', { id: 'a1', tipo: 'aplicacao', valor: 2000000, contaId: null, ativoId: 'cdb', dataCompetencia: '2025-01-10', confirmado: true });
  await aporte('x1', 'cdb', 'res', 1500000, '2025-01-10');
  await aporte('x2', 'cdb', 'ipva', 135000, '2025-01-10');
  let r = envelopes.donosNoDia(await estado.calcular(), '2025-01-10');
  igual([r.porEnvelope.get('res').total, r.porEnvelope.get('ipva').total, r.porLugar.get('cdb').semDono], [1500000, 135000, 365000],
    'chegou sem dono, e os aportes deram dono');
  await ev('ativo.avaliado', { id: 'cdb', data: '2025-06-01', valor: 2020000 });
  r = envelopes.donosNoDia(await estado.calcular(), '2025-06-01');
  igual([r.porEnvelope.get('res').total, r.porEnvelope.get('ipva').total, r.porLugar.get('cdb').semDono], [1515000, 136350, 368650],
    'o CDB rendeu 1%: cada um na sua proporção');
  igual([r.porEnvelope.get('res').posto, r.porEnvelope.get('res').rendeu], [1500000, 15000], 'aportou 15.000, rendeu 150');
  igual(r.porEnvelope.get('res').extrato.map((x) => x.tipo), ['aporte'], 'o extrato do envelope tem o aporte');
});

caso('envelope', '★ mover leva o dono: o IPVA da corrente vai para o CDB sem mudar de valor', async () => {
  const ev = await baseDeEnvelopes();
  await aporte('x1', 'cc', 'ipva', 100000, '2025-02-01');
  let r = envelopes.donosNoDia(await estado.calcular(), '2025-02-01');
  igual([r.porLugar.get('cc').donos.get('ipva'), r.porLugar.get('cc').semDono], [100000, 400000], 'na corrente: valor fixo do IPVA, o resto sem dono');
  await ev('lancamento.registrado', {
    id: 'a1', tipo: 'aplicacao', valor: 200000, contaId: 'cc', ativoId: 'cdb', dataCompetencia: '2025-02-05', confirmado: true,
    donos: [{ envelopeId: 'ipva', valor: 100000 }],
  });
  await ev('lancamento.registrado', { id: 'd1', tipo: 'despesa', valor: 50000, contaId: 'cc', categoriaId: 'x', dataCompetencia: '2025-02-06', confirmado: true });
  r = envelopes.donosNoDia(await estado.calcular(), '2025-02-10');
  igual([r.porLugar.get('cc').donos.get('ipva') ?? 0, r.porLugar.get('cc').semDono], [0, 250000], 'a corrente: o IPVA saiu, o gasto saiu do sem dono');
  igual([r.porLugar.get('cdb').donos.get('ipva'), r.porLugar.get('cdb').semDono], [100000, 100000], 'no CDB: IPVA 1.000 + sem dono 1.000');
  igual([r.porEnvelope.get('ipva').total, r.porEnvelope.get('ipva').posto], [100000, 100000], 'o IPVA só mudou de lugar');
  igual(r.porEnvelope.get('ipva').extrato.map((x) => x.tipo), ['movido', 'aporte'], 'e o extrato mostra a mudança de lugar');

  // Resgatar dizendo o dono: chega à corrente ainda sendo dele (D18).
  await ev('lancamento.registrado', {
    id: 'r1', tipo: 'resgate', valor: 30000, contaId: 'cc', ativoId: 'cdb', dataCompetencia: '2025-03-01', confirmado: true,
    donos: [{ envelopeId: 'ipva', valor: 30000 }],
  });
  // Sem dizer: sai do sem dono.
  await ev('lancamento.registrado', { id: 'r2', tipo: 'resgate', valor: 20000, contaId: 'cc', ativoId: 'cdb', dataCompetencia: '2025-03-01', confirmado: true });
  r = envelopes.donosNoDia(await estado.calcular(), '2025-03-02');
  igual([r.porLugar.get('cdb').donos.get('ipva'), r.porLugar.get('cdb').semDono], [70000, 80000], 'no CDB: cada resgate saiu de quem devia');
  igual(r.porLugar.get('cc').donos.get('ipva'), 30000, 'na corrente, o resgatado continua do IPVA');
  igual(r.porEnvelope.get('ipva').total, 100000, 'o envelope não mudou');
});

caso('envelope', 'no mesmo dia vale a ordem do registro: aportar na corrente e logo aplicar', async () => {
  const ev = await baseDeEnvelopes();
  await aporte('x1', 'cc', 'ipva', 30000, '2025-04-01');
  await ev('lancamento.registrado', {
    id: 'a1', tipo: 'aplicacao', valor: 50000, contaId: 'cc', ativoId: 'cdb', dataCompetencia: '2025-04-01', confirmado: true,
    donos: [{ envelopeId: 'ipva', valor: 30000 }],
  });
  const r = envelopes.donosNoDia(await estado.calcular(), '2025-04-01');
  igual([r.porLugar.get('cdb').donos.get('ipva'), r.porLugar.get('cc').donos.get('ipva') ?? 0], [30000, 0], 'o IPVA foi junto para o CDB');
});

caso('envelope', 'o aporte vale a partir da data: o rendimento de antes fica com o sem dono', async () => {
  const ev = await baseDeEnvelopes();
  await ev('lancamento.registrado', { id: 'a1', tipo: 'aplicacao', valor: 1000000, contaId: null, ativoId: 'cdb', dataCompetencia: '2025-01-01', confirmado: true });
  await ev('ativo.avaliado', { id: 'cdb', data: '2025-06-01', valor: 1100000 });
  await aporte('x1', 'cdb', 'via', 550000, '2025-07-01');
  await ev('ativo.avaliado', { id: 'cdb', data: '2025-12-01', valor: 1210000 });
  const r = envelopes.donosNoDia(await estado.calcular(), '2025-12-01');
  igual([r.porEnvelope.get('via').total, r.porEnvelope.get('via').rendeu], [605000, 55000], 'metade do CDB desde julho: rendeu só o de depois');
  igual(r.porLugar.get('cdb').semDono, 605000, 'a outra metade, sem dono');
});

caso('envelope', 'o valor informado hoje vale para o aporte de hoje: distribui-se o que está lá', async () => {
  const ev = await baseDeEnvelopes();
  await ev('lancamento.registrado', { id: 'a1', tipo: 'aplicacao', valor: 1000000, contaId: null, ativoId: 'cdb', dataCompetencia: '2025-01-01', confirmado: true });
  await ev('ativo.avaliado', { id: 'cdb', data: '2025-10-03', valor: 1210000 });
  await aporte('x1', 'cdb', 'ipva', 135000, '2025-10-03');
  const r = envelopes.donosNoDia(await estado.calcular(), '2025-10-03');
  igual([r.porEnvelope.get('ipva').total, r.porLugar.get('cdb').semDono], [135000, 1075000], 'aportou 1.350: tem 1.350');
});

caso('envelope', '"inteiro": o que chega no ativo é do envelope, e o rendimento todo também', async () => {
  const ev = await baseDeEnvelopes();
  await ev('ativo.criado', { id: 'prev', contaId: 'inv', nome: 'Previdência', classe: 'previdencia' });
  await ev('envelope.criado', { id: 'apos', nome: 'Aposentadoria', inteiros: ['prev'] });
  await ev('lancamento.registrado', { id: 'a1', tipo: 'aplicacao', valor: 100000, contaId: null, ativoId: 'prev', dataCompetencia: '2025-01-01', confirmado: true });
  await ev('lancamento.registrado', { id: 'a2', tipo: 'aplicacao', valor: 50000, contaId: 'cc', ativoId: 'prev', dataCompetencia: '2025-02-01', confirmado: true });
  await ev('ativo.avaliado', { id: 'prev', data: '2025-03-01', valor: 160000 });
  const r = envelopes.donosNoDia(await estado.calcular(), '2025-03-01');
  igual([r.porEnvelope.get('apos').total, r.porLugar.get('prev').semDono], [160000, 0], 'tudo da aposentadoria');
  igual([r.porEnvelope.get('apos').posto, r.porEnvelope.get('apos').rendeu], [150000, 10000], 'entrou 1.500, rendeu 100');
});

caso('envelope', 'remanejar é resgatar de um e aportar no outro, e os dois extratos mostram', async () => {
  await baseDeEnvelopes();
  await aporte('x1', 'cc', 'via', 50000, '2025-02-01');
  await aporte('x2', 'cc', 'ipva', 30000, '2025-02-02', 'via');
  await aporte('x3', 'cc', null, 5000, '2025-02-03', 'via');
  const r = envelopes.donosNoDia(await estado.calcular(), '2025-02-05');
  igual([r.porEnvelope.get('via').total, r.porEnvelope.get('ipva').total, r.porLugar.get('cc').semDono], [15000, 30000, 455000],
    'viagem 500 − 300 para o IPVA − 50 de volta ao sem dono');
  igual(r.porEnvelope.get('via').extrato.map((x) => x.tipo), ['resgate', 'remanejo', 'aporte'], 'o extrato da viagem');
  igual(r.porEnvelope.get('ipva').extrato.map((x) => [x.tipo, x.de]), [['remanejo', 'via']], 'o do IPVA diz de onde veio');
});

caso('envelope', 'gastar dinheiro de envelope sem dizer deixa o sem dono negativo à vista', async () => {
  const ev = await baseDeEnvelopes();
  await aporte('x1', 'cc', 'ipva', 400000, '2025-02-01');
  await ev('lancamento.registrado', { id: 'd1', tipo: 'despesa', valor: 200000, contaId: 'cc', categoriaId: 'x', dataCompetencia: '2025-02-06', confirmado: true });
  const r = envelopes.donosNoDia(await estado.calcular(), '2025-02-10');
  igual([r.porLugar.get('cc').donos.get('ipva'), r.porLugar.get('cc').semDono], [400000, -100000], 'o IPVA continua; o sem dono fica −1.000');
});

caso('envelope', '★ o gasto pago pelo envelope sai do que ele tem na conta, e o resto é estouro', async () => {
  const ev = await baseDeEnvelopes();
  await aporte('x1', 'cc', 'ipva', 150000, '2026-01-05');
  await ev('lancamento.registrado', {
    id: 'g1', tipo: 'despesa', valor: 180000, contaId: 'cc', categoriaId: 'imp', custeadoPor: 'ipva',
    dataCompetencia: '2026-01-20', confirmado: true,
  });
  const e = await estado.calcular();
  igual(e.lancamentos.g1.extraordinario, true, 'gasto do envelope é extraordinário por construção (D19)');
  const r = envelopes.donosNoDia(e, '2026-01-31');
  const ipva = r.porEnvelope.get('ipva');
  igual([ipva.total, ipva.custo, ipva.financiado, ipva.estouro], [0, 180000, 150000, 30000], 'custou 1.800: 1.500 do envelope, 300 do caixa comum');
  igual(r.porLugar.get('cc').semDono, 500000 - 180000, 'a corrente fecha: o sem dono é o saldo');
  igual(ipva.extrato[0].tipo, 'gasto', 'o gasto aparece no extrato do envelope');
  igual(envelopes.estadoDoEnvelope(e.envelopes.ipva, ipva), 'em uso', 'já pagou algo: em uso');
});

caso('envelope', 'no cartão, o gasto do envelope sai da corrente que paga a fatura, no dia da compra', async () => {
  const ev = await baseDeEnvelopes();
  await ev('conta.criada', { id: 'cart', nome: 'Cartão', tipo: 'cartao', diaFechamento: 25, diaVencimento: 5, pagaCom: 'cc' });
  await aporte('x1', 'cc', 'via', 100000, '2026-03-01');
  await ev('lancamento.registrado', {
    id: 'g1', tipo: 'despesa', valor: 60000, contaId: 'cart', categoriaId: 'hotel', custeadoPor: 'via',
    dataCompetencia: '2026-03-10', confirmado: true,
  });
  const r = envelopes.donosNoDia(await estado.calcular(), '2026-03-11');
  igual([r.porEnvelope.get('via').total, r.porEnvelope.get('via').estouro, r.porLugar.get('cc').donos.get('via')], [40000, 0, 40000],
    'a viagem pagou o hotel no cartão com o que tinha na corrente');
});

caso('envelope', 'encerrar e abrir o próximo: IPVA 2027 vira IPVA 2028, um ano depois', async () => {
  await baseDeEnvelopes();
  await estado.aplicarEvento('envelope.alterado', { id: 'ipva', alvoValor: 180000, inicio: '2026-02-01', alvoData: '2027-01-31' });
  await estado.aplicarEvento('envelope.encerrado', { id: 'ipva', data: '2027-01-31' });
  let e = await estado.calcular();
  igual(envelopes.envelopesAtivos(e).map((v) => v.id).includes('ipva'), false, 'encerrado sai dos que estão em uso');
  igual(envelopes.estadoDoEnvelope(e.envelopes.ipva, {}), 'encerrado', 'e o estado diz');
  igual(envelopes.proximoDoProjeto(e.envelopes.ipva), { nome: 'IPVA 2028', alvoValor: 180000, inicio: '2027-02-01', alvoData: '2028-01-31' },
    'o próximo: mesmo alvo, um ano depois');
  igual(envelopes.proximoDoProjeto({ nome: 'Reforma', alvoData: '2027-05-31' }).nome, 'Reforma (próximo)', 'sem ano no nome');
  await estado.aplicarEvento('envelope.reaberto', { id: 'ipva' });
  e = await estado.calcular();
  igual(e.envelopes.ipva.encerradoEm, null, 'e pode ser reaberto');
});

caso('envelope', 'projeto: "no ritmo, deveria ter", quanto falta e quanto por mês', () => {
  const ipva = { alvoValor: 180000, inicio: '2026-02-01', alvoData: '2027-01-31' };
  const n = envelopes.numerosDoEnvelope(ipva, 100000, '2026-10-03');
  igual([n.deveriaTer, n.falta, n.mesesRestantes, n.porMes], [135000, 80000, 3, 26667], 'fev a out = 9 de 12 meses');
  igual(envelopes.numerosDoEnvelope({ alvoValor: 3000000 }, 1200000, '2026-10-03').deveriaTer, null, 'o que acumula não tem ritmo');
  igual(envelopes.numerosDoEnvelope(ipva, 190000, '2026-10-03').completo, true, 'chegou no alvo: completo');
});

// ── relatórios (design/12) ────────────────────────────────────────────────

/** Uma corrente, um cartão pago por ela, uma folha, categorias e um envelope. */
async function baseDeRelatorios() {
  await limpar();
  await log.registrarAparelho('meu-pc');
  const ev = (t, d) => estado.aplicarEvento(t, d);
  await ev('conta.criada', { id: 'cc', nome: 'Corrente', tipo: 'corrente', saldoInicial: 500000, titular: 'p1' });
  await ev('conta.criada', { id: 'cart', nome: 'Cartão', tipo: 'cartao', diaFechamento: 25, diaVencimento: 5, pagaCom: 'cc', titular: 'p2' });
  await ev('conta.criada', { id: 'fol', nome: 'Folha', tipo: 'folha' });
  for (const [id, nome, extra] of [['merc', 'Mercado', {}], ['luz', 'Energia', {}], ['sal', 'Salário', { natureza: 'receita' }], ['ir', 'IR', { obrigatoria: true }]]) {
    await ev('categoria.criada', { id, nome, ...extra });
  }
  await ev('envelope.criado', { id: 'ipva', nome: 'IPVA' });
  return ev;
}

const lanc1 = (id, tipo, valor, contaId, data, extra = {}) =>
  estado.aplicarEvento('lancamento.registrado', { id, tipo, valor, contaId, dataCompetencia: data, confirmado: true, ...extra });

caso('relatório', '★ o mês em categorias: rotina nas linhas, projeto à parte, devolução abate a categoria', async () => {
  await baseDeRelatorios();
  await lanc1('m1', 'despesa', 40000, 'cc', '2026-09-10', { categoriaId: 'merc' });
  await lanc1('m2', 'despesa', 60000, 'cc', '2026-10-05', { categoriaId: 'merc' });
  await lanc1('m3', 'despesa', 20000, 'cart', '2026-10-12', { categoriaId: 'merc' });
  await lanc1('d1', 'estorno', 5000, 'cart', '2026-10-12', { categoriaId: 'merc', estornoDe: 'm3' });
  await lanc1('l1', 'despesa', 15000, 'cc', '2026-10-08', { categoriaId: 'luz' });
  await lanc1('p1', 'despesa', 180000, 'cc', '2026-10-09', { categoriaId: 'luz', custeadoPor: 'ipva' });
  await lanc1('i1', 'despesa', 70000, 'fol', '2026-10-01', { categoriaId: 'ir' });
  const r = relatorios.mesEmCategorias(await estado.calcular(), '2026-10');
  igual(r.linhas.map((x) => [x.categoriaId, x.valor, x.anterior, x.diferenca]), [['merc', 75000, 40000, 35000], ['luz', 15000, 0, 15000]],
    'mercado 600 + 200 − 50 de devolução; IR não é gasto');
  igual([r.rotina, r.totalProjetos, r.projetos[0].envelopeId], [90000, 180000, 'ipva'], 'o pago pelo IPVA é projeto, à parte');
});

caso('relatório', 'gasto × pagamento: a compra do cartão é do mês dela, a fatura sai no mês seguinte', async () => {
  await baseDeRelatorios();
  await lanc1('c1', 'despesa', 30000, 'cart', '2026-09-20', { categoriaId: 'merc' });
  await lanc1('c2', 'despesa', 50000, 'cart', '2026-10-10', { categoriaId: 'merc' });
  await lanc1('d1', 'despesa', 10000, 'cc', '2026-10-11', { categoriaId: 'luz' });
  await lanc1('pf', 'pagamento_fatura', 30000, 'cc', '2026-10-05', { contaDestinoId: 'cart' });
  const r = relatorios.gastoEPagamento(await estado.calcular(), '2026-10');
  igual([r.gasto, r.saiu, r.faturasPagas, r.diferenca], [60000, 40000, 30000, 20000], 'consumiu 600, saiu 400 (fatura de set + luz); 200 sai em novembro');
});

caso('relatório', 'taxa de poupança: renda disponível sem o IR, gasto de rotina sem o projeto', async () => {
  await baseDeRelatorios();
  await lanc1('s1', 'receita', 1000000, 'fol', '2026-10-01', { categoriaId: 'sal' });
  await lanc1('i1', 'despesa', 200000, 'fol', '2026-10-01', { categoriaId: 'ir' });
  await lanc1('m1', 'despesa', 400000, 'cc', '2026-10-05', { categoriaId: 'merc' });
  await lanc1('p1', 'despesa', 100000, 'cc', '2026-10-06', { categoriaId: 'luz', custeadoPor: 'ipva' });
  const r = relatorios.taxaDePoupanca(await estado.calcular(), '2026-10');
  igual([r.renda, r.rotina, r.sobrou, Math.round(r.taxa * 100)], [800000, 400000, 400000, 50], 'renda 8.000, gastou 4.000: 50%');
});

caso('relatório', '★ projeção: saldo dia a dia com fatura, recorrente e agendado, e o pior dia', async () => {
  const ev = await baseDeRelatorios();
  await lanc1('c1', 'despesa', 120000, 'cart', '2026-10-10', { categoriaId: 'merc' });
  await ev('recorrencia.criada', { id: 'r1', nome: 'Aluguel', tipo: 'despesa', contaId: 'cc', categoriaId: 'luz', valor: 200000, dia: 20, inicio: '2026-01-20' });
  await ev('recorrencia.criada', { id: 'r2', nome: 'Salário', tipo: 'receita', contaId: 'cc', categoriaId: 'sal', valor: 300000, dia: 1, inicio: '2026-01-01' });
  await ev('lancamento.registrado', { id: 'ag', tipo: 'despesa', valor: 50000, contaId: 'cc', categoriaId: 'luz', dataCompetencia: '2026-10-15', confirmado: false });
  const e = await estado.calcular();
  const p = relatorios.projecaoDeSaldo(e, 30, '2026-10-12');
  const no = (d) => p.pontos.find((x) => x.dia === d).saldo;
  igual(p.inicio, 500000 - 0, 'começa no saldo real');
  igual([no('2026-10-15'), no('2026-10-20'), no('2026-11-01'), no('2026-11-05')], [450000, 250000, 550000, 430000],
    'agendado 500 · aluguel 2.000 · salário 3.000 · fatura 1.200 no vencimento');
  igual([p.pior.dia, p.pior.saldo], ['2026-10-20', 250000], 'o pior dia é o do aluguel, antes do salário');
});

caso('relatório', 'comprometimento e custo de existir: poupar não é custo, IR fica fora', async () => {
  const ev = await baseDeRelatorios();
  await ev('conta.criada', { id: 'res', nome: 'Reserva', tipo: 'investimento' });
  await ev('recorrencia.criada', { id: 'r1', nome: 'Aluguel', tipo: 'despesa', contaId: 'cc', categoriaId: 'luz', valor: 200000, dia: 20, inicio: '2026-01-20' });
  await ev('recorrencia.criada', { id: 'r2', nome: 'Seguro', tipo: 'despesa', contaId: 'cc', categoriaId: 'luz', valor: 120000, dia: 5, inicio: '2026-03-05', periodicidade: 'anual' });
  await ev('recorrencia.criada', { id: 'r3', nome: 'Poupar', tipo: 'transferencia', contaId: 'cc', contaDestinoId: 'res', valor: 50000, dia: 2, inicio: '2026-01-02' });
  await ev('recorrencia.criada', { id: 'r4', nome: 'Salário', tipo: 'receita', contaId: 'fol', categoriaId: 'sal', valor: 1000000, dia: 1, inicio: '2026-01-01' });
  await ev('recorrencia.criada', { id: 'r5', nome: 'IR', tipo: 'despesa', contaId: 'fol', categoriaId: 'ir', valor: 200000, dia: 1, inicio: '2026-01-01' });
  const e = await estado.calcular();
  const c = relatorios.custoDeExistir(e, '2026-10-12');
  igual([c.itens.map((x) => [x.nome, x.mensal]), c.total, c.renda], [[['Aluguel', 200000], ['Seguro', 10000]], 210000, 800000],
    'aluguel + seguro ÷ 12; renda 10.000 − IR');
  const m = relatorios.comprometimento(e, 3, '2026-10-12');
  igual(m.map((x) => [x.mes, x.recorrentes, x.renda]), [['2026-10', 200000, null], ['2026-11', 200000, 800000], ['2026-12', 200000, 800000]],
    'outubro: só o aluguel que falta (o salário de outubro já passou do dia)');
});

caso('relatório', 'para onde vai: por etiqueta, por descrição e de qual conta saiu', async () => {
  const ev = await baseDeRelatorios();
  await ev('etiqueta.criada', { id: 'carro', nome: 'carro' });
  await ev('detalhe.criado', { id: 'mt', nome: 'Mercado Tal' });
  await lanc1('a', 'despesa', 20000, 'cc', '2026-10-03', { categoriaId: 'merc', detalheId: 'mt' });
  await lanc1('b', 'despesa', 30000, 'cart', '2026-10-04', { categoriaId: 'merc', detalheId: 'mt' });
  await lanc1('c', 'despesa', 25000, 'cc', '2026-10-20', { categoriaId: 'luz', etiquetas: ['carro'] });
  const r = relatorios.paraOndeVai(await estado.calcular(), '2026-10-01', '2026-10-31');
  igual([r.etiquetas[0].etiquetaId, r.etiquetas[0].valor], ['carro', 25000], 'o carro');
  igual([r.descricoes[0].detalheId, r.descricoes[0].valor, r.descricoes[0].vezes], ['mt', 50000, 2], 'Mercado Tal: 500 em 2 idas');
  igual(r.titulares, [{ pessoaId: 'p1', valor: 45000 }, { pessoaId: 'p2', valor: 30000 }], 'pela conta de onde saiu');
  igual(r.quinzenas, [50000, 25000], 'primeira e segunda quinzena');
});

caso('relatório', '★ patrimônio: contas + investimentos − cartão − dívida, também no passado', async () => {
  const ev = await baseDeRelatorios();
  await ev('conta.criada', { id: 'inv', nome: 'Banco', tipo: 'investimento', caixaEm: 'cc' });
  await ev('ativo.criado', { id: 'cdb', contaId: 'inv', nome: 'CDB' });
  await lanc1('a1', 'aplicacao', 100000, 'cc', '2026-08-10', { ativoId: 'cdb' });
  await lanc1('c1', 'despesa', 30000, 'cart', '2026-08-20', { categoriaId: 'merc' });
  await ev('ativo.avaliado', { id: 'cdb', data: '2026-09-30', valor: 101000 });
  const e = await estado.calcular();
  const ago = relatorios.patrimonioNoDia(e, '2026-08-31');
  igual([ago.caixa, ago.investimentos, ago.cartoes, ago.total], [400000, 100000, 30000, 470000], 'agosto: o CDB conta, a compra no cartão desconta');
  const set = relatorios.patrimonioNoDia(e, '2026-09-30');
  igual(set.total, 471000, 'setembro: o CDB rendeu 10');
  const t = relatorios.dinheiroTrabalhando(e, '2026-09-01', '2026-09-30');
  igual(t.rendeu, 1000, 'rendeu 10 em setembro');
});

caso('relatório', 'tendência: por que o mês apertou, contra a mediana, separando evento de hábito', async () => {
  await baseDeRelatorios();
  for (const [i, m] of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].entries()) {
    await lanc1(`m${i}`, 'despesa', 50000, 'cc', `${m}-10`, { categoriaId: 'merc' });
    await lanc1(`l${i}`, 'despesa', 10000, 'cc', `${m}-12`, { categoriaId: 'luz' });
  }
  await lanc1('mo', 'despesa', 50000, 'cc', '2026-10-10', { categoriaId: 'merc' });
  await lanc1('lo', 'despesa', 70000, 'cc', '2026-10-12', { categoriaId: 'luz' });
  const e = await estado.calcular();
  igual(relatorios.mesesDeHistorico(e, '2026-10'), 5, 'cinco meses fechados antes de outubro');
  const r = relatorios.porQueApertou(e, '2026-10');
  igual([r.acima, r.linhas[0].categoriaId, r.linhas[0].desvio, r.linhas[0].evento?.id], [60000, 'luz', 60000, 'lo'], 'energia +600: um lançamento');
});

caso('relatório', 'ritmo do mês e entrou × saiu: acumulado no mesmo dia, meses vazios fora', async () => {
  await baseDeRelatorios();
  await lanc1('a', 'despesa', 10000, 'cc', '2026-09-03', { categoriaId: 'merc' });
  await lanc1('b', 'despesa', 30000, 'cc', '2026-09-20', { categoriaId: 'merc' });
  await lanc1('c', 'despesa', 20000, 'cc', '2026-10-02', { categoriaId: 'merc' });
  await lanc1('s', 'receita', 100000, 'fol', '2026-10-01', { categoriaId: 'sal' });
  const e = await estado.calcular();
  const r = relatorios.ritmoDoMes(e, '2026-10', '2026-10-04');
  igual([r.atual[3], r.atual[4], r.noMesmoDia, Math.round(r.parte * 100)], [20000, null, 10000, 50], 'dia 4: 200 contra 100 em setembro; 50% de setembro');
  const f = relatorios.fluxoDosMeses(e, '2026-10', 12);
  igual(f.map((x) => [x.mes, x.renda, x.rotina]), [['2026-09', 0, 40000], ['2026-10', 100000, 20000]], 'só a partir do primeiro mês com algo');
});

caso('relatório', 'o investido por classe e por envelope (o sem dono à parte)', async () => {
  const ev = await baseDeRelatorios();
  await ev('conta.criada', { id: 'inv', nome: 'Banco', tipo: 'investimento', caixaEm: 'cc' });
  await ev('ativo.criado', { id: 'cdb', contaId: 'inv', nome: 'CDB', classe: 'renda_fixa' });
  await ev('ativo.criado', { id: 'tes', contaId: 'inv', nome: 'Tesouro', classe: 'tesouro' });
  await lanc1('a1', 'aplicacao', 100000, null, '2026-08-01', { ativoId: 'cdb' });
  await lanc1('a2', 'aplicacao', 50000, null, '2026-08-01', { ativoId: 'tes' });
  await estado.aplicarEvento('envelope.alocado', { id: 'x', lugarId: 'cdb', de: null, para: 'ipva', valor: 30000, data: '2026-08-02' });
  const r = relatorios.investido(await estado.calcular(), '2026-10-04');
  igual(r.classes.map((x) => [x.id, x.valor]).sort(), [['renda_fixa', 100000], ['tesouro', 50000]], 'por classe');
  igual(r.envelopes.map((x) => [x.id, x.valor]).sort(), [['', 120000], ['ipva', 30000]], 'IPVA 300 no CDB; o resto sem dono');
});

caso('entrada', '★ conta fixa que cai sozinha: do dia em que se ligou, um por mês, sem duplicar', async () => {
  const ev = await baseDeRelatorios();
  await ev('recorrencia.criada', {
    id: 'luz', nome: 'Energia', tipo: 'despesa', contaId: 'cc', categoriaId: 'luz', valor: 25000, dia: 10,
    inicio: '2026-01-10', caiSozinha: true, caiSozinhaDesde: '2026-09-05',
  });
  let e = await estado.calcular();
  let p = automaticas.automaticasPendentes(e, '2026-11-12');
  igual(p.map((x) => [x.id, x.dataCompetencia, x.valor]), [['auto-rec:luz:2026-09', '2026-09-10', 25000], ['auto-rec:luz:2026-10', '2026-10-10', 25000], ['auto-rec:luz:2026-11', '2026-11-10', 25000]],
    'setembro (ligada no dia 5), outubro e novembro — agosto não');
  for (const dados of p) await ev('lancamento.registrado', dados);
  e = await estado.calcular();
  igual(automaticas.automaticasPendentes(e, '2026-11-12').length, 0, 'o que já caiu não cai de novo');
  igual([e.lancamentos['auto-rec:luz:2026-10'].caiuSozinha, e.lancamentos['auto-rec:luz:2026-10'].recorrenciaId], [true, 'luz'], 'marcado, e amarrado à série');
  await ev('lancamento.removido', { id: 'auto-rec:luz:2026-11' });
  e = await estado.calcular();
  igual(automaticas.automaticasPendentes(e, '2026-11-12').length, 0, 'apagado de propósito não volta');
  igual(lanc.saldoReal(e, 'cc'), 500000 - 50000, 'setembro e outubro saíram da corrente');
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
