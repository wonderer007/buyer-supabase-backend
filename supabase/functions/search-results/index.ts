// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { SearchParams, PaginationParams } from '../_shared/types.ts';
import { parsePaginationParams } from '../_shared/util.ts';
import { 
  getPostsCount, 
  getPosts, 
  getPostPhotos, 
  getPostVideos, 
  authenticateUser, 
  getUserLikedPosts, 
  formatPostsWithMedia 
} from '../_shared/post-service.ts';
import { 
  createPaginatedResponse, 
  createErrorResponse, 
  createOptionsResponse, 
  createMethodNotAllowedResponse,
  createBadRequestResponse
} from '../_shared/response-helper.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return createOptionsResponse();
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return createMethodNotAllowedResponse();
  }

  try {
    // Parse query parameters from URL
    const url = new URL(req.url);
    const query = url.searchParams.get('query') || undefined;
    const min_price = url.searchParams.has('min_price') ? Number(url.searchParams.get('min_price')) : undefined;
    const max_price = url.searchParams.has('max_price') ? Number(url.searchParams.get('max_price')) : undefined;
    const location = url.searchParams.get('location') || undefined;
    const category_id = url.searchParams.get('category_id') || undefined;
    const currency = url.searchParams.get('currency') || undefined;
    const condition = url.searchParams.get('condition') || undefined;
    const sort_by = (url.searchParams.get('sort_by') || 'created_at') as 'created_at' | 'price' | 'like_count';
    const sort_direction = (url.searchParams.get('sort_direction') || 'desc') as 'asc' | 'desc';
    
    // Parse pagination parameters
    const pagination = parsePaginationParams(url);
    
    // Validate numeric parameters
    if (min_price !== undefined && isNaN(min_price)) {
      return createBadRequestResponse("min_price must be a number");
    }
    
    if (max_price !== undefined && isNaN(max_price)) {
      return createBadRequestResponse("max_price must be a number");
    }

    try {
      // Build the query conditions
      const conditions: string[] = [];
      const queryParams: any[] = [];
      let paramCounter = 1;

      // Text search condition (if provided)
      if (query) {
        // Process the search term to handle partial words
        // Split into words, ensure each ends with :* for prefix matching
        const processedTerms = query
          .split(' ')
          .filter(Boolean)
          .map(term => `${term}:*`)
          .join(' & ');
        
        conditions.push(`(
          title_search @@ to_tsquery('english', $${paramCounter++}) OR
          to_tsvector('english', description) @@ to_tsquery('english', $${paramCounter++})
        )`);
        queryParams.push(processedTerms, processedTerms);
      }

      // Price range conditions
      if (min_price !== undefined) {
        conditions.push(`price >= $${paramCounter++}`);
        queryParams.push(min_price);
      }

      if (max_price !== undefined) {
        conditions.push(`price <= $${paramCounter++}`);
        queryParams.push(max_price);
      }

      // Location filter
      if (location) {
        conditions.push(`location = $${paramCounter++}`);
        queryParams.push(location);
      }

      // Category filter
      if (category_id) {
        conditions.push(`category_id = $${paramCounter++}`);
        queryParams.push(category_id);
      }

      // Currency filter
      if (currency) {
        conditions.push(`currency = $${paramCounter++}`);
        queryParams.push(currency);
      }

      if (condition) {
        conditions.push(`condition = $${paramCounter++}`);
        queryParams.push(condition);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      // Get total count for pagination
      const total = await getPostsCount(whereClause, queryParams);

      // Build the sort clause based on parameters
      const sortClause = `ORDER BY ${query && sort_by === 'created_at' ? 
        `ts_rank(title_search, to_tsquery('english', $1)) DESC, created_at DESC` : 
        `${sort_by} ${sort_direction}`}`;

      // Get posts with search conditions, like count and user profile
      const posts = await getPosts(whereClause, queryParams, pagination, sortClause);

      // If no posts found, return empty array
      if (posts.length === 0) {
        return createPaginatedResponse([], total, pagination);
      }

      // Get the post IDs
      const postIds = posts.map(post => post.id);

      // Get photos and videos for these posts
      const photos = await getPostPhotos(postIds);
      const videos = await getPostVideos(postIds);

      // Check if user is authenticated
      const userId = await authenticateUser(req.headers.get('Authorization'));
      const userLikedPosts = userId ? await getUserLikedPosts(userId, postIds) : {};

      // Format posts with media and like information
      const postsWithMedia = formatPostsWithMedia(posts, photos, videos, userId, userLikedPosts);

      // Return the success response
      return createPaginatedResponse(postsWithMedia, total, pagination);
      
    } catch (error) {
      console.error("Database error:", error);
      return createErrorResponse(`Database error: ${error.message}`);
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return createErrorResponse("An unexpected error occurred");
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/search-results?query=furniture&min_price=50&max_price=500&category_id=123e4567-e89b-12d3-a456-426614174000' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

*/
