import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

let pool: Pool | null = null;

// Get a PostgreSQL connection pool
export function getPool(): Pool {
  if (!pool) {
    const databaseUrl = Deno.env.get("DATABASE_URL");
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    
    pool = new Pool(databaseUrl, 3, true);
  }
  
  return pool;
}

// Execute a query with parameters and return the result
export async function executeQuery<T>(
  query: string, 
  params: any[] = []
): Promise<T[]> {
  const client = await getPool().connect();
  
  try {
    const result = await client.queryObject<T>(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// Helper function to build WHERE conditions for search queries
export function buildSearchConditions(
  params: Record<string, any>,
  operators: Record<string, string> = {}
): { conditions: string[], values: any[] } {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      const operator = operators[key] || '=';
      conditions.push(`${key} ${operator} $${paramIndex++}`);
      values.push(value);
    }
  }
  
  return { conditions, values };
} 