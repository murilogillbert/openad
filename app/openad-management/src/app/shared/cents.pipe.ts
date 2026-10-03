import { Pipe, PipeTransform } from '@angular/core';
import { fromCents } from '@openad/domain';

/**
 * Exibe centavos inteiros na unidade maior, com duas casas.
 *
 * Existe para que nenhum template faca `valor / 100` na mao. Parece exagero para uma divisao,
 * mas o defeito que motivou a conversao para centavos foi exatamente uma unidade implicita
 * errada num lugar so (o pacing comparava reais com centavos) — e um `/ 100` esquecido num
 * template e a mesma classe de erro, agora na tela do cliente.
 *
 * Usa o locale do navegador. A moeda vem separada, do campo `currency` da resposta, porque a
 * API e multimoeda e nao e papel do pipe adivinhar.
 */
@Pipe({ name: 'cents', standalone: true })
export class CentsPipe implements PipeTransform {
  transform(cents: number | null | undefined): string {
    if (cents == null || !Number.isFinite(cents)) {
      return '—';
    }
    return fromCents(cents).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
