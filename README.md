# App Finanças

Controle financeiro familiar: **local, offline e sincronizado** entre os aparelhos de casa
por um repositório privado no GitHub. Sem servidor próprio, sem mensalidade, sem serviço de
terceiro no meio.

É um PWA estático — HTML, CSS e módulos ES servidos direto. **Sem build, sem dependência.**

## Rodar

Precisa de um servidor HTTP: módulos ES e service worker não funcionam em `file://`.

```bash
python servidor.py 8123 .
```

Depois abra <http://localhost:8123>.

## As telas

| Página | O que é |
|---|---|
| `index.html` | Captura em tela cheia — é onde o app abre no celular |
| `extrato.html` | Lançamentos e saldos, com captura, correção e transferência |
| `bancada.html` | Contas, categorias e etiquetas |
| `verificacao.html` | A suíte de verificação, rodando em banco separado |

## As quatro decisões que sustentam tudo

1. **O registro de eventos é a única verdade.** O estado é calculado, nunca armazenado.
   Editar e apagar são eventos novos; nada reescreve o passado.
2. **Dinheiro é centavo inteiro.** Nunca ponto flutuante — a vírgula só existe na tela.
3. **Migração é reinterpretação na leitura**, não reescrita do arquivo: o evento gravado
   hoje continua byte a byte igual daqui a dez anos.
4. **A ordem canônica é um relógio lógico**, não o horário. Relógio de celular erra, e os
   aparelhos precisam chegar ao mesmo resultado.

## Verificação

O botão **"Rodar verificação"** em `verificacao.html` roda a suíte contra um banco próprio,
que é apagado no fim. O caso que mais importa: *cache e recálculo do zero dão o mesmo
resultado* — se esses dois divergirem, o estado consolidado está mentindo.

---

O desenho do produto — decisões, telas, relatórios — mora fora deste repositório: ele
descreve a família que usa o app, e isso não é assunto público.
