/** Thrown by services; the API layer maps it to the error envelope. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function notFound(what: string): DomainError {
  return new DomainError("NOT_FOUND", `${what} not found`, 404);
}
