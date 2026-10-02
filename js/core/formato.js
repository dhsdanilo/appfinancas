// Versão do formato e migração.
//
// Regra que vem do design: o dado bruto NUNCA é reescrito
// (design/02-modelo-de-dados.md §2). Então migrar não é converter o arquivo —
// é **reinterpretar o evento antigo na leitura**, em memória.
//
// Cada evento carrega a versão do formato com que foi escrito (`v`). Ao ler,
// `promover()` aplica as migrações em cadeia até a versão atual. O evento no
// disco continua exatamente como foi gravado, pra sempre.

export const VERSAO_ATUAL = 1;

/**
 * migracoes[n] promove um evento da versão n para a versão n+1.
 * Ao criar a versão 2, acrescente aqui a função 1 → 2 e suba VERSAO_ATUAL.
 * Nunca edite uma migração que já rodou na vida real.
 *
 * @type {Record<number, (evento: object) => object>}
 */
export const migracoes = {
  // 1: (ev) => ({ ...ev, v: 2, dados: ... }),
};

export function promover(evento, { migracoes: tabela = migracoes, ate = VERSAO_ATUAL } = {}) {
  let atual = evento;
  let v = atual.v ?? 1;

  if (v > ate) {
    throw new ErroDeFormato(
      `evento ${atual.id} foi escrito no formato ${v}, mais novo que o ${ate} que este app entende`
    );
  }

  while (v < ate) {
    const migracao = tabela[v];
    if (!migracao) {
      throw new ErroDeFormato(`falta a migração do formato ${v} para ${v + 1}`);
    }
    atual = migracao(atual);
    if ((atual.v ?? v) !== v + 1) {
      throw new ErroDeFormato(`a migração ${v}→${v + 1} não marcou v=${v + 1}`);
    }
    v = atual.v;
  }
  return atual;
}

/**
 * Aparelho com app desatualizado lendo evento novo: não há o que fazer além de
 * avisar com clareza. Chutar a interpretação seria corromper dado financeiro.
 */
export class ErroDeFormato extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroDeFormato';
  }
}
