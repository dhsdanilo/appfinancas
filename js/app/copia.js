// A cópia de segurança em Configurações › Avançado: guardar um arquivo com tudo e
// restaurar a partir dele. A conta toda mora em js/core/copia.js.

import { criarCopia, lerCopia, conferirCopia, restaurarCopia, ultimaCopia, nomeDoArquivo, ErroDaCopia, TAMANHO_MINIMO_DA_FRASE } from '../core/copia.js';
import { hoje } from '../core/datas.js';
import * as db from '../core/db.js';

const $ = (id) => document.getElementById(id);

/** "hoje", "há 5 dias", ou "nunca". */
function quando(dia) {
  if (!dia) return 'ainda não guardada neste aparelho';
  const dias = Math.round((Date.parse(hoje()) - Date.parse(dia)) / 86400000);
  return dias <= 0 ? 'hoje' : `há ${dias} dia${dias === 1 ? '' : 's'} (${dia.slice(8, 10)}/${dia.slice(5, 7)})`;
}

export async function ligarCopia() {
  const dialogo = $('dialogo-copia');
  if (!dialogo || !$('cp-guardar')) return;
  let modo = null;         // 'guardar' | 'restaurar'
  let conteudo = null;     // o texto do arquivo escolhido
  let aberta = null;       // { novos, total, jaTem } depois da frase certa

  const avisar = (texto) => { $('cp-aviso').textContent = texto; $('cp-aviso').hidden = !texto; };

  async function pintarUltima() {
    const n = await db.contarEventos();
    $('cp-ultima').textContent = `Última cópia: ${quando(ultimaCopia())} · ${n.toLocaleString('pt-BR')} registros neste aparelho.`;
  }

  function abrir(m) {
    modo = m;
    aberta = null;
    $('cp-frase').value = '';
    $('cp-confirma').value = '';
    $('cp-previa').hidden = true;
    $('cp-previa').innerHTML = '';
    avisar('');
    $('cp-campo-confirma').hidden = m !== 'guardar';
    $('cp-frase').disabled = false;
    $('cp-ok').textContent = 'Continuar';
    $('cp-texto').textContent = m === 'guardar'
      ? `Escolha uma frase de pelo menos ${TAMANHO_MINIMO_DA_FRASE} caracteres. Pode ser a mesma da sincronização. Anote: sem ela a cópia não abre.`
      : 'Digite a frase que você usou ao guardar esta cópia.';
    dialogo.showModal();
    $('cp-frase').focus();
  }

  $('cp-guardar').addEventListener('click', () => abrir('guardar'));
  $('cp-restaurar').addEventListener('click', () => { $('cp-arquivo').value = ''; $('cp-arquivo').click(); });
  $('cp-arquivo').addEventListener('change', async () => {
    const arquivo = $('cp-arquivo').files?.[0];
    if (!arquivo) return;
    conteudo = await arquivo.text();
    abrir('restaurar');
    $('cp-texto').textContent = `${arquivo.name}: digite a frase que você usou ao guardar esta cópia.`;
  });

  $('f-copia').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    avisar('');
    const frase = $('cp-frase').value;
    try {
      if (modo === 'guardar') {
        if (frase !== $('cp-confirma').value) return avisar('As duas frases não são iguais.');
        const { texto, registros } = await criarCopia(frase);
        const ancora = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(new Blob([texto], { type: 'application/json' })),
          download: nomeDoArquivo(),
        });
        document.body.append(ancora);
        ancora.click();
        ancora.remove();
        setTimeout(() => URL.revokeObjectURL(ancora.href), 10000);
        dialogo.close();
        await pintarUltima();
        $('cp-ultima').textContent += ` Guardada agora: ${registros.toLocaleString('pt-BR')} registros.`;
        return;
      }
      // restaurar: primeiro a prévia, depois a confirmação
      if (!aberta) {
        const { eventos } = await lerCopia(conteudo, frase);
        aberta = await conferirCopia(eventos);
        $('cp-frase').disabled = true;
        $('cp-previa').hidden = false;
        $('cp-previa').innerHTML = `<table class="tabelinha-copia">
          <tr><td>registros no arquivo</td><td>${aberta.total.toLocaleString('pt-BR')}</td></tr>
          <tr><td>já estão neste aparelho</td><td>${aberta.jaTem.toLocaleString('pt-BR')}</td></tr>
          <tr><td><strong>novos para acrescentar</strong></td><td><strong>${aberta.novos.length.toLocaleString('pt-BR')}</strong></td></tr></table>
          <p class="nota">Restaurar só acrescenta o que falta. Nada que você tem é apagado.</p>`;
        $('cp-ok').textContent = aberta.novos.length ? `Acrescentar ${aberta.novos.length.toLocaleString('pt-BR')}` : 'Nada a acrescentar';
        $('cp-ok').disabled = !aberta.novos.length;
        return;
      }
      $('cp-ok').disabled = true;
      const n = await restaurarCopia(aberta.novos);
      dialogo.close();
      await pintarUltima();
      $('cp-ultima').textContent += ` Restaurados agora: ${n.toLocaleString('pt-BR')} registros.`;
    } catch (erro) {
      avisar(erro instanceof ErroDaCopia ? erro.message : `Não deu: ${erro.message}`);
      $('cp-ok').disabled = false;
    }
  });
  dialogo.addEventListener('close', () => { $('cp-frase').value = ''; $('cp-confirma').value = ''; $('cp-ok').disabled = false; conteudo = null; aberta = null; });

  document.addEventListener('app:tela', (e) => { if (e.detail.tela === 'configuracoes') pintarUltima(); });
  await pintarUltima();
}
