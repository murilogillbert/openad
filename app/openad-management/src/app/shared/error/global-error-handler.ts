import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandler, Injectable, inject, isDevMode } from '@angular/core';
import { MessageService } from 'primeng/api';
import { environment } from '../../../environments/environment';

/** Handles unexpected errors. HTTP failures use `httpErrorToastInterceptor` to avoid duplicate toasts. */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly messages = inject(MessageService);

  handleError(error: unknown): void {
    const logFirst =
      error instanceof Error ? error : new Error(String(error));
    if (isDevMode() || !environment.production) {
      // Sem `eslint-disable` aqui: a configuração deste projeto não proíbe `no-console`, e a
      // diretiva inútil é relatada como aviso (`reportUnusedDisableDirectives`). Diretiva que
      // não desliga nada ensina a próxima pessoa que `console` é proibido quando não é.
      console.error(logFirst);
    }

    if (error instanceof HttpErrorResponse) {
      return;
    }

    this.messages.add({
      severity: 'error',
      summary: 'Something went wrong',
      detail:
        logFirst.message ||
        'An unexpected error occurred. Try again or contact support.',
      life: 8_000,
    });
  }
}
