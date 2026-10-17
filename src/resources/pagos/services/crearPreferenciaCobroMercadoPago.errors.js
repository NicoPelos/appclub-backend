export class BusinessError extends Error {
  constructor(message, status = 400, data = null) {
    super(message);
    this.name = 'BusinessError';
    this.status = status;
    this.data = data;
  }
}
