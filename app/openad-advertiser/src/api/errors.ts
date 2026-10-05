export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'invalid_response';

/** Erro unico exposto pela camada de API. `status` 0 = sem resposta HTTP. */
export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  /**
   * Codigo estavel devolvido pela API. Escolhe a acao de recuperacao na tela em vez de
   * comparar texto de mensagem — mensagem muda, codigo nao.
   *
   * O hub devolve `{ error, code }` e o openad devolve `{ error: { code, message } }`. Os dois
   * formatos sao normalizados aqui, em `parse`.
   */
  readonly code?: string;

  /**
   * Causa técnica de origem, quando houver. Curta, de uma linha, para suporte.
   *
   * Existe porque `send()` traduzia **qualquer** falha antes da resposta para a mesma frase e
   * descartava o erro original (`catch {}` sem binding). Com isso "Sem conexão com o
   * servidor" cobria DNS, TLS, conexão cortada no meio e corpo que o runtime não conseguiu
   * montar a partir do arquivo — e um envio de criativo que falhava sempre ficava
   * indistinguível de Wi-Fi ruim, sem nada no aparelho para separar os casos.
   */
  readonly detail?: string;

  constructor(
    message: string,
    status: number,
    kind: ApiErrorKind = 'http',
    code?: string,
    cause?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
      this.detail = descreverCausa(cause);
    }
  }

  get isUnauthorized(): boolean {
    return this.kind === 'http' && this.status === 401;
  }

  /** Falha transitoria — vale tentar de novo (sem conexao, timeout, 5xx, 429). */
  get isTransient(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      (this.kind === 'http' && (this.status >= 500 || this.status === 429))
    );
  }
}

/**
 * Reduz a causa a uma linha legível.
 *
 * `TypeError: Network request failed` (o texto do React Native quando a requisição morre
 * antes da resposta) e `[Error: ...]` de módulo nativo chegam aqui de formas diferentes;
 * interessa o nome e a mensagem, e o `cause` aninhado quando existir — é nele que o
 * runtime costuma dizer o motivo real.
 */
function descreverCausa(cause: unknown): string | undefined {
  if (cause == null) return undefined;
  if (typeof cause === 'string') return cause.slice(0, 300) || undefined;
  if (cause instanceof Error) {
    const base = `${cause.name}: ${cause.message}`.trim();
    const aninhada = (cause as { cause?: unknown }).cause;
    const extra =
      aninhada instanceof Error
        ? ` (causa: ${aninhada.name}: ${aninhada.message})`
        : typeof aninhada === 'string'
          ? ` (causa: ${aninhada})`
          : '';
    return `${base}${extra}`.slice(0, 300);
  }
  try {
    return JSON.stringify(cause).slice(0, 300);
  } catch {
    return String(cause).slice(0, 300);
  }
}

/** Causa técnica, para a tela mostrar como informação de suporte. */
export function errorDetail(err: unknown): string | undefined {
  return err instanceof ApiError ? err.detail : undefined;
}

export function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

export function errorMessage(err: unknown, fallback = 'Algo deu errado. Tente novamente.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
