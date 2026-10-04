// O térreo, no celular: captura em tela inteira, que é onde o app abre (D11).
// O formulário em si mora em js/app/formulario.js, compartilhado com o diálogo
// do PC — duas formas, um comportamento.

import { criarFormulario } from './app/formulario.js';
import { instalarServiceWorker } from './app/instalar.js';
import { iniciarSincronia } from './app/sincronia-viva.js';
import { ligarAutomaticas } from './app/automaticas.js';

const formulario = await criarFormulario({
  raiz: document.getElementById('formulario'),
  acoes: [{ id: 'lancar', rotulo: 'Lançar', principal: true, fecha: false }],
  // No térreo a conta segue a última usada na categoria escolhida (03 §1).
  lembrarConta: true,
});

formulario.focar();

// As contas fixas que caem sozinhas caem também quando se abre só o térreo.
ligarAutomaticas();

instalarServiceWorker();

// O térreo sincroniza em silêncio: o que se lança na fila do mercado sobe
// sozinho, e nenhuma falha de rede aparece numa tela que só serve pra lançar.
await iniciarSincronia();
