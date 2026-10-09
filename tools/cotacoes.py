#!/usr/bin/env python3
"""Gera cotacoes.json: o fechamento dos últimos pregões da B3 (ações, FIIs, ETFs)
e o preço de venda dos títulos do Tesouro Direto (o da manhã, do arquivo aberto, e o de fim
do dia, lido do site do Tesouro depois das 18h, que o substitui e fica guardado em `fechamento`).

Só biblioteca padrão; sem chave, sem login. As fontes são os arquivos públicos da
própria B3 e do Tesouro Transparente. O arquivo é igual para todo mundo — não
revela o que ninguém tem. O app o lê ao sincronizar (js/core/cotacoes.js).

Preços em centavos inteiros. Cada série é alinhada às `datas` do seu grupo
(`null` onde o papel não negociou).
"""
import csv
import io
import json
import sys
import unicodedata
import urllib.request
from datetime import date, datetime, timedelta, timezone

PREGOES = 10  # quantos pregões guardar: cobre uma semana sem sincronizar
BRT = timezone(timedelta(hours=-3))
FECHA_O_PREGAO = 18 * 60 + 10  # o Tesouro Direto fecha às 18h; dez minutos de folga
B3 = 'https://arquivos.b3.com.br/api/'
TESOURO = ('https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/'
           'resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv')


def baixar(url, tentativas=3):
    ultimo = None
    for _ in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (appfinancas-cotacoes)'})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as erro:  # noqa: BLE001 — tenta de novo, depois desiste
            ultimo = erro
    raise ultimo


def centavos(texto):
    texto = (texto or '').strip().replace('.', '').replace(',', '.')
    if not texto:
        return None
    try:
        return round(float(texto) * 100)
    except ValueError:
        return None


def pregao_da_b3(dia):
    """{ticker: centavos} do dia, ou None se a B3 não tem arquivo (fim de semana, feriado)."""
    try:
        pedido = json.loads(baixar(f'{B3}download/requestname?fileName=TradeInformationConsolidatedFile&date={dia.isoformat()}'))
        url = pedido.get('redirectUrl')
        if not url:
            return None
        bruto = baixar(B3 + url.lstrip('~/'))
    except Exception:  # noqa: BLE001
        return None
    texto = bruto.decode('utf-8', errors='replace')
    linhas = texto.splitlines()
    if len(linhas) < 3 or 'Status do Arquivo' not in linhas[0]:
        return None
    leitor = csv.DictReader(linhas[1:], delimiter=';')
    precos = {}
    for r in leitor:
        if r.get('SgmtNm') != 'CASH' or r.get('RptDt') != dia.isoformat():
            continue
        p = centavos(r.get('LastPric'))
        if p:
            precos[r['TckrSymb']] = p
    return precos or None


def acoes():
    hoje = date.today()
    dias, series = [], []
    dia = hoje
    while len(dias) < PREGOES and (hoje - dia).days < 30:
        if dia.weekday() < 5:
            p = pregao_da_b3(dia)
            if p:
                dias.append(dia.isoformat())
                series.append(p)
        dia -= timedelta(days=1)
    dias.reverse()
    series.reverse()
    tickers = sorted({t for s in series for t in s})
    return {'datas': dias, 'p': {t: [s.get(t) for s in series] for t in tickers}}


def nome_do_titulo(tipo, venc):
    """O nome que o Tesouro Direto usa. No Renda+ e no Educa+ o ano do nome é o do
    primeiro pagamento, não o do vencimento: o Renda+ 2065 paga por 20 anos e vence
    em 2084; o Educa+ 2030 paga por 5 anos e vence em 2034."""
    ano = int(venc[:4])
    if tipo == 'Tesouro Renda+ Aposentadoria Extra':
        return f'{tipo} {ano - 19} · vence {ano}'
    if tipo == 'Tesouro Educa+':
        return f'{tipo} {ano - 4} · vence {ano}'
    return f'{tipo} {ano}'


# O preço de resgate que o próprio site do Tesouro mostra durante o pregão: o mesmo que o
# banco usa. Depois das 18h é o último preço do dia. O arquivo aberto (TESOURO) só tem o da
# manhã, então este o substitui nos dias em que foi guardado.
TESOURO_VIVO = 'https://www.tesourodireto.com.br/o/c/rentabilidades/?pageSize=200'


def sem_acento(texto):
    return unicodedata.normalize('NFKD', texto).encode('ascii', 'ignore').decode().lower()


