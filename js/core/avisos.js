// Os avisos da página inicial (06/10/2026): o que merece um olhar agora e que não
// é uma pendência de um toque (essas moram na fila "Precisa de você"). Tudo
// derivado do estado; nada é gravado.
//
// { nivel: 'ruim' | 'atencao' | 'info', titulo, detalhe, para }
// `para` diz para onde o aviso leva: { conta, mes } ou { tela }.

import { hoje } from './datas.js';
import { formatar } from './dinheiro.js';
import { temCiclo } from './cartao.js';
import { resumoDoCartao, saldoPrevisto } from './previsto.js';
import { provisaoDoCartao } from './cofrinho.js';
import { envelopesAtivos, donosNoDia, numerosDoEnvelope } from './envelopes.js';
import { aReceber } from './repasse.js';

const ORDEM = { ruim: 0, atencao: 1, info: 2 };
const dias = (de, ate) => Math.round((Date.parse(ate) - Date.parse(de)) / 86400000);

export function avisosDoInicio(estado, dia = hoje()) {
  const lista = [];

  for (const c of Object.values(estado.contas)) {
    if (c.tipo !== 'cartao' || c.arquivada || !temCiclo(c)) continue;
    const r = resumoDoCartao(estado, c.id, dia);
    let venceEm = null;
    if (r?.fechada) {
      venceEm = dias(dia, r.fechada.vencimento);
      const quando = venceEm < 0 ? `vencida há ${-venceEm} dia${venceEm === -1 ? '' : 's'}` : venceEm === 0 ? 'vence hoje' : `vence em ${venceEm} dia${venceEm === 1 ? '' : 's'}`;
      lista.push({
        nivel: venceEm < 0 ? 'ruim' : venceEm <= 7 ? 'atencao' : 'info',
        titulo: `Fatura ${c.nome} ${quando}`,
        detalhe: `${formatar(r.fechada.aPagar)} a pagar`,
        para: { conta: c.id, mes: r.fechada.vencimento.slice(0, 7) },
      });
    } else if (r?.aberta) {
      venceEm = dias(dia, r.aberta.vencimento);
    }
    // O cofrinho abaixo do que o cartão deve: urgente quando o vencimento está perto.
    const p = provisaoDoCartao(estado, c.id, dia);
    if (p && p.falta > 0 && p.alvo > 0) {
      lista.push({
        nivel: venceEm != null && venceEm <= 10 ? 'atencao' : 'info',
        titulo: `Cofrinho cobre ${Math.round((p.provisionado / p.alvo) * 100)}% do ${c.nome}`,
        detalhe: `faltam ${formatar(p.falta)}`,
        para: { conta: c.id, mes: (r?.aberta?.vencimento ?? '').slice(0, 7) || null },
      });
    }
  }

  for (const c of Object.values(estado.contas)) {
    if ((c.tipo !== 'corrente' && c.tipo !== 'especie') || c.arquivada) continue;
    const p = saldoPrevisto(estado, c.id, dia);
    if (p.previsto < 0) {
      lista.push({
        nivel: 'ruim',
        titulo: `${c.nome}: o saldo previsto fica negativo`,
        detalhe: `${formatar(-p.previsto)} abaixo de zero até o fim do mês`,
        para: { conta: c.id, mes: null },
      });
    }
  }

  const donos = donosNoDia(estado, dia);
  for (const v of envelopesAtivos(estado)) {
    const total = donos.porEnvelope.get(v.id)?.total ?? 0;
    const n = numerosDoEnvelope(v, total, dia);
    if (n.deveriaTer != null && total < n.deveriaTer) {
      lista.push({
        nivel: 'atencao',
        titulo: `${v.nome} está atrasado`,
        detalhe: `faltam ${formatar(n.deveriaTer - total)} para o ritmo`,
        para: { tela: 'envelopes' },
      });
    }
  }

  for (const pessoaId of Object.keys(estado.pessoas ?? {})) {
    for (const x of aReceber(estado, pessoaId, dia)) {
      lista.push({
        nivel: 'info',
        titulo: `${estado.pessoas[x.pessoa]?.nome ?? 'Alguém'} ainda deve repassar`,
        detalhe: formatar(x.aRepassar),
        para: { tela: 'cartoes' },
      });
    }
  }

  return lista.sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel]);
}
