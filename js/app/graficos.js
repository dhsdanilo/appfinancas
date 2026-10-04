// Os gráficos dos relatórios (design/12), em SVG, sem biblioteca.
//
// Regras de dataviz que valem para todos:
//   - cor só pela paleta validada (--serie-1…8, base.css), sempre na mesma
//     ordem, e a cor segue a coisa, nunca a posição;
//   - duas ou mais séries têm legenda; o valor também aparece escrito (as
//     cores claras ficam abaixo de 3:1 no fundo claro — a regra de alívio);
//   - um eixo só; barras finas com ponta arredondada e 2px de fresta;
//   - passar o mouse (ou focar) mostra a dica com os números.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** As cores da paleta, na ordem. `cor(1)` é a primeira. */
export const cor = (n) => `var(--serie-${n})`;
export const COR_NEUTRA = 'var(--serie-outros)';

/** Um passo de eixo redondo: 1, 2 ou 5 vezes uma potência de 10. */
function redondo(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** A escala vertical: mínimo e máximo redondos, com o zero dentro. */
function escala(valores, alturaUtil, cima) {
  let min = Math.min(0, ...valores);
  let max = Math.max(0, ...valores);
  if (max === min) max = min + 100;
  const passo = redondo((max - min) / 4);
  min = Math.floor(min / passo) * passo;
  max = Math.ceil(max / passo) * passo;
  const y = (v) => cima + (1 - (v - min) / (max - min)) * alturaUtil;
  const marcas = [];
  for (let v = min; v <= max + 1; v += passo) marcas.push(v);
  return { y, marcas, min, max };
}

const larguraDe = (raiz, minima = 300) => Math.max(minima, Math.round(raiz.clientWidth || 720));

/** A legenda: um traço (linha) ou um quadrado (área, barra) na cor, e o nome. */
export function legenda(series) {
  return `<div class="legenda-grafico">${series.map((s) =>
    `<span><i class="${s.linha ? 'traco' : 'quadro'}" style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}</div>`;
}

/**
 * A dica: todo elemento com `data-dica` (HTML já escapado) mostra a sua ao
 * passar o mouse ou receber o foco.
 */
function ligarDicas(raiz) {
  const dica = raiz.querySelector('.dica-grafico');
  const mostrar = (alvo, x) => {
    dica.innerHTML = alvo.dataset.dica;
    dica.hidden = false;
    const caixa = raiz.querySelector('.grafico').getBoundingClientRect();
    const px = x ?? (alvo.getBoundingClientRect().left + alvo.getBoundingClientRect().width / 2 - caixa.left);
    dica.style.left = `${Math.min(Math.max(0, px - dica.offsetWidth / 2), caixa.width - dica.offsetWidth)}px`;
    for (const outro of raiz.querySelectorAll('.realce')) outro.classList.remove('realce');
    alvo.classList.add('realce');
  };
  const esconder = () => {
    dica.hidden = true;
    for (const outro of raiz.querySelectorAll('.realce')) outro.classList.remove('realce');
  };
  raiz.addEventListener('pointermove', (e) => {
    const alvo = e.target.closest('[data-dica]');
    if (!alvo) { esconder(); return; }
    mostrar(alvo, e.clientX - raiz.querySelector('.grafico').getBoundingClientRect().left);
  });
  raiz.addEventListener('pointerleave', esconder);
  raiz.addEventListener('focusin', (e) => { const alvo = e.target.closest('[data-dica]'); if (alvo) mostrar(alvo); });
  raiz.addEventListener('focusout', esconder);
}

const moldura = (svg, extra = '') => `<div class="grafico">${svg}<div class="dica-grafico" hidden></div></div>${extra}`;

// ── colunas (agrupadas ou empilhadas), com uma linha opcional ───────────────

/**
 * `grupos`: [{ rotulo, dica, barras: [[{ valor, cor }]] }] — cada barra é uma
 * pilha de partes (de baixo para cima). `linha`: [valor|null] por grupo,
 * desenhada por cima (a renda, por exemplo). `series` vai para a legenda.
 */
export function colunas(raiz, { grupos, series, linha = null, formatar, altura = 220 }) {
  const largura = larguraDe(raiz);
  const m = { cima: 12, baixo: 26, esq: 62, dir: 12 };
  const totais = grupos.flatMap((g) => g.barras.map((b) => b.reduce((t, p) => t + p.valor, 0)));
  const { y, marcas } = escala([...totais, ...(linha ?? []).filter((v) => v != null)], altura - m.cima - m.baixo, m.cima);
  const faixa = (largura - m.esq - m.dir) / grupos.length;
  const porGrupo = grupos[0]?.barras.length ?? 1;
  // Barra fina (até 24px), centralizada no grupo, 2px de fresta entre vizinhas.
  const grossura = Math.max(4, Math.min(24, (faixa * 0.7 - (porGrupo - 1) * 2) / porGrupo));
  const grade = marcas.map((v) => `<line class="grade" x1="${m.esq}" x2="${largura - m.dir}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="eixo" x="${m.esq - 8}" y="${y(v) + 4}" text-anchor="end">${esc(formatar(v))}</text>`).join('');
  const cabem = Math.max(2, Math.floor((largura - m.esq - m.dir) / 46));
  const pulo = Math.ceil(grupos.length / cabem);
  const barras = grupos.map((g, gi) => {
    const centro = m.esq + faixa * gi + faixa / 2;
    const largGrupo = porGrupo * grossura + (porGrupo - 1) * 2;
    const pilhas = g.barras.map((pilha, bi) => {
      const x = centro - largGrupo / 2 + bi * (grossura + 2);
      let base = 0;
      const partes = pilha.filter((p) => p.valor > 0);
      return partes.map((p, pi) => {
        const y1 = y(base + p.valor);
        const y0 = y(base);
        base += p.valor;
        const topo = pi === partes.length - 1;
        // A fresta de 2px entre as partes de uma pilha.
        const h = Math.max(0, y0 - y1 - (topo ? 0 : 2));
        return topo
          ? `<path d="${barraArredondada(x, y1, grossura, h)}" fill="${p.cor}"/>`
          : `<rect x="${x}" y="${y1 + 2}" width="${grossura}" height="${Math.max(0, h)}" fill="${p.cor}"/>`;
      }).join('');
    }).join('');
    const alvo = `<rect class="alvo" x="${m.esq + faixa * gi}" y="${m.cima}" width="${faixa}" height="${altura - m.cima - m.baixo}" data-dica="${esc(g.dica)}" tabindex="0"/>`;
    const rotulo = gi % pulo === 0 || gi === grupos.length - 1 ? `<text class="eixo" x="${centro}" y="${altura - 8}" text-anchor="middle">${esc(g.rotulo)}</text>` : '';
    return `<g class="grupo">${pilhas}${alvo}</g>${rotulo}`;
  }).join('');
  const caminho = linha
    ? linha.map((v, i) => (v == null ? null : `${m.esq + faixa * i + faixa / 2},${y(v)}`)).filter(Boolean)
    : [];
  const desenhoLinha = caminho.length > 1 ? `<polyline class="linha-sobre" points="${caminho.join(' ')}"/>` : '';
  raiz.innerHTML = moldura(`<svg viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Gráfico de colunas">${grade}<line class="base" x1="${m.esq}" x2="${largura - m.dir}" y1="${y(0)}" y2="${y(0)}"/>${barras}${desenhoLinha}</svg>`, legenda(series));
  ligarDicas(raiz);
}

