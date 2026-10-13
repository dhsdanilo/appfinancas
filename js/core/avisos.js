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
import { compromissoDaEnergia } from './energia-envelope.js';
import { parcelasEmDobro } from './parcelas.js';
import { lancados } from './lancamentos.js';

const ORDEM = { ruim: 0, atencao: 1, info: 2 };
const dias = (de, ate) => Math.round((Date.parse(ate) - Date.parse(de)) / 86400000);

/**
 * `ultimaCopia`: o dia da última cópia de segurança deste aparelho (null = nunca), ou
 * undefined para não avisar disso (os testes e as telas que não sabem).
 */
export function avisosDoInicio(estado, dia = hoje(), { ultimaCopia } = {}) {
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
        titulo: `${p.cofrinho.nome} cobre ${Math.round((p.provisionado / p.alvo) * 100)}% do ${c.nome}`,
        detalhe: `faltam ${formatar(p.falta)}`,
        para: { conta: c.id, mes: (r?.aberta?.vencimento ?? '').slice(0, 7) || null },
      });
    }
  }

  // A fatura de um cartão sem conta que a pague, ou com a conta arquivada, some do previsto de todas (auditoria L5).
  for (const c of Object.values(estado.contas)) {
    if (c.tipo !== 'cartao' || c.arquivada || !temCiclo(c)) continue;
    const paga = estado.contas[c.pagaCom];
    if (!paga || paga.arquivada) {
      lista.push({
        nivel: 'atencao',
        titulo: `${c.nome}: falta a conta que paga a fatura`,
        detalhe: paga ? `${paga.nome} está arquivada` : 'sem ela, a fatura não pesa em saldo nenhum',
        para: { conta: c.id, mes: null },
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
    // Projeto que já está pagando (IPVA pago pelo envelope) não está "atrasado" (auditoria I7).
    if ((donos.porEnvelope.get(v.id)?.custo ?? 0) > 0) continue;
    if (n.deveriaTer != null && total < n.deveriaTer) {
      lista.push({
        nivel: 'atencao',
        titulo: `${v.nome} está atrasado`,
        detalhe: `faltam ${formatar(n.deveriaTer - total)} para o ritmo`,
        para: { tela: 'envelopes' },
      });
    }
  }

  // O furo: dinheiro de envelope que já não existe no lugar (auditoria I5).
  for (const x of donos.furos) {
    lista.push({
      nivel: 'ruim',
      titulo: `${x.lugar.nome}: os envelopes têm ${formatar(x.furo)} a mais do que há aqui`,
      detalhe: 'confira os aportes e os gastos pagos com envelope',
      para: { tela: 'envelopes' },
    });
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

  // A parcela da dívida cai sozinha; uma transferência à mão no mesmo mês provavelmente a pagou de novo.
  for (const x of parcelasEmDobro(estado, lancados(estado), dia)) {
    const l = x.lancamento;
    lista.push({
      nivel: 'atencao',
      titulo: `${x.divida.nome}: parcela de ${l.dataCompetencia.slice(5, 7)}/${l.dataCompetencia.slice(0, 4)} em dobro?`,
      detalhe: `já cai sozinha (${formatar(x.parcela.valor)}) e há uma transferência de ${formatar(l.valor)} em ${l.dataCompetencia.slice(8, 10)}/${l.dataCompetencia.slice(5, 7)}: se ela é a parcela, marque "é a parcela" nela`,
      para: { conta: l.contaId, mes: l.dataCompetencia.slice(0, 7) },
    });
  }

  // O compromisso da Energia: o envelope cobra a economia dos meses que já venceram.
  const comp = compromissoDaEnergia(estado, dia);
  if (comp && comp.faltando > 0) {
    lista.push({
      nivel: 'atencao',
      titulo: `${comp.envelope.nome}: faltam ${formatar(comp.faltando)} depositar`,
      detalhe: 'compromisso da economia de energia',
      para: { tela: `envelopes/${comp.envelope.id}` },
    });
  }

  // Só cobra quem já tem o que perder: com contas cadastradas e sem cópia há mais de 14 dias.
  if (ultimaCopia !== undefined && Object.keys(estado.contas).length) {
    const faz = ultimaCopia ? dias(ultimaCopia, dia) : null;
    if (faz === null || faz > 14) {
      lista.push({
        nivel: faz === null || faz > 30 ? 'atencao' : 'info',
        titulo: faz === null ? 'Nenhuma cópia de segurança guardada' : `Última cópia de segurança há ${faz} dias`,
        detalhe: 'guardar agora',
        para: { tela: 'configuracoes/avancado' },
      });
    }
  }

  return lista.sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel]);
}