def dia_do_pregao(agora):
    """O pregão a que `agora` pertence e se ele já fechou. O GitHub atrasa o agendamento em
    horas: uma execução das 20h30 que sai depois da meia-noite ainda é do pregão de ontem."""
    if agora.hour < 6:
        return (agora - timedelta(days=1)).date(), True
    return agora.date(), agora.hour * 60 + agora.minute >= FECHA_O_PREGAO


def fechamento_do_tesouro(chaves, itens, agora=None):
    """{chave: centavos} do preço de resgate de agora, só depois que o pregão fechou em dia
    útil (de manhã o site ainda mostra o de ontem). `chaves` são as do arquivo ("Tipo|AAAA-MM-DD")."""
    agora = agora or datetime.now(BRT)
    dia, fechou = dia_do_pregao(agora)
    if dia.weekday() >= 5 or not fechou:
        return {}
    achados = {}
    for x in itens:
        preco = centavos(str(x.get('unitaryRedemptionValue') or '').replace('.', ','))
        venc = (x.get('maturityDate') or '')[:10]
        nome = sem_acento(x.get('treasuryBondName') or '')
        if not preco or not venc:
            continue
        # O tipo mais longo que começa o nome: "IPCA+ com Juros Semestrais" antes de "IPCA+".
        candidatos = [k for k in chaves if k.split('|')[1] == venc and nome.startswith(sem_acento(k.split('|')[0]))]
        if candidatos:
            achados[max(candidatos, key=len)] = preco
    return achados


def tesouro(antigo=None):
    texto = baixar(TESOURO).decode('utf-8', errors='replace')
    linhas = list(csv.DictReader(io.StringIO(texto), delimiter=';'))

    def dia(txt):
        d, m, a = txt.split('/')
        return f'{a}-{m}-{d}'

    datas = sorted({dia(r['Data Base']) for r in linhas}, reverse=True)[:PREGOES]
    datas.reverse()
    indice = {d: i for i, d in enumerate(datas)}
    hoje = date.today().isoformat()
    p, nomes = {}, {}
    for r in linhas:
        base = dia(r['Data Base'])
        if base not in indice:
            continue
        venc = dia(r['Data Vencimento'])
        if venc < hoje:
            continue
        valor = centavos(r['PU Venda Manha'])
        if not valor:
            continue
        chave = f"{r['Tipo Titulo']}|{venc}"
        nomes[chave] = nome_do_titulo(r['Tipo Titulo'], venc)
        p.setdefault(chave, [None] * len(datas))[indice[base]] = valor

    # Os preços de fim de dia: os que já estavam guardados e o de hoje, se o pregão fechou.
    fechamentos = {k: dict(v) for k, v in ((antigo or {}).get('fechamento') or {}).items()}
    hoje_brt = dia_do_pregao(datetime.now(BRT))[0].isoformat()
    try:
        vivos = fechamento_do_tesouro(list(p), json.loads(baixar(TESOURO_VIVO))['items'])
    except Exception as erro:  # noqa: BLE001 — sem o preço de fim de dia, vale o da manhã
        print('tesouro ao vivo indisponível:', erro)
        vivos = {}
    for chave, preco in vivos.items():
        fechamentos.setdefault(chave, {})[hoje_brt] = preco
    # O dia de fim de dia pode ainda não estar no arquivo aberto (ele chega depois): entra
    # assim mesmo, e quando chegar o preço de fechamento continua mandando sobre o da manhã.
    por_dia = {k: dict(zip(datas, serie)) for k, serie in p.items()}
    for chave, dias in fechamentos.items():
        if chave in por_dia:
            por_dia[chave].update(dias)
    datas = sorted({d for m in por_dia.values() for d in m} | set(datas))[-PREGOES:]
    p = {k: [m.get(d) for d in datas] for k, m in por_dia.items()}
    fechamentos = {k: {d: v for d, v in dias.items() if d in datas} for k, dias in fechamentos.items()}
    return {'datas': datas, 'p': p, 'nomes': nomes, 'fechamento': {k: v for k, v in fechamentos.items() if v}}


def main():
    try:
        with open('cotacoes.json', encoding='utf-8') as f:
            antigo = json.load(f).get('tesouro')
    except (OSError, ValueError):
        antigo = None
    saida = {
        'gerado': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'acoes': acoes(),
        'tesouro': tesouro(antigo),
    }
    if not saida['acoes']['datas'] or not saida['tesouro']['datas']:
        sys.exit('sem dados: não sobrescrevo o arquivo antigo')
    with open('cotacoes.json', 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, separators=(',', ':'))
    print('acoes:', len(saida['acoes']['p']), 'papéis,', saida['acoes']['datas'][-1])
    print('tesouro:', len(saida['tesouro']['p']), 'títulos,', saida['tesouro']['datas'][-1])


if __name__ == '__main__':
    main()
