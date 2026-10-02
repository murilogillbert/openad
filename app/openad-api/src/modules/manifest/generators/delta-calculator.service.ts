import { Injectable } from '@nestjs/common';
import { compare } from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';

/** Wraps RFC 6902 JSON Patch between two manifest payloads. */
@Injectable()
export class DeltaCalculatorService {
  computeDelta(
    previous: Record<string, unknown>,
    next: Record<string, unknown>
  ): Operation[] {
    return compare(previous, next);
  }
}
