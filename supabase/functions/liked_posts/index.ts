// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Hello from Liked Posts Function!")

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { Pool } from 'https://deno.land/x/postgres@v0.17.0/mod.ts';
import * as postgres from 'https://deno.land/x/postgres@v0.17.0/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Custom JSON stringifier to handle BigInt values
const bigIntSafeJSONStringify = (data: any): string => {
  return JSON.stringify(data, (_, value) => 
    typeof value === 'bigint' ? Number(value) : value
  );
};

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
  condition: number;
  contact_type: string;
  contact_value: string;
  description: string;
  user_id: string;
  created_at: string;
  photos: Photo[];
  videos: Video[];
  like_count: number;
  is_liked_by_user: boolean;
  profile: Profile;
  category_id: string;
  category_name: string;
}

interface QueryParams {
  limit?: number;
  page?: number;
}

const pool = new Pool(
  Deno.env.get('DATABASE_URL') || '',
  3,
  true
);

// Helper function to convert any BigInt values in an object to numbers
// and properly format Date objects to ISO strings
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
      if (key === 'created_at' && value && typeof value === 'object') {
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

serve(async (req: Request) => {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (req.method !== 'GET') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Method not allowed' 
        }),
        { status: 405, headers }
      );
    }

    // Verify user authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Authentication required' 
        }),
        { status: 401, headers }
      );
    }

    // Create a Supabase client and authenticate the user
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    const token = authHeader.replace('Bearer ', '');
    
    // Verify the token and get user information
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid authentication token' 
        }),
        { status: 401, headers }
      );
    }

    const currentUserId = user.id;

    // Parse query parameters
    const url = new URL(req.url);
    const params: QueryParams = {
      limit: url.searchParams.has('limit') ? parseInt(url.searchParams.get('limit')!) : 10,
      page: url.searchParams.has('page') ? parseInt(url.searchParams.get('page')!) : 1
    };

    // Validate limit and page
    if (isNaN(params.limit!) || params.limit! <= 0 || params.limit! > 50) {
      params.limit = 10;
    }
    
    if (isNaN(params.page!) || params.page! < 1) {
      params.page = 1;
    }
    
    // Calculate offset from page number
    const offset = (params.page! - 1) * params.limit!;

    // Get a client from the pool
    const client = await pool.connect();

    try {
      // Get total count of user's liked posts for pagination
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM user_liked_posts 
        WHERE user_id = $1
      `;
      const countResult = await client.queryObject<{ total: postgres.BigInt }>(countQuery, [currentUserId]);
      const total = Number(countResult.rows[0].total);

      // Build the main query to get all liked posts
      const sortClause = `ORDER BY p.created_at DESC`;
      
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
        JOIN
          user_liked_posts ul ON p.id = ul.post_id AND ul.user_id = $1
        LEFT JOIN 
          user_liked_posts ulp ON p.id = ulp.post_id
        LEFT JOIN
          profiles pr ON p.user_id = pr.id
        LEFT JOIN
          categories c ON p.category_id = c.id
        GROUP BY 
          p.id, pr.id, c.id
        ${sortClause}
        LIMIT $2 OFFSET $3
      `;

      // Execute the query to get posts
      const postResult = await client.queryObject(postQuery, [currentUserId, params.limit, offset]);
      const posts = processQueryResult(postResult.rows);

      // If no posts found, return empty array
      if (posts.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              posts: [],
              total,
              limit: params.limit,
              page: params.page,
              total_pages: Math.ceil(total / params.limit!)
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
        is_liked_by_user: true, // These are all liked posts by the current user
        profile: {
          id: post.profile_id,
          username: post.profile_username,
          name: post.profile_name,
          created_at: post.profile_created_at,
          updated_at: post.profile_updated_at
        },
        category_id: post.category_id || null,
        category_name: post.category_name || null
      }));

      // Return the response with safe JSON stringification
      return new Response(
        bigIntSafeJSONStringify({
          success: true,
          data: {
            posts: postsWithMedia,
            total,
            limit: params.limit,
            page: params.page,
            total_pages: Math.ceil(total / params.limit!)
          }
        }),
        { status: 200, headers }
      );

    } catch (error) {
      console.error('Database error:', error);
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Database error: ${error.message}` 
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
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/liked_posts' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' 

*/
