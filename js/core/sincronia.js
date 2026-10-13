// A sincronização: um arquivo por aparelho, cifrado, no repositório privado.
// design/06-sincronizacao.md
//
// O ciclo é curto de propósito:
//   receber  — lê os arquivos dos outros aparelhos, decifra, absorve
//   enviar   — acrescenta ao FIM do próprio arquivo as linhas que ainda não subiram
//
// Conflito de escrita é impossível por construção: dois aparelhos nunca tocam o
// mesmo arquivo, então juntar é somar. E remoção é evento, nunca ausência —
// senão o aparelho do outro ressuscitaria o que foi apagado (§5).

import * as db from './db.js';
import * as log from './log.js';
import * as estado from './estado.js';
import { criarCliente, ErroDoGitHub } from './github.js';
import { novoSal, derivarChave, cifrar, decifrar, criarSelo, seloConfere } from './cripto.js';
import { slug } from './id.js';

const CONFIG = 'sincronia';
const CHAVE = 'sincronia.chave';
const ARQUIVO_DE_CONFIG = 'sincronia.json';
const PASTA = 'log';
const ORFAOS = 'sincronia.orfaos';

export class ErroDeSincronia extends Error {
  constructor(mensagem, { grave = false } = {}) {
    super(mensagem);
    this.name = 'ErroDeSincronia';
    this.grave = grave;
  }
}

// ── configuração deste aparelho ───────────────────────────────────────────

export function configuracao() {
  return db.lerMeta(CONFIG);
}

/** A chave derivada mora aqui; a frase que a gerou, em lugar nenhum. */
async function chaveLocal() {
  const guardada = await db.lerMeta(CHAVE);
  if (!guardada) throw new ErroDeSincronia('este aparelho ainda não foi pareado');
  return guardada.chave;
}

export async function esquecerAparelho() {
  await db.gravarMeta(CONFIG, null);
  await db.gravarMeta(CHAVE, null);
}

/**
 * Pareamento: repositório, token, frase e o nome deste aparelho (§8).
 *
 * O primeiro aparelho cria o sal e o selo; os seguintes leem o que está lá e
 * conferem a frase contra o selo — frase errada é dita na cara, antes de
 * qualquer dado, em vez de virar lixo silencioso.
 */
export async function parear({ repo, token, frase, aparelho }, { cliente } = {}) {
  const nome = String(aparelho ?? '').trim();
  if (!repo || !token) throw new ErroDeSincronia('faltou o repositório ou o token');
  if (!frase) throw new ErroDeSincronia('faltou a frase secreta');
  if (!nome) throw new ErroDeSincronia('dê um nome a este aparelho: ele vira o nome do arquivo');

  const api = cliente ?? criarCliente({ repo, token });
  await exigirPrivado(api);

  const existente = await api.ler(ARQUIVO_DE_CONFIG);

  let config;
  let chave;
  if (existente) {
    config = JSON.parse(existente.texto);
    chave = await derivarChave(frase, config.sal);
    if (!(await seloConfere(chave, config.selo))) {
      throw new ErroDeSincronia(
        'a frase não confere com a que já está em uso neste repositório — nada foi alterado'
      );
    }
  } else {
    // Primeira família neste repositório.
    const sal = novoSal();
    chave = await derivarChave(frase, sal);
    config = { versao: 1, sal, selo: await criarSelo(chave), criadoEm: agora() };
    await api.gravar(ARQUIVO_DE_CONFIG, JSON.stringify(config, null, 2) + '\n', {
      mensagem: 'sincronia: sal e selo',
    });
  }

  // Só depois da frase conferida o aparelho ganha (ou troca) de nome.
  const registro = await escolherAparelho(api, chave, nome);
  await guardar({ repo, token, aparelho: registro.id, sal: config.sal }, chave);

  return { aparelho: registro.id, primeiro: !existente, nomeOcupado: registro.id !== (slug(nome) || 'aparelho') };
}

/**
 * O arquivo de cada aparelho é o nome dele, e só ele escreve ali. Então o nome
 * tem de ser único no repositório:
 *  - o aparelho que já tem arquivo lá (pareou, esqueceu e voltou) continua nele;
 *  - senão, fica com o nome pedido — ou "nome-2", "nome-3" se outro aparelho já
 *    o usa (dois "Celular", ou o mesmo celular reinstalado: o arquivo antigo
 *    passa a ser lido como de outro aparelho, e o histórico volta);
 *  - os eventos gravados aqui antes do pareamento vão junto para o id novo.
 */