/** Uma barra com a ponta de cima arredondada (4px) e a base reta. */
function barraArredondada(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

// ── áreas empilhadas acima e abaixo do zero, com uma linha ──────────────────

/**
 * `pontos`: [{ rotulo, dica, acima: [valor], abaixo: [valor], linha }] — a
 * mesma ordem de séries em todos. `acima`/`abaixo`: [{ nome, cor }].
 */
export function areas(raiz, { pontos, acima, abaixo, linha, formatar, altura = 220 }) {
  const largura = larguraDe(raiz);
  const m = { cima: 12, baixo: 26, esq: 62, dir: 16 };
  const somaAcima = pontos.map((p) => p.acima.reduce((t, v) => t + Math.max(0, v), 0));
  const somaAbaixo = pontos.map((p) => -p.abaixo.reduce((t, v) => t + Math.max(0, v), 0));
  const { y, marcas } = escala([...somaAcima, ...somaAbaixo, ...pontos.map((p) => p.linha)], altura - m.cima - m.baixo, m.cima);
  const x = (i) => m.esq + (pontos.length === 1 ? 0 : (i / (pontos.length - 1)) * (largura - m.esq - m.dir));
  const camadas = (lista, sinal, chave) => {
    const base = pontos.map(() => 0);
    return lista.map((s, si) => {
      const de = [...base];
      pontos.forEach((p, i) => { base[i] += sinal * Math.max(0, p[chave][si]); });
      const ida = pontos.map((_, i) => `${x(i)},${y(base[i])}`);
      const volta = pontos.map((_, i) => `${x(i)},${y(de[i])}`).reverse();
      return `<polygon class="camada" points="${[...ida, ...volta].join(' ')}" fill="${s.cor}"/>`;
    }).join('');
  };
  const grade = marcas.map((v) => `<line class="grade" x1="${m.esq}" x2="${largura - m.dir}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="eixo" x="${m.esq - 8}" y="${y(v) + 4}" text-anchor="end">${esc(formatar(v))}</text>`).join('');
  const cabem = Math.max(2, Math.floor((largura - m.esq - m.dir) / 50));
  const pulo = Math.ceil(pontos.length / cabem);
  const rotulos = pontos.map((p, i) => (i % pulo === 0 || i === pontos.length - 1
    ? `<text class="eixo" x="${x(i)}" y="${altura - 8}" text-anchor="middle">${esc(p.rotulo)}</text>` : '')).join('');
  const meio = (i) => (i === 0 ? 0 : (x(i) + x(i - 1)) / 2);
  const alvos = pontos.map((p, i) => {
    const fim = i === pontos.length - 1 ? largura - m.dir : (x(i) + x(i + 1)) / 2;
    const ini = i === 0 ? m.esq : meio(i);
    return `<rect class="alvo" x="${ini}" y="${m.cima}" width="${Math.max(1, fim - ini)}" height="${altura - m.cima - m.baixo}" data-dica="${esc(p.dica)}" tabindex="0"/>`;
  }).join('');
  const caminho = pontos.map((p, i) => `${x(i)},${y(p.linha)}`).join(' ');
  const pontosLinha = pontos.map((p, i) => `<circle class="ponto-linha" cx="${x(i)}" cy="${y(p.linha)}" r="4"/>`).join('');
  raiz.innerHTML = moldura(`<svg viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Gráfico de áreas">
      ${grade}${camadas(acima, 1, 'acima')}${camadas(abaixo, -1, 'abaixo')}
      <line class="base" x1="${m.esq}" x2="${largura - m.dir}" y1="${y(0)}" y2="${y(0)}"/>
      <polyline class="linha-total" points="${caminho}"/>${pontosLinha}${rotulos}${alvos}</svg>`,
  legenda([...acima, ...abaixo, { ...linha, linha: true }]));
  ligarDicas(raiz);
}

// ── várias linhas no mesmo eixo, com o cursor que lê todas ──────────────────

/**
 * `series`: [{ nome, cor, valores: [y|null], fina }] — mesma quantidade de
 * pontos. `rotulos`: o texto do eixo X de cada ponto. `dica(i)`: HTML da dica.
 */
export function linhas(raiz, { series, rotulos, dica, formatar, altura = 200, marcas = [] }) {
  const largura = larguraDe(raiz);
  const m = { cima: 16, baixo: 26, esq: 62, dir: 16 };
  const n = rotulos.length;
  const { y, marcas: ticks } = escala(series.flatMap((s) => s.valores.filter((v) => v != null)), altura - m.cima - m.baixo, m.cima);
  const x = (i) => m.esq + (n === 1 ? 0 : (i / (n - 1)) * (largura - m.esq - m.dir));
  const grade = ticks.map((v) => `<line class="grade" x1="${m.esq}" x2="${largura - m.dir}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="eixo" x="${m.esq - 8}" y="${y(v) + 4}" text-anchor="end">${esc(formatar(v))}</text>`).join('');
  const desenho = series.map((s) => {
    const pts = s.valores.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
    return `<polyline class="serie ${s.fina ? 'fina' : ''}" points="${pts.join(' ')}" style="stroke:${s.cor}"/>`;
  }).join('');
  const destaques = marcas.map(({ serie, i, texto }) => {
    const v = series[serie].valores[i];
    if (v == null) return '';
    const ancora = x(i) > largura * 0.7 ? 'end' : 'start';
    return `<circle class="marca-serie" cx="${x(i)}" cy="${y(v)}" r="4.5" style="fill:${series[serie].cor}"/>
      <text class="rotulo-marca" x="${x(i) + (ancora === 'end' ? -8 : 8)}" y="${y(v) - 8}" text-anchor="${ancora}">${esc(texto)}</text>`;
  }).join('');
  const cabem = Math.max(2, Math.floor((largura - m.esq - m.dir) / 40));
  const pulo = Math.ceil(n / cabem);
  const rx = rotulos.map((r, i) => (i % pulo === 0 || i === n - 1 ? `<text class="eixo" x="${x(i)}" y="${altura - 8}" text-anchor="middle">${esc(r)}</text>` : '')).join('');
  const passo = (largura - m.esq - m.dir) / Math.max(1, n - 1);
  const alvos = rotulos.map((_, i) => `<rect class="alvo" x="${Math.max(m.esq, x(i) - passo / 2)}" y="${m.cima}" width="${passo}" height="${altura - m.cima - m.baixo}" data-dica="${esc(dica(i))}" data-i="${i}" tabindex="0"/>`).join('');
  raiz.innerHTML = moldura(`<svg viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Gráfico de linhas">${grade}${desenho}${destaques}${rx}
    <line class="cursor" x1="0" x2="0" y1="${m.cima}" y2="${altura - m.baixo}" visibility="hidden"/>${alvos}</svg>`, legenda(series.map((s) => ({ ...s, linha: true }))));
  ligarDicas(raiz);
  // O cursor vertical acompanha a dica.
  const cursor = raiz.querySelector('.cursor');
  raiz.addEventListener('pointermove', (e) => {
    const alvo = e.target.closest('[data-i]');
    if (!alvo) { cursor.setAttribute('visibility', 'hidden'); return; }
    const cx = x(Number(alvo.dataset.i));
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
  });
  raiz.addEventListener('pointerleave', () => cursor.setAttribute('visibility', 'hidden'));
}

// ── pizza (rosca) com a lista ao lado ───────────────────────────────────────

/**
 * `fatias`: [{ nome, valor, cor }] — no máximo 7 com cor; o resto vira
 * "outros", neutro. Ao lado, a lista com valor e parte de cada uma: a cor
 * nunca é o único jeito de saber quem é quem.
 */
export function pizza(raiz, { fatias, formatar, centro = '', subtitulo = '' }) {
  const ordenadas = fatias.filter((f) => f.valor > 0).sort((a, b) => b.valor - a.valor);
  const principais = ordenadas.slice(0, ordenadas.length > 7 ? 6 : 7);
  const resto = ordenadas.slice(principais.length);
  const lista = resto.length ? [...principais, { nome: 'outros', valor: resto.reduce((t, f) => t + f.valor, 0), cor: COR_NEUTRA }] : principais;
  const total = lista.reduce((t, f) => t + f.valor, 0);
  if (!total) { raiz.innerHTML = '<p class="nota-rel">Nada para mostrar.</p>'; return; }
  const R = 80;
  const r = 52;
  const c = 90;
  let ang = -Math.PI / 2;
  // 2px de fresta entre as fatias, em ângulo no raio de fora.
  const fresta = lista.length > 1 ? 2 / R : 0;
  const arcos = lista.map((f) => {
    const a = (f.valor / total) * Math.PI * 2;
    const a0 = ang + fresta / 2;
    const a1 = ang + Math.max(fresta / 2 + 0.001, a - fresta / 2);
    ang += a;
    const grande = a1 - a0 > Math.PI ? 1 : 0;
    const p = (raio, t) => `${(c + raio * Math.cos(t)).toFixed(2)},${(c + raio * Math.sin(t)).toFixed(2)}`;
    const d = lista.length === 1
      ? `M${c},${c - R} A${R},${R} 0 1 1 ${c - 0.01},${c - R} L${c - 0.01},${c - r} A${r},${r} 0 1 0 ${c},${c - r} Z`
      : `M${p(R, a0)} A${R},${R} 0 ${grande} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${grande} 0 ${p(r, a0)} Z`;
    const dica = `<strong>${esc(formatar(f.valor))}</strong><span>${esc(f.nome)} · ${Math.round((f.valor / total) * 100)}%</span>`;
    return `<path class="fatia" d="${d}" fill="${f.cor}" data-dica="${esc(dica)}" tabindex="0"/>`;
  }).join('');
  const itens = lista.map((f) => `<li><i style="background:${f.cor}"></i><span class="nome-fatia">${esc(f.nome)}</span>
      <span class="valor-fatia">${esc(formatar(f.valor))}</span><span class="parte-fatia">${Math.round((f.valor / total) * 100)}%</span></li>`).join('');
  raiz.innerHTML = `<div class="pizza"><div class="grafico grafico-pizza">
      <svg viewBox="0 0 180 180" role="img" aria-label="Gráfico de pizza">${arcos}
        <text class="centro-pizza" x="90" y="${subtitulo ? 88 : 95}" text-anchor="middle">${esc(centro)}</text>
        ${subtitulo ? `<text class="sub-pizza" x="90" y="106" text-anchor="middle">${esc(subtitulo)}</text>` : ''}</svg>
      <div class="dica-grafico" hidden></div></div>
    <ol class="lista-pizza">${itens}</ol></div>`;
  ligarDicas(raiz);
}

// ── mapa de blocos (treemap) ────────────────────────────────────────────────

/**
 * `itens`: [{ nome, valor, dica }] — o tamanho do bloco é o peso. Uma cor só
 * (a tinta), mais forte nos maiores: é magnitude, não identidade. O nome vai
 * dentro só quando cabe; senão, fica na dica.
 */
export function mapaDeBlocos(raiz, { itens, formatar, altura = 240 }) {
  const lista = itens.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor);
  if (!lista.length) { raiz.innerHTML = ''; return; }
  const largura = larguraDe(raiz, 280);
  const total = lista.reduce((t, i) => t + i.valor, 0);
  const blocos = [];
  quadricular(lista.map((i) => ({ ...i, area: (i.valor / total) * largura * altura })), 0, 0, largura, altura, blocos);
  const maior = lista[0].valor;
  const svg = blocos.map((b) => {
    const forca = 0.25 + 0.65 * (b.valor / maior);
    const escuro = forca >= 0.5;
    const cabeNome = b.w > 64 && b.h > 34;
    const nome = cabeNome ? cortar(b.nome, Math.floor((b.w - 12) / 7)) : '';
    return `<g class="bloco-mapa" data-dica="${esc(b.dica)}" tabindex="0">
      <rect x="${b.x + 1}" y="${b.y + 1}" width="${Math.max(0, b.w - 2)}" height="${Math.max(0, b.h - 2)}" rx="4" style="fill-opacity:${forca.toFixed(2)}"/>
      ${nome ? `<text class="${escuro ? 'claro' : ''}" x="${b.x + 8}" y="${b.y + 18}">${esc(nome)}</text>
        ${b.h > 50 ? `<text class="${escuro ? 'claro' : ''} miudo-mapa" x="${b.x + 8}" y="${b.y + 34}">${esc(formatar(b.valor))} · ${Math.round((b.valor / total) * 100)}%</text>` : ''}` : ''}
    </g>`;
  }).join('');
  raiz.innerHTML = moldura(`<svg class="mapa" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Mapa das categorias">${svg}</svg>`);
  ligarDicas(raiz);
}

