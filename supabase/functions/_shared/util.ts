import * as postgres from 'https://deno.land/x/postgres@v0.17.0/mod.ts';
import { PaginationParams } from './types.ts';

// Custom JSON stringifier to handle BigInt values
export const bigIntSafeJSONStringify = (data: any): string => {
  return JSON.stringify(data, (_, value) => 
    typeof value === 'bigint' ? Number(value) : value
  );
};

// Helper function to convert any BigInt values in an object to numbers
// and properly format Date objects to ISO strings
export const processQueryResult = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    return Number(obj);
  }
  
  // Handle PostgreSQL date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  
  // If created_at is an object with a toString method (PostgreSQL timestamp)
  if (obj && typeof obj === 'object' && obj.toString && !Array.isArray(obj) && 
      Object.prototype.hasOwnProperty.call(obj, 'toString')) {
    return obj.toString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(processQueryResult);
  }
  
  if (typeof obj === 'object') {
    const converted: Record<string, any> = {};
    for (const key in obj) {
      const value = obj[key];
      
      // Special handling for timestamp fields
      if ((key === 'created_at' || key === 'updated_at') && value && typeof value === 'object') {
        if (value instanceof Date) {
          converted[key] = value.toISOString();
        } else if (value.toString && typeof value.toString === 'function') {
          converted[key] = value.toString();
        } else {
          // Fallback to ISO string for current date if we can't convert
          converted[key] = new Date().toISOString();
        }
      } else {
        converted[key] = processQueryResult(value);
      }
    }
    return converted;
  }
  
  return obj;
};

// Parse and validate pagination parameters
export const parsePaginationParams = (url: URL): PaginationParams => {
  const params: PaginationParams = {
    limit: url.searchParams.has('limit') ? parseInt(url.searchParams.get('limit')!) : 10,
    page: url.searchParams.has('page') ? parseInt(url.searchParams.get('page')!) : 1
  };

  // Validate limit (between 1 and 50)
  if (isNaN(params.limit!) || params.limit! <= 0 || params.limit! > 50) {
    params.limit = 10;
  }
  
  // Validate page (must be at least 1)
  if (isNaN(params.page!) || params.page! < 1) {
    params.page = 1;
  }
  
  // Calculate offset from page number
  params.offset = (params.page! - 1) * params.limit!;
  
  return params;
};

// Generate standard response headers
export const getResponseHeaders = () => ({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

// Create placeholder parameters for SQL queries
export const createPlaceholders = (items: any[], startIndex = 1): string => {
  return items.map((_, i) => `$${i + startIndex}`).join(',');
}; 