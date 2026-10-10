// PLATFORM-OWNED: ошибка клиента по контракту (contract.md). Не меняйте.
export type DeliveryErrorCode = 'bad_request' | 'not_found' | 'unavailable' | 'invalid_response';

export class DeliveryError extends Error {
  constructor(
    readonly code: DeliveryErrorCode,
    message: string,
    readonly details: { status?: number; attempts?: number } = {},
  ) {
    super(message);
    this.name = 'DeliveryError';
  }

  get status(): number | undefined {
    return this.details.status;
  }

  get attempts(): number | undefined {
    return this.details.attempts;
  }
}
