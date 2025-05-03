import { PaginatedResponse, ErrorResponse, PaginationParams } from './types.ts';
import { bigIntSafeJSONStringify, getResponseHeaders } from './util.ts';

// Create a success response for paginated data
export function createPaginatedResponse<T>(
  posts: T[],
  total: number,
  pagination: PaginationParams
): Response {
  const responseData: PaginatedResponse<T> = {
    success: true,
    data: {
      posts,
      total,
      limit: pagination.limit!,
      page: pagination.page!,
      offset: pagination.offset,
      total_pages: Math.ceil(total / pagination.limit!)
    }
  };

  return new Response(
    bigIntSafeJSONStringify(responseData),
    { 
      status: 200, 
      headers: getResponseHeaders() 
    }
  );
}

// Create an error response
export function createErrorResponse(
  message: string,
  status: number = 500
): Response {
  const responseData: ErrorResponse = {
    success: false,
    error: message
  };

  return new Response(
    JSON.stringify(responseData),
    { 
      status, 
      headers: getResponseHeaders() 
    }
  );
}

// Create a CORS preflight response
export function createOptionsResponse(): Response {
  return new Response(
    null,
    { 
      status: 204, 
      headers: getResponseHeaders() 
    }
  );
}

// Create a method not allowed response
export function createMethodNotAllowedResponse(): Response {
  return createErrorResponse('Method not allowed', 405);
}

// Create an unauthorized response
export function createUnauthorizedResponse(message: string = 'Authentication required'): Response {
  return createErrorResponse(message, 401);
}

// Create a bad request response
export function createBadRequestResponse(message: string): Response {
  return createErrorResponse(message, 400);
} 