async function escolherAparelho(api, chave, nome) {
  const atual = (await log.aparelho()) ?? (await log.registrarAparelho(nome));
  const ocupados = new Set((await api.listar(PASTA)).map((a) => a.nome));

  if (ocupados.has(nomeDoArquivo(atual.id)) && (await arquivoEhDeste(api, chave, atual.id))) {
    return log.mudarAparelho({ id: atual.id, nome });
  }

  const pedido = slug(nome) || 'aparelho';
  let id = pedido;
  for (let n = 2; ocupados.has(nomeDoArquivo(id)); n += 1) id = `${pedido}-${n}`;
  const registro = await log.mudarAparelho({ id, nome });
  // A ordem canônica desempata pelo aparelho: com outro id, refaz-se a conta.
  if (id !== atual.id) await estado.recalcular();
  return registro;
}

/** O arquivo `id` foi escrito por este aparelho? O primeiro evento dele diz. */
async function arquivoEhDeste(api, chave, id) {
  const remoto = await api.ler(`${PASTA}/${nomeDoArquivo(id)}`);
  const primeira = remoto?.texto.split('\n').find((l) => l.trim());
  if (!primeira) return true;
  const ev = await eventoDaLinha(chave, primeira);
  if (!ev) return false;
  const local = await db.lerEvento(ev.id);
  return local?.ap === id;
}

async function eventoDaLinha(chave, linha) {
  try {
    return JSON.parse(await decifrar(chave, linha.trim()));
  } catch {
    return null;
  }
}

async function guardar(config, chave) {
  await db.gravarMeta(CONFIG, { ...config, pareadoEm: agora() });
  // CryptoKey não-exportável sobrevive ao IndexedDB: o aparelho guarda a chave,
  // nunca a frase, e nem o app consegue ler os bytes dela de volta.
  await db.gravarMeta(CHAVE, { chave });
}

/**
 * Repositório de dados que virou público é o pior cenário deste projeto, e é o
 * tipo de erro que ninguém descobre sozinho. Então o app confere SEMPRE, antes
 * de qualquer linha subir (07-seguranca §4.2).
 */
async function exigirPrivado(api) {
  const info = await api.informacoes();
  if (!info.privado) {
    throw new ErroDeSincronia(
      `O repositório ${api.repo} está PÚBLICO. Nada foi enviado. Torne-o privado antes de sincronizar.`,
      { grave: true }
    );
  }
  return info;
}

// ── o ciclo ───────────────────────────────────────────────────────────────

export async function sincronizar({ cliente } = {}) {
  const config = await configuracao();
  if (!config) throw new ErroDeSincronia('este aparelho ainda não foi pareado');

  const api = cliente ?? criarCliente({ repo: config.repo, token: config.token });
  const chave = await chaveLocal();

  await exigirPrivado(api);

  const { recebidos, arquivos } = await receber(api, chave, config);
  const enviados = await enviar(api, chave, config);
  await contarOrfaos(arquivos, config);

  await db.gravarMeta('sincronia.ultima', { em: agora(), recebidos, enviados });
  return { recebidos, enviados };
}

/** Lê os arquivos dos OUTROS aparelhos e absorve o que ainda não se conhecia. */
async function receber(api, chave, config) {
  const arquivos = await api.listar(PASTA);
  const meuArquivo = nomeDoArquivo(config.aparelho);

  const novos = [];
  for (const arquivo of arquivos) {
    if (arquivo.nome === meuArquivo) continue;
    const conteudo = await api.ler(arquivo.caminho);
    if (!conteudo) continue;
    novos.push(...(await decifrarLinhas(chave, conteudo.texto, arquivo.nome)));
  }

  if (!novos.length) return { recebidos: 0, arquivos };
  const { novos: quantos } = await estado.absorverEventos(novos);
  return { recebidos: quantos, arquivos };
}

