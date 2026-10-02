// O registro do service worker, em um lugar só — e com uma regra.
//
// Em produção (GitHub Pages) ele é o que faz o app abrir sem internet
// (design/01-visao.md princípio 7) e o que entrega versão nova sem ninguém
// limpar nada, porque busca com `cache: 'no-store'`.
//
// **Em desenvolvimento ele é desligado.** Duas vezes num dia só ele serviu
// módulo velho depois de uma edição e, quando a busca dele falhou, respondeu
// 504 no lugar do arquivo — com a página rodando código que não existe mais no
// disco. É o mesmo sintoma cruel do cache do navegador que o `servidor.py`
// existe pra evitar: arquivo certo no disco, página errada na tela.
//
// O preço é não dar pra testar o modo offline em localhost. É um preço barato:
// offline se testa no app publicado, que é onde ele vale, e só na Fase 8.

const LOCAIS = ['localhost', '127.0.0.1', '[::1]', ''];

export function ehDesenvolvimento() {
  return LOCAIS.includes(location.hostname);
}

export function instalarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  if (ehDesenvolvimento()) {
    // Não basta não registrar: se um já ficou registrado de antes, ele continua
    // interceptando tudo nesta origem até ser removido à mão.
    navigator.serviceWorker.getRegistrations().then((registros) => {
      for (const registro of registros) registro.unregister();
    });
    return;
  }

  navigator.serviceWorker.register('sw.js').catch(() => {
    // Sem service worker o app continua funcionando; só não fica offline.
  });
}
