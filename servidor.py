"""Servidor de desenvolvimento.

Existe por um motivo só: o `python -m http.server` não manda cabeçalho de cache,
e aí o navegador aplica cache heurístico e serve MÓDULO VELHO depois de uma
edição. O sintoma é cruel — o arquivo no disco está certo, a busca manual traz
o certo, e a página roda o antigo.

Em produção (GitHub Pages) quem garante a atualização é o service worker, que
busca com `cache: 'no-store'`. Aqui, no desenvolvimento, é este cabeçalho.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class SemCache(SimpleHTTPRequestHandler):
    # HTTP/1.1 com keep-alive. Em HTTP/1.0 cada arquivo abre e fecha uma conexão,
    # e uma página de módulos ES abre dezenas de uma vez — no Windows isso derruba
    # requisição de vez em quando, e o service worker, vendo a falha, serve a
    # cópia velha do cache. O sintoma é o mesmo da falta de Cache-Control, e a
    # causa é outra.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, formato, *args):
        # Só o que interessa: erro. Requisição boa não precisa virar ruído.
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(formato, *args)


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    pasta = sys.argv[2] if len(sys.argv) > 2 else "."
    manipulador = partial(SemCache, directory=pasta)
    print(f"servindo {pasta} em http://localhost:{porta} (sem cache)")
    ThreadingHTTPServer(("127.0.0.1", porta), manipulador).serve_forever()
