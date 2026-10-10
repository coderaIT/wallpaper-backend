import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

const errorExample = (statusCode: number, error: string, message: string) => ({
  schema: {
    example: {
      statusCode,
      error,
      message,
      path: '/api/v1/...',
      timestamp: '2026-01-01T00:00:00.000Z',
      requestId: '0f8b6c8e-6f3a-4c1f-9d2e-3c4b5a6d7e8f',
    },
  },
});

export const ApiValidationError = () =>
  ApiBadRequestResponse({
    description: 'Validation failed',
    schema: {
      example: {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: ['title must be shorter than or equal to 150 characters'],
        path: '/api/v1/...',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    },
  });

export const ApiNotFound = (what = 'Resource') =>
  ApiNotFoundResponse({ description: `${what} not found`, ...errorExample(404, 'Not Found', `${what} not found`) });

export const ApiConflict = (description = 'Conflict') =>
  ApiConflictResponse({ description, ...errorExample(409, 'Conflict', description) });

export const ApiTooManyRequests = () =>
  ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded',
    ...errorExample(429, 'Too Many Requests', 'ThrottlerException: Too Many Requests'),
  });

/** Bearer-token auth + the standard 401/403 responses for admin endpoints. */
export const ApiAdminAuth = () =>
  applyDecorators(
    ApiBearerAuth('admin-jwt'),
    ApiUnauthorizedResponse({
      description: 'Missing, invalid or expired access token',
      ...errorExample(401, 'Unauthorized', 'Authentication required'),
    }),
    ApiForbiddenResponse({
      description: 'Authenticated admin lacks the required role or is disabled',
      ...errorExample(403, 'Forbidden', 'Insufficient permissions'),
    }),
  );
