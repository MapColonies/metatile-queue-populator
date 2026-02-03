import { HttpError } from '@map-colonies/error-express-handler';
import httpCode from 'http-status-codes';

export class RequestValidationError extends Error implements HttpError {
  public readonly status = httpCode.BAD_REQUEST;

  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, RequestValidationError.prototype);
  }
}

export class RequestAlreadyInQueueError extends Error implements HttpError {
  public readonly status = httpCode.CONFLICT;
  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, RequestAlreadyInQueueError.prototype);
  }
}
