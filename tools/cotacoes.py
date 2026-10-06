#!/usr/bin/env python3
"""Gera cotacoes.json: o fechamento dos últimos pregões da B3 (ações, FIIs, ETFs)
e o preço de venda dos títulos do Tesouro Direto.

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
import urllib.request
from datetime import date, datetime, timedelta, timezone

PREGOES = 10  # quantos pregões guardar: cobre uma semana sem sincronizar
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


def tesouro():
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
        nomes[chave] = f"{r['Tipo Titulo']} {venc[:4]}"
        p.setdefault(chave, [None] * len(datas))[indice[base]] = valor
    return {'datas': datas, 'p': p, 'nomes': nomes}


def main():
    saida = {
        'gerado': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'acoes': acoes(),
        'tesouro': tesouro(),
    }
    if not saida['acoes']['datas'] or not saida['tesouro']['datas']:
        sys.exit('sem dados: não sobrescrevo o arquivo antigo')
    with open('cotacoes.json', 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, separators=(',', ':'))
    print('acoes:', len(saida['acoes']['p']), 'papéis,', saida['acoes']['datas'][-1])
    print('tesouro:', len(saida['tesouro']['p']), 'títulos,', saida['tesouro']['datas'][-1])


if __name__ == '__main__':
    main()
