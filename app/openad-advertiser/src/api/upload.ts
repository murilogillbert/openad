import { ApiError } from './errors';
import { normalizarErro, type RefreshOutcome, type TokenStorage } from './http';

/**
 * Envio de arquivo local por `XMLHttpRequest`, e **não** por `fetch`.
 *
 * O motivo é concreto e foi medido no aparelho. O Expo substitui o `fetch` global pelo dele
 * (`expo/src/winter/runtime.native.ts`, `install('fetch', ...)`), e o conversor de multipart
 * desse `fetch` aceita apenas três formas de parte:
 *
 *   string  |  Blob  |  objeto com `bytes()`
 *
 * A forma `{ uri, name, type }` — a proprietária do React Native, que o `ImagePicker`
 * devolve — cai no `else` e lança `Unsupported FormDataPart implementation`
 * (`expo/src/winter/fetch/convertFormData.ts:77`). O próprio arquivo documenta:
 * "`uri` is not supported for React Native's FormData". Com isso, **todo** envio de criativo
 * falhava, de uma foto de 0,1 MB a um vídeo de 93,5 MB, e a camada HTTP traduzia o estouro
 * para "Sem conexão com o servidor" — daí a falha parecer problema de internet.
 *
 * Converter o arquivo para `Blob` resolveria a forma, mas não serve: aquele conversor monta o
 * corpo inteiro em memória e o `joinUint8Arrays` aloca **outra** cópia completa. Um vídeo de
 * 93,5 MB viraria um pico de ~190 MB de heap e derrubaria o app em aparelho modesto.
 *
 * O `XMLHttpRequest` do React Native continua sendo o do React Native: o Expo só trocou o
 * `fetch`. Ele entende `{ uri, name, type }` via `FormData.getParts()` e o lado nativo faz o
 * streaming direto do disco, sem carregar o arquivo no JS. De brinde, dá progresso de envio,
 * que num vídeo de 93 MB é a diferença entre uma barra parada e saber que está subindo.
 */

export interface ArquivoLocal {
  /** `file://` ou `content://` devolvido pelo seletor. */
  uri: string;
  name: string;
  type: string;
}

export interface OpcoesDoEnviador {
  baseUrl: string;
  storage: TokenStorage;
  /** Quem renova o token. No app do anunciante, é o cliente do hub. */
  refreshDelegate: () => Promise<RefreshOutcome>;
  onSessionExpired?: () => void;
  timeoutMs: number;
  /** Injetável para teste; em produção é o `XMLHttpRequest` do React Native. */
  xhrImpl?: () => XMLHttpRequest;
  /**
   * Injetável por um motivo que é o próprio bug desta história: implementações de `FormData`
   * divergem no que fazem com uma parte que não é `Blob`.
   *
   * A do React Native guarda o objeto `{ uri, name, type }` como veio, e é o que permite o
   * streaming nativo. A padrão (navegador, Node, ambiente de teste) aplica `String(value)` e
   * transforma a parte em `"[object Object]"` — o arquivo desaparece sem erro nenhum.
   * Deixar a origem explícita aqui torna a diferença testável em vez de implícita.
   */
  formDataImpl?: () => FormData;
}

interface RespostaCrua {
  status: number;
  texto: string;
}

/** Erro de transporte do XHR, com o motivo que o evento carrega. */
class FalhaDeTransporte extends Error {
  readonly motivo: 'network' | 'timeout' | 'aborted';
  constructor(motivo: 'network' | 'timeout' | 'aborted', mensagem: string) {
    super(mensagem);
    this.name = 'FalhaDeTransporte';
    this.motivo = motivo;
  }
}