async function decifrarLinhas(chave, texto, deOndeVeio) {
  const eventos = [];
  for (const linha of texto.split('\n')) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      eventos.push(JSON.parse(await decifrar(chave, limpa)));
    } catch (e) {
      // Linha ilegível não pode derrubar a sincronização inteira — mas também
      // não pode sumir em silêncio.
      throw new ErroDeSincronia(
        `uma linha de ${deOndeVeio} não abriu com esta frase. Nada foi absorvido desse arquivo.`,
        { grave: true }
      );
    }
  }
  return eventos;
}

/**
 * Acrescenta ao fim do próprio arquivo as linhas que ainda não subiram.
 *
 * Quantas já subiram se descobre contando as linhas que estão lá: só este
 * aparelho escreve neste arquivo, e os eventos dele saem sempre na mesma ordem
 * (seq cresce de um em um). Contar é mais confiável que guardar um ponteiro
 * local, que desencontraria se uma gravação falhasse no meio.
 */
async function enviar(api, chave, config) {
  const caminho = `${PASTA}/${nomeDoArquivo(config.aparelho)}`;
  const remoto = await api.ler(caminho);
  const jaSubiram = remoto ? remoto.texto.split('\n').filter((l) => l.trim()).length : 0;

  const meus = (await db.eventosEmOrdem({}))
    .filter((ev) => ev.ap === config.aparelho)
    .sort((a, b) => a.seq - b.seq);

  // Contar linhas só vale se o arquivo for mesmo deste aparelho: confere a
  // primeira e a última que estão lá contra os eventos daqui. Se não baterem,
  // outro aparelho escreve neste arquivo — e enviar perderia eventos dos dois.
  if (jaSubiram > 0) {
    const linhas = remoto.texto.split('\n').filter((l) => l.trim());
    const bate = jaSubiram <= meus.length &&
      (await eventoDaLinha(chave, linhas[0]))?.id === meus[0].id &&
      (await eventoDaLinha(chave, linhas[jaSubiram - 1]))?.id === meus[jaSubiram - 1].id;
    if (!bate) {
      throw new ErroDeSincronia(
        `o arquivo ${caminho} não bate com os eventos deste aparelho — outro aparelho pode estar usando o mesmo nome. Nada foi enviado.`,
        { grave: true }
      );
    }
  }

  const faltando = meus.slice(jaSubiram);
  if (!faltando.length) return 0;

  const linhas = [];
  for (const ev of faltando) linhas.push(await cifrar(chave, JSON.stringify(ev)));

  const texto = (remoto?.texto ?? '').replace(/\n*$/, '');
  const novoTexto = (texto ? texto + '\n' : '') + linhas.join('\n') + '\n';

  await api.gravar(caminho, novoTexto, {
    sha: remoto?.sha ?? null,
    mensagem: `${config.aparelho}: +${faltando.length} evento${faltando.length > 1 ? 's' : ''}`,
  });
  return faltando.length;
}

export const nomeDoArquivo = (aparelho) => `${aparelho}.ndjson`;

/**
 * Eventos que estão aqui com um id de aparelho que não tem arquivo no
 * repositório: foram gravados neste aparelho com outro id (antes do pareamento,
 * numa versão que trocava o id ao parear) e nunca subiram. { id: quantos }
 */
async function contarOrfaos(arquivos, config) {
  const nomes = new Set(arquivos.map((a) => a.nome));
  const orfaos = {};
  for (const ev of await db.eventosEmOrdem({})) {
    if (ev.ap === config.aparelho || nomes.has(nomeDoArquivo(ev.ap))) continue;
    orfaos[ev.ap] = (orfaos[ev.ap] ?? 0) + 1;
  }
  await db.gravarMeta(ORFAOS, orfaos);
  return orfaos;
}

export async function orfaos() {
  return (await db.lerMeta(ORFAOS)) ?? {};
}

/** Os órfãos passam a ser deste aparelho e sobem já. */
export async function enviarOrfaos({ cliente } = {}) {
  const lista = Object.keys(await orfaos());
  for (const id of lista) await log.adotarEventos(id);
  if (lista.length) await estado.recalcular();
  return sincronizar({ cliente });
}

export function ultimaSincronizacao() {
  return db.lerMeta('sincronia.ultima');
}

const agora = () => new Date().toISOString();

export { ErroDoGitHub };