const cortar = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

/** O algoritmo "squarified": blocos o mais quadrados possível. */
function quadricular(itens, x, y, w, h, saida) {
  if (!itens.length) return;
  if (itens.length === 1) { saida.push({ ...itens[0], x, y, w, h }); return; }
  const lado = Math.min(w, h);
  let fila = [];
  let resto = itens;
  const pior = (f) => {
    const s = f.reduce((t, i) => t + i.area, 0);
    const maxA = Math.max(...f.map((i) => i.area));
    const minA = Math.min(...f.map((i) => i.area));
    return Math.max((lado * lado * maxA) / (s * s), (s * s) / (lado * lado * minA));
  };
  while (resto.length) {
    const nova = [...fila, resto[0]];
    if (fila.length && pior(nova) > pior(fila)) break;
    fila = nova;
    resto = resto.slice(1);
  }
  const soma = fila.reduce((t, i) => t + i.area, 0);
  if (w >= h) {
    const largFila = soma / h;
    let yy = y;
    for (const i of fila) { const hh = i.area / largFila; saida.push({ ...i, x, y: yy, w: largFila, h: hh }); yy += hh; }
    quadricular(resto, x + largFila, y, w - largFila, h, saida);
  } else {
    const altFila = soma / w;
    let xx = x;
    for (const i of fila) { const ww = i.area / altFila; saida.push({ ...i, x: xx, y, w: ww, h: altFila }); xx += ww; }
    quadricular(resto, x, y + altFila, w, h - altFila, saida);
  }
}
