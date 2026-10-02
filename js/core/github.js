// O cliente da API do GitHub — a única coisa que este app chama fora do próprio
// aparelho. design/06-sincronizacao.md §1
//
// Fala só o necessário: saber se o repositório é privado, listar a pasta de
// eventos, ler um arquivo e acrescentar linhas ao fim dele. Nada de biblioteca.

const RAIZ = 'https://api.github.com';

export class ErroDoGitHub extends Error {
  constructor(mensagem, { status = 0, causa = '' } = {}) {
    super(mensagem);
    this.name = 'ErroDoGitHub';
    this.status = status;
    this.causa = causa;
  }
}

/**
 * @param {object} acesso
 * @param {string} acesso.repo   "pessoa/repositorio"
 * @param {string} acesso.token  fica só no aparelho, nunca num evento (§7)
 */
export function criarCliente({ repo, token }) {
  const base = `${RAIZ}/repos/${repo}`;

  async function pedir(url, opcoes = {}) {
    let resposta;
    try {
      resposta = await fetch(url, {
        ...opcoes,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opcoes.headers ?? {}),
        },
      });
    } catch (e) {
      // Sem rede não é erro de verdade: a fila espera (§9).
      throw new ErroDoGitHub('sem conexão com o GitHub', { causa: e.message });
    }

    if (resposta.status === 404) return null;
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroDoGitHub('o token não vale mais, ou não alcança este repositório', {
        status: resposta.status,
      });
    }
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      throw new ErroDoGitHub(`o GitHub recusou (${resposta.status})`, {
        status: resposta.status,
        causa: corpo.slice(0, 200),
      });
    }
    return resposta;
  }

  async function json(url, opcoes) {
    const r = await pedir(url, opcoes);
    return r ? r.json() : null;
  }

  return {
    repo,

    /** Privacidade é a proteção principal: o app confere sempre (07 §4.2). */
    async informacoes() {
      const dados = await json(base);
      if (!dados) {
        throw new ErroDoGitHub(
          `não achei o repositório ${repo} — confira o nome e se o token alcança ele`,
          { status: 404 }
        );
      }
      return { privado: dados.private === true, ramo: dados.default_branch ?? 'main' };
    },

    async listar(pasta) {
      const dados = await json(`${base}/contents/${pasta}`);
      if (!dados || !Array.isArray(dados)) return [];
      return dados
        .filter((i) => i.type === 'file')
        .map((i) => ({ nome: i.name, caminho: i.path, sha: i.sha, tamanho: i.size }));
    },

    /** Devolve null quando o arquivo ainda não existe — o caso do primeiro uso. */
    async ler(caminho) {
      const dados = await json(`${base}/contents/${encodeURI(caminho)}`);
      if (!dados) return null;

      // Acima de 1 MB a API de conteúdo devolve o arquivo vazio; aí o texto vem
      // pelo blob. Dez anos de histórico passam desse tamanho, então isto não é
      // zelo: é o ano 7 funcionando.
      if (!dados.content && dados.sha) {
        const bruto = await pedir(`${base}/git/blobs/${dados.sha}`, {
          headers: { Accept: 'application/vnd.github.raw' },
        });
        return { texto: await bruto.text(), sha: dados.sha };
      }
      return { texto: base64ParaTexto(dados.content ?? ''), sha: dados.sha };
    },

    async gravar(caminho, texto, { sha = null, mensagem }) {
      const corpo = {
        message: mensagem,
        content: textoParaBase64(texto),
        ...(sha ? { sha } : {}),
      };
      const dados = await json(`${base}/contents/${encodeURI(caminho)}`, {
        method: 'PUT',
        body: JSON.stringify(corpo),
      });
      return { sha: dados?.content?.sha ?? null };
    },
  };
}

// ── base64 de texto ───────────────────────────────────────────────────────
// `btoa` só entende bytes, e o histórico tem acento em tudo.

export function textoParaBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

export function base64ParaTexto(base64) {
  const limpo = String(base64).replace(/\s/g, '');
  if (!limpo) return '';
  const binario = atob(limpo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
