/**
 * Unico lugar donde viven los selectores de Shalom.
 *
 * Si Shalom cambia la UI, se corrige aca y no se toca la logica del driver.
 * Todos fueron verificados contra el sitio real (ver poc/README.md).
 */
export const SHALOM_SELECTORS = {
  login: {    form: '#formLogin',
    email: 'input[name="email"]',
    password: 'input[name="password"]',
    remember: '#remember',
    submit: '#formLogin button[type="submit"]',
    recaptchaField: '#recaptcha_token',
    authenticatedFlag: 'IS_AUTHENTICATED',
  },
  popups: {
    loyaltyClose:
      '.loyalty-popup .popup-close, .loyalty-popup-overlay button.popup-close, .modal.show .close, .swal2-close',
    swal: '.swal2-container.swal2-shown',
    swalConfirm: '.swal2-container.swal2-shown .swal2-confirm',
    swalTitle: '.swal2-title',
    swalContent: '#swal2-content',
  },
  individual: {
    route: '/registroindividual',
    carouselViewport: '.flicking-viewport',
    cardPanel: '.card-panel',
    cardTitle: '.card-title',
    next: '.flicking-arrow-next',
    prev: '.flicking-arrow-prev',
    continueButton: 'button.btn.btn-redshalom',
    multiselect: '.multiselect',
    multiselectInput: 'input.multiselect__input',
    multiselectOption: '.multiselect__element',
    seriesInput: '#series-input',
    guideInput: '#guide-input',
    dniInput: 'input[placeholder="DNI"]',
    recipient: {
      docInput: 'input[placeholder="DNI"], input[placeholder="RUC"], input[placeholder="CE"]',
      nameInput: '#names-input',
      businessNameInput: '#business-names-input',
      paternalInput: 'input[placeholder="Apellido paterno"]',
      maternalInput: 'input[placeholder="Apellido materno"]',
      phoneInput: '#phone-input',
      spinner: '.spinner-border',
    },
    declarationRadio: '#declaracion_jurada_art',
    declarationLabel: 'label[for="declaracion_jurada_art"]',
    keypad: '.input-key',
    keypadDigit: 'button.btn-outline-default',
    tariff: 'text=/S\\/\\s*[\\d.,]+/',
    resultOrder: /V\d+\s*-\s*(\d{6,})/,
  },
  pending: {
    route: '/enviospendientes/list',
    row: '.shipment-row',
    orderNumber: '.order-number',
    codeValue: '.code-value',
  },
  tracking: {
    orderInput: 'input[placeholder*="Orden" i]',
    codeInput: 'input[placeholder*="Código de Orden" i]',
    submit: "form button[type='submit']",
    heading: '.text-4xl.font-bold.text-red-color-sidebar',
    message: 'p.font-normal.text-silver-title',
    date: 'p.text-placeholder-rastrea',
    stepName: 'p.text-md.font-bold.text-color-card-terrestre, div.text-md.font-bold.text-color-card-terrestre',
    progressBar: 'div.h-2.w-1\\/3',
    infoRoute: '/rastrea/information',
  },
} as const;

export const PACKAGE_TITLES: Record<string, string> = {
  SOBRE: 'Sobre',
  'PAQUETE XXS': 'Caja Paquete XXS',
  'PAQUETE XS': 'Caja Paquete XS',
  'PAQUETE S': 'Caja Paquete S',
  'PAQUETE M': 'Caja Paquete M',
  'PAQUETE L': 'Caja Paquete L',
};
