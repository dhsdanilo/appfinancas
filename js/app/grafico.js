// Gráfico de linha, em SVG, sem biblioteca (design/07 §3: nada de fora).
//
// Uma série só — o título diz o que é, então não há legenda. Linha de 2px,
// área numa lavada de 10%, grade em fio, e a camada de passar o mouse: uma
// linha vertical que acha o ponto mais perto e uma dica com o valor e o que
// aconteceu nele (dataviz: interação é parte do gráfico, não enfeite).

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Desenha em `raiz`. `pontos`: [{ y, rotulo, dica }] — y em centavos; dica é
 * HTML já escapado. `marcas`: índices a destacar com ponto e rótulo
 * ({ i, texto }). `formatar`: centavos → texto do eixo.
 */
export function graficoDeLinha(raiz, { pontos, marcas = [], formatar, altura = 220, rotulosX = [] }) {
  if (!pontos.length) { raiz.innerHTML = ''; return; }
  // A largura de verdade da tela: assim o texto dos eixos fica do tamanho
  // certo no celular, em vez de encolher junto com o desenho.
  const largura = Math.max(300, Math.round(raiz.clientWidth || 720));
  const m = { cima: 16, baixo: 26, esq: 70, dir: 16 };
  const ys = pontos.map((p) => p.y);
  let min = Math.min(0, ...ys);
  let max = Math.max(...ys);
  if (max === min) max = min + 100;
  // Folga e números redondos no eixo.
  const passo = redondo((max - min) / 4);
  min = Math.floor(min / passo) * passo;
  max = Math.ceil(max / passo) * passo;
  const x = (i) => m.esq + (pontos.length === 1 ? 0 : (i / (pontos.length - 1)) * (largura - m.esq - m.dir));
  const y = (v) => m.cima + (1 - (v - min) / (max - min)) * (altura - m.cima - m.baixo);

  const grade = [];
  for (let v = min; v <= max + 1; v += passo) {
    grade.push(`<line class="grade" x1="${m.esq}" x2="${largura - m.dir}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="eixo" x="${m.esq - 8}" y="${y(v) + 4}" text-anchor="end">${esc(formatar(v))}</text>`);
  }
  const zero = min < 0 ? `<line class="zero" x1="${m.esq}" x2="${largura - m.dir}" y1="${y(0)}" y2="${y(0)}"/>` : '';
  const caminho = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const area = `${caminho} L${x(pontos.length - 1).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)} Z`;
  // Rótulos do eixo X: no máximo um a cada ~70px.
  const cabem = Math.max(2, Math.floor((largura - m.esq - m.dir) / 70));
  const pulo = Math.ceil(rotulosX.length / cabem);
  const rx = rotulosX.filter((_, i) => i % pulo === 0 || i === rotulosX.length - 1).map(({ i, texto }) => `<text class="eixo" x="${x(i)}" y="${altura - 8}" text-anchor="middle">${esc(texto)}</text>`).join('');
  const destaques = marcas.map(({ i, texto, alerta }) => {
    const px = x(i);
    const py = y(pontos[i].y);
    const ancora = px > largura * 0.7 ? 'end' : px < largura * 0.3 ? 'start' : 'middle';
    return `<circle class="marca ${alerta ? 'alerta' : ''}" cx="${px}" cy="${py}" r="4.5"/>
      <text class="rotulo-marca" x="${px}" y="${py - 10}" text-anchor="${ancora}">${esc(texto)}</text>`;
  }).join('');

  raiz.innerHTML = `<div class="grafico">
    <svg viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Gráfico de linha">
      ${grade.join('')}${zero}
      <path class="area" d="${area}"/>
      <path class="linha" d="${caminho}"/>
      ${rx}${destaques}
      <line class="cursor" x1="0" x2="0" y1="${m.cima}" y2="${altura - m.baixo}" visibility="hidden"/>
      <circle class="ponto-cursor" r="4.5" visibility="hidden"/>
      <rect class="toque" x="${m.esq}" y="0" width="${largura - m.esq - m.dir}" height="${altura}" tabindex="0"/>
    </svg>
    <div class="dica-grafico" hidden></div>
  </div>`;

  const svg = raiz.querySelector('svg');
  const cursor = svg.querySelector('.cursor');
  const ponto = svg.querySelector('.ponto-cursor');
  const dica = raiz.querySelector('.dica-grafico');
  let atual = -1;
  const mostrar = (i) => {
    atual = Math.max(0, Math.min(pontos.length - 1, i));
    const px = x(atual);
    const py = y(pontos[atual].y);
    for (const el of [cursor]) { el.setAttribute('x1', px); el.setAttribute('x2', px); el.setAttribute('visibility', 'visible'); }
    ponto.setAttribute('cx', px); ponto.setAttribute('cy', py); ponto.setAttribute('visibility', 'visible');
    dica.innerHTML = pontos[atual].dica;
    dica.hidden = false;
    const caixa = svg.getBoundingClientRect();
    const escala = caixa.width / largura;
    const esquerda = px * escala;
    dica.style.left = `${Math.min(Math.max(0, esquerda - dica.offsetWidth / 2), caixa.width - dica.offsetWidth)}px`;
  };
  const esconder = () => {
    cursor.setAttribute('visibility', 'hidden');
    ponto.setAttribute('visibility', 'hidden');
    dica.hidden = true;
  };
  const toque = svg.querySelector('.toque');
  toque.addEventListener('pointermove', (e) => {
    const caixa = svg.getBoundingClientRect();
    const px = ((e.clientX - caixa.left) / caixa.width) * largura;
    const i = Math.round(((px - m.esq) / (largura - m.esq - m.dir)) * (pontos.length - 1));
    mostrar(i);
  });
  toque.addEventListener('pointerleave', esconder);
  toque.addEventListener('blur', esconder);
  toque.addEventListener('focus', () => mostrar(atual < 0 ? 0 : atual));
  toque.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); mostrar(atual + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); mostrar(atual - 1); }
  });
}

/** Um passo de eixo redondo: 1, 2 ou 5 vezes uma potência de 10. */
function redondo(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
