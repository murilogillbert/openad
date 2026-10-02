import { NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const makeHost = (
    req: Record<string, unknown>,
    res: { status: jest.Mock; json: jest.Mock }
  ): ArgumentsHost =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    }) as unknown as ArgumentsHost;

  it('writes standardized JSON with correlationId from req.id', () => {
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as PinoLogger;

    const filter = new HttpExceptionFilter(logger);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const req = {
      method: 'GET',
      url: '/api/v1/x',
      id: 'corr-test-id',
      headers: {},
    };
    const res = { status, json };

    filter.catch(new NotFoundException('nope'), makeHost(req, res));

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'NOT_FOUND',
        message: 'nope',
        correlationId: 'corr-test-id',
      }),
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('logs non-HTTP exceptions without throwing', () => {
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as PinoLogger;

    const filter = new HttpExceptionFilter(logger);
    const host = {
      getType: () => 'ws',
    } as unknown as ArgumentsHost;

    filter.catch(new Error('socket boom'), host);

    expect(logger.error).toHaveBeenCalled();
  });
});
