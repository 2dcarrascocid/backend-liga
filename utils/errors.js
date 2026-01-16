import { formatResponse } from './response.js'

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export const handleError = (error) => {
  console.error('Error:', error)

  if (error instanceof AppError) {
    return formatResponse(error.statusCode, {
      error: {
        message: error.message,
        code: error.code,
      },
    })
  }

  if (error.code && error.message) {
    return formatResponse(error.status || 400, {
      error: {
        message: error.message,
        code: error.code,
      },
    })
  }

  return formatResponse(500, {
    error: {
      message: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    },
  })
}