export function createUploader(opcoes: OpcoesDoEnviador) {
  const baseUrl = opcoes.baseUrl.replace(/\/+$/, '');
  const novoXhr = opcoes.xhrImpl ?? (() => new XMLHttpRequest());
  const novoFormData = opcoes.formDataImpl ?? (() => new FormData());

  function enviarUmaVez(
    caminho: string,
    campo: string,
    arquivo: ArquivoLocal,
    token: string | null,
    aoProgresso?: (fracao: number) => void
  ): Promise<RespostaCrua> {
    return new Promise<RespostaCrua>((resolve, reject) => {
      const xhr = novoXhr();
      xhr.open('POST', `${baseUrl}${caminho}`);
      xhr.timeout = opcoes.timeoutMs;
      xhr.setRequestHeader('Accept', 'application/json');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      // `Content-Type` fica de fora de propósito: quem escreve
      // `multipart/form-data; boundary=...` é o lado nativo, e definir aqui quebraria o
      // boundary.

      if (aoProgresso && xhr.upload) {
        xhr.upload.onprogress = (evento: ProgressEvent) => {
          if (evento.lengthComputable && evento.total > 0) {
            aoProgresso(evento.loaded / evento.total);
          }
        };
      }

      xhr.onload = () => {
        const corpo =
          typeof xhr.responseText === 'string'
            ? xhr.responseText
            : typeof xhr.response === 'string'
              ? xhr.response
              : '';
        resolve({ status: xhr.status, texto: corpo });
      };
      xhr.onerror = () =>
        reject(new FalhaDeTransporte('network', 'XMLHttpRequest falhou antes da resposta'));
      xhr.ontimeout = () =>
        reject(new FalhaDeTransporte('timeout', `envio passou de ${opcoes.timeoutMs} ms`));
      xhr.onabort = () => reject(new FalhaDeTransporte('aborted', 'envio cancelado'));

      const form = novoFormData();
      // Esta é a forma que o React Native entende e transmite por streaming.
      form.append(campo, arquivo as unknown as Blob);
      xhr.send(form);
    });
  }

  function interpretar<T>(resposta: RespostaCrua): T {
    if (resposta.status === 204 || !resposta.texto) return undefined as T;
    let json: unknown = null;
    try {
      json = JSON.parse(resposta.texto);
    } catch {
      json = null;
    }
    if (resposta.status < 200 || resposta.status >= 300) {
      const { message, code } = normalizarErro(json, resposta.status);
      throw new ApiError(message, resposta.status, 'http', code);
    }
    if (json === null) return undefined as T;
    const chaves = typeof json === 'object' && json !== null ? Object.keys(json) : [];
    if (chaves.length === 1 && chaves[0] === 'data') return (json as { data: T }).data;
    return json as T;
  }

  return {
    /**
     * Sobe um arquivo local em `multipart/form-data`. Em 401 renova a sessão uma vez e
     * repete — o mesmo contrato do núcleo HTTP, para um upload não derrubar a sessão por
     * token expirado no meio de um vídeo grande.
     */
    async enviarArquivo<T>(
      caminho: string,
      campo: string,
      arquivo: ArquivoLocal,
      aoProgresso?: (fracao: number) => void
    ): Promise<T> {
      const tentar = async (permitirRenovacao: boolean): Promise<T> => {
        const token = await opcoes.storage.getAccessToken();
        let resposta: RespostaCrua;
        try {
          resposta = await enviarUmaVez(caminho, campo, arquivo, token, aoProgresso);
        } catch (falha) {
          const motivo = falha instanceof FalhaDeTransporte ? falha.motivo : 'network';
          if (motivo === 'timeout') {
            throw new ApiError(
              'O envio demorou demais. Tente de novo, de preferência no Wi-Fi.',
              0,
              'timeout',
              undefined,
              falha
            );
          }
          if (motivo === 'aborted') {
            throw new ApiError('Envio cancelado.', 0, 'aborted', undefined, falha);
          }
          console.error('Falha de rede no envio de arquivo', {
            url: `${baseUrl}${caminho}`,
            arquivo: `${arquivo.name} (${arquivo.type})`,
            causa: falha instanceof Error ? `${falha.name}: ${falha.message}` : String(falha),
          });
          throw new ApiError(
            'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
            0,
            'network',
            undefined,
            falha
          );
        }

        if (resposta.status === 401 && permitirRenovacao) {
          const resultado = await opcoes.refreshDelegate();
          if (resultado === 'refreshed') return tentar(false);
          await opcoes.storage.clear();
          opcoes.onSessionExpired?.();
          throw new ApiError('Sua sessão expirou. Entre novamente.', 401, 'http');
        }

        return interpretar<T>(resposta);
      };

      return tentar(true);
    },
  };
}

export type Uploader = ReturnType<typeof createUploader>;
