import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  httpExceptionClassToCode,
  normalizeHttpException,
} from './normalize-http-exception';

describe('normalizeHttpException', () => {
  it('uses domain code when body has code + message strings', () => {
    const e = new NotFoundException({
      code: 'CAMPAIGN_NOT_FOUND',
      message: 'c1',
    });
    const n = normalizeHttpException(e);
    expect(n.code).toBe('CAMPAIGN_NOT_FOUND');
    expect(n.message).toBe('c1');
    expect(n.details).toBeUndefined();
  });

  it('derives code from class for string body', () => {
    const e = new BadRequestException('bad');
    const n = normalizeHttpException(e);
    expect(n.code).toBe('BAD_REQUEST');
    expect(n.message).toBe('bad');
  });

  it('maps validation array message', () => {
    const e = new BadRequestException({
      message: ['a', 'b'],
      error: 'Bad Request',
      statusCode: 400,
    });
    const n = normalizeHttpException(e);
    expect(n.message).toBe('a, b');
    expect(n.code).toBe('BAD_REQUEST');
  });

  it('unwraps nested error { code, message } (domain BadRequest body)', () => {
    const e = new BadRequestException({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Resolution 1080x1350 exceeds maximum 1920x1080',
      },
    });
    const n = normalizeHttpException(e);
    expect(n.code).toBe('VALIDATION_FAILED');
    expect(n.message).toBe(
      'Resolution 1080x1350 exceeds maximum 1920x1080'
    );
  });
});

describe('httpExceptionClassToCode', () => {
  it('handles multi-word Nest exception names', () => {
    expect(httpExceptionClassToCode(new BadRequestException())).toBe(
      'BAD_REQUEST'
    );
    expect(httpExceptionClassToCode(new NotFoundException())).toBe('NOT_FOUND');
  });
});
