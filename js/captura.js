// O térreo, no celular: captura em tela inteira, que é onde o app abre (D11).
// O formulário em si mora em js/app/formulario.js, compartilhado com o diálogo
// do PC — duas formas, um comportamento.

import { criarFormulario } from './app/formulario.js';
import { instalarServiceWorker } from './app/instalar.js';

const formulario = await criarFormulario({
  raiz: document.getElementById('formulario'),
  acoes: [{ id: 'lancar', rotulo: 'Lançar', principal: true, fecha: false }],
});

formulario.focar();

instalarServiceWorker();
