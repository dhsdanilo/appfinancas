// A área de cada conta: em caixa, cartões, investimentos, dívidas, folha.
// Cada área tem cor própria (design/09-identidade §3) — é ela que diz "em que
// área estou" e denuncia a conta errada antes de salvar.

export const AREAS = [
  { id: 'caixa', titulo: 'Em caixa', tipos: ['corrente', 'especie'] },
  { id: 'cartoes', titulo: 'Cartões', tipos: ['cartao'] },
  // Renda é a área das contas de folha: uma por fonte (design/10 §2).
  { id: 'folha', titulo: 'Renda', tipos: ['folha'] },
  { id: 'investimentos', titulo: 'Investimentos', tipos: ['investimento'] },
  { id: 'dividas', titulo: 'Dívidas', tipos: ['divida'] },
];

export const areaDaConta = (conta) => AREAS.find((a) => a.tipos.includes(conta?.tipo))?.id ?? '';

/** As áreas que aceitam categoria: investimento e dívida não têm (design/10 §3). */
export const AREAS_COM_CATEGORIA = ['caixa', 'cartoes', 'folha'];

/**
 * A categoria aparece na área desta conta? (D26, design/10 §1). Sem conta
 * escolhida, vale tudo.
 */
export function categoriaNaArea(categoria, conta) {
  if (!conta) return true;
  return (categoria.areas ?? ['caixa', 'cartoes']).includes(areaDaConta(conta));
}

/** As áreas de uma categoria criada na hora, a partir da conta escolhida. */
export function areasParaConta(conta) {
  const area = areaDaConta(conta);
  if (area === 'folha') return ['folha'];
  return ['caixa', 'cartoes'];
}

/**
 * As opções de um <select> de contas, agrupadas por área. Agrupar é o que faz
 * "Banco cartão" e "Banco corrente" deixarem de ser vizinhos parecidos.
 */
export function opcoesDeConta(contas, escolhida, { vazia = false } = {}) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const grupos = AREAS.map((a) => {
    const daArea = contas.filter((c) => a.tipos.includes(c.tipo));
    if (!daArea.length) return '';
    return `<optgroup label="${esc(a.titulo)}">${daArea
      .map((c) => `<option value="${esc(c.id)}"${c.id === escolhida ? ' selected' : ''}>${esc(c.nome)}</option>`)
      .join('')}</optgroup>`;
  }).join('');
  return (vazia ? '<option value="">—</option>' : '') + grupos;
}
