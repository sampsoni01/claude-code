export class SimulationError extends Error {
  constructor(message: string, public code: string = 'SIM_ERROR') {
    super(message);
    this.name = 'SimulationError';
  }
}

export class ValidationError extends SimulationError {
  constructor(message: string) {
    super(message, 'VALIDATION');
    this.name = 'ValidationError';
  }
}

export class InsufficientFundsError extends SimulationError {
  constructor(public required: number, public available: number, message?: string) {
    super(message ?? `Insufficient cash: need ${required.toFixed(2)}, have ${available.toFixed(2)}`, 'INSUFFICIENT_FUNDS');
    this.name = 'InsufficientFundsError';
  }
}
