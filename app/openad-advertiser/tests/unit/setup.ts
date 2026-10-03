/**
 * Ambiente dos testes unitarios.
 *
 * As URLs sao definidas aqui porque `src/config/env.ts` le `process.env.EXPO_PUBLIC_*` no
 * carregamento do modulo: sem isto, cada suite que importasse `endpoints.ts` cairia no padrao
 * `10.0.2.2` e um teste distraido tentaria rede de verdade.
 */
process.env.EXPO_PUBLIC_HUB_API_URL = 'https://hub.teste';
process.env.EXPO_PUBLIC_ADS_API_URL = 'https://ads.teste';
