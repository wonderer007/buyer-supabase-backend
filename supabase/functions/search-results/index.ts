// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { executeQuery, getPool } from "../_shared/postgres-helper.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import * as postgres from "https://deno.land/x/postgres@v0.17.0/mod.ts"

// Custom JSON stringifier to handle BigInt values
const bigIntSafeJSONStringify = (data: any): string => {
  return JSON.stringify(data, (_, value) => 
    typeof value === 'bigint' ? Number(value) : value
  );
};

interface SearchParams {
  query?: string;
  min_price?: number;
  max_price?: number;
  location?: string;
  category_id?: string;
  limit?: number;
  offset?: number;
  sort_by?: 'created_at' | 'price' | 'like_count';
  sort_direction?: 'asc' | 'desc';
  currency?: string;
}

interface Photo {
  id: string;
  url: string;
  name: string;
  post_id: string;
  created_at: string;
}

interface Video {
  id: string;
  url: string;
  name: string;
  thumbnail_url: string;
  post_id: string;
  created_at: string;
}

interface Profile {
  id: string;
  username: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

interface Post {
  id: string;
  title: string;
  price: number;
  currency: string;
  location: string;
  contact_type: string;
  contact_value: string;
  description: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  category_id: string;
  category_name: string;
  photos: Photo[];
  videos: Video[];
  like_count: number;
  is_liked_by_user: boolean;
  profile: Profile;
}

// Helper function to convert any BigInt values in an object to numbers
const processQueryResult = (obj: any): any => {
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
      
      // Special handling for the created_at field
      if ((key === 'created_at' || key === 'updated_at') && value && typeof value === 'object') {
        if (value instanceof Date) {
          converted[key] = value.toISOString();
        } else if (value.toString && typeof value.toString === 'function') {
          converted[key] = value.toString();
        } else {
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

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      ...corsHeaders
    };

    // Get request body
    const body = await req.json() as SearchParams;
    console.log("--------------------------------")
    console.log(body);
    console.log("--------------------------------")
    const { 
      query, 
      min_price, 
      max_price, 
      location, 
      category_id,
      currency,
      sort_by = 'created_at',
      sort_direction = 'desc',
      limit = 20, 
      offset = 0 
    } = body;

    // Connect to the database
    const client = await getPool().connect();

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

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      // Get total count for pagination
      const countQuery = `SELECT COUNT(*) as total FROM posts ${whereClause}`;
      const countResult = await client.queryObject<{ total: postgres.BigInt }>(countQuery, queryParams);
      const total = Number(countResult.rows[0].total);

      // Build the main query with like count
      const sortClause = `ORDER BY ${query && sort_by === 'created_at' ? 
        `ts_rank(title_search, to_tsquery('english', $1)) DESC, created_at DESC` : 
        `${sort_by} ${sort_direction}`}`;
      const paginationClause = `LIMIT $${paramCounter++} OFFSET $${paramCounter++}`;
      queryParams.push(limit, offset);

      // Get posts with like count and user profile
      const postQuery = `
        SELECT 
          p.*,
          COUNT(ulp.post_id) as like_count,
          pr.id as profile_id,
          pr.username as profile_username,
          pr.name as profile_name,
          pr.created_at as profile_created_at,
          pr.updated_at as profile_updated_at,
          c.name as category_name
        FROM 
          posts p
        LEFT JOIN 
          user_liked_posts ulp ON p.id = ulp.post_id
        LEFT JOIN
          profiles pr ON p.user_id = pr.id
        LEFT JOIN
          categories c ON p.category_id = c.id
        ${whereClause}
        GROUP BY 
          p.id, pr.id, c.id
        ${sortClause}
        ${paginationClause}
      `;

      // Execute the query to get posts
      const postResult = await client.queryObject(postQuery, queryParams);
      const posts = processQueryResult(postResult.rows);

      // If no posts found, return empty array
      if (posts.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              posts: [],
              total,
              limit,
              offset
            }
          }),
          { status: 200, headers }
        );
      }

      // Get the post IDs
      const postIds = posts.map(post => post.id);
      const placeholders = postIds.map((_, i) => `$${i + 1}`).join(',');

      // Get photos for these posts
      const photoQuery = `
        SELECT * FROM photos
        WHERE post_id IN (${placeholders})
        ORDER BY created_at ASC
      `;
      const photoResult = await client.queryObject(photoQuery, postIds);
      const photos = processQueryResult(photoResult.rows);

      // Get videos for these posts
      const videoQuery = `
        SELECT * FROM videos
        WHERE post_id IN (${placeholders})
        ORDER BY created_at ASC
      `;
      const videoResult = await client.queryObject(videoQuery, postIds);
      const videos = processQueryResult(videoResult.rows);

      // Check if user is authenticated
      let currentUserId: string | null = null;
      let userLikedPosts: Record<string, boolean> = {};
      
      const authHeader = req.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          // Create a Supabase client
          const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
          const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
          const supabase = createClient(supabaseUrl, supabaseAnonKey);
          
          const token = authHeader.replace('Bearer ', '');
          
          // Verify the token and get user information
          const { data: { user }, error: authError } = await supabase.auth.getUser(token);
          
          if (!authError && user) {
            currentUserId = user.id;
            
            // Get user's liked posts - using a different approach for placeholders
            const userLikedPlaceholders = postIds.map((_, i) => `$${i + 2}`).join(',');
            const userLikedQuery = `
              SELECT post_id FROM user_liked_posts
              WHERE user_id = $1 AND post_id IN (${userLikedPlaceholders})
            `;
            const userLikedResult = await client.queryObject(userLikedQuery, [currentUserId, ...postIds]);
            
            // Create a map of post_id to liked status
            userLikedResult.rows.forEach(row => {
              userLikedPosts[row.post_id] = true;
            });
          }
        } catch (error) {
          console.error('Error authenticating user:', error);
          // Continue without authentication
        }
      }

      // Organize photos and videos by post_id
      const photosByPostId: Record<string, Photo[]> = {};
      const videosByPostId: Record<string, Video[]> = {};

      photos.forEach(photo => {
        if (!photosByPostId[photo.post_id]) {
          photosByPostId[photo.post_id] = [];
        }
        photosByPostId[photo.post_id].push(photo);
      });

      videos.forEach(video => {
        if (!videosByPostId[video.post_id]) {
          videosByPostId[video.post_id] = [];
        }
        videosByPostId[video.post_id].push(video);
      });

      // Add photos, videos, and like information to each post
      const postsWithMedia = posts.map(post => ({
        ...post,
        photos: photosByPostId[post.id] || [],
        videos: videosByPostId[post.id] || [],
        like_count: post.like_count || 0,
        is_liked_by_user: currentUserId ? !!userLikedPosts[post.id] : false,
        profile: {
          id: post.profile_id,
          username: post.profile_username,
          name: post.profile_name,
          created_at: post.profile_created_at,
          updated_at: post.profile_updated_at
        },
        category_id: post.category_id || null,
        category_name: post.category_name || null,
        // Remove redundant fields that are now in profile
        profile_id: undefined,
        profile_username: undefined,
        profile_name: undefined,
        profile_created_at: undefined,
        profile_updated_at: undefined
      }));

      // Return the response with safe JSON stringification
      return new Response(
        bigIntSafeJSONStringify({
          success: true,
          data: {
            posts: postsWithMedia,
            total,
            limit,
            offset
          }
        }),
        { status: 200, headers }
      );
    } catch (error) {
      console.error("Database error:", error);
      return new Response(
        JSON.stringify({ success: false, error: `Database error: ${error.message}` }),
        { 
          headers,
          status: 500 
        }
      );
    } finally {
      // Release the client back to the pool
      client.release();
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(
      JSON.stringify({ success: false, error: "An unexpected error occurred" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500 
      }
    );
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/search-results' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"query":"furniture", "min_price": 50, "max_price": 500, "category_id": "123e4567-e89b-12d3-a456-426614174000"}'

*/
