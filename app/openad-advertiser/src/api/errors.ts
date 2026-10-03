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

  constructor(message: string, status: number, kind: ApiErrorKind = 'http', code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.code = code;
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

export function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

export function errorMessage(err: unknown, fallback = 'Algo deu errado. Tente novamente.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
