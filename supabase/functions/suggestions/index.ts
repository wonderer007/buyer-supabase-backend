// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { Pool } from 'https://deno.land/x/postgres@v0.17.0/mod.ts';

// Database connection pool
const pool = new Pool(
  Deno.env.get('DATABASE_URL') || '',
  3,
  true
);

interface SuggestionResponse {
  success: boolean;
  data?: { id: string; title: string }[];
  error?: string;
}

Deno.serve(async (req) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Method not allowed' 
      }),
      { status: 405, headers }
    );
  }

  try {
    // Get search query from request body
    const { query } = await req.json();
    
    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Search query is required'
        }),
        { status: 400, headers }
      );
    }

    // Get a client from the pool
    const client = await pool.connect();
    
    try {
      // Process the search term for prefix matching
      const processedTerm = query
        .split(' ')
        .filter(Boolean)
        .map(term => `${term}:*`)
        .join(' & ');
      
      // Query posts table using the combined full-text search index
      const result = await client.queryObject<{ id: string; title: string }>(
        `SELECT id, title, ts_rank(search_document, to_tsquery('english', $1)) as rank
         FROM posts 
         WHERE search_document @@ to_tsquery('english', $1)
         ORDER BY rank DESC, created_at DESC 
         LIMIT 10`,
        [processedTerm]
      );
      
      // If no exact matches found via full-text search, fall back to ILIKE
      if (result.rows.length < 5) {
        const searchPattern = `%${query}%`;
        const fallbackResult = await client.queryObject<{ id: string; title: string }>(
          `SELECT id, title FROM posts 
           WHERE title ILIKE $1 AND id NOT IN (SELECT id FROM (
             SELECT id FROM posts WHERE search_document @@ to_tsquery('english', $2) LIMIT 10
           ) as existing_results)
           ORDER BY created_at DESC 
           LIMIT ${10 - result.rows.length}`,
          [searchPattern, processedTerm]
        );
        
        // Combine results
        result.rows = [...result.rows, ...fallbackResult.rows];
      }
      
      // Prepare response
      const response: SuggestionResponse = {
        success: true,
        suggestions: result.rows.map(row => ({
          id: row.id,
          title: row.title
        }))
      };
      
      return new Response(
        JSON.stringify(response),
        { headers }
      );
    } catch (dbError) {
      console.error('Database error:', dbError);
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Database error: ${dbError.message}` 
        }),
        { status: 500, headers }
      );
    } finally {
      // Release the client back to the pool
      client.release();
    }
  } catch (error) {
    console.error('Unexpected error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `Unexpected error: ${error.message}` 
      }),
      { status: 500, headers }
    );
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/suggestions' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"query":"bike"}'

*/
