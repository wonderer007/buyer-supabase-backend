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

interface Post {
  id: string;
  title: string;
  category: string;
  price: number;
  currency: string;
  condition: string;
  location: string;
  availability: string;
  contact_type: string;
  contact_value: string;
  description: string;
  user_id: string;
  created_at: string;
  photos: Photo[];
  videos: Video[];
}

interface QueryParams {
  category?: string;
  limit?: number;
  offset?: number;
  user_id?: string;
  min_price?: number;
  max_price?: number;
  condition?: string;
  location?: string;
  search_term?: string;
  sort_by?: 'created_at' | 'price';
  sort_direction?: 'asc' | 'desc';
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

    // Parse query parameters
    const url = new URL(req.url);
    const params: QueryParams = {
      category: url.searchParams.get('category') || undefined,
      limit: url.searchParams.has('limit') ? parseInt(url.searchParams.get('limit')!) : 10,
      offset: url.searchParams.has('offset') ? parseInt(url.searchParams.get('offset')!) : 0,
      user_id: url.searchParams.get('user_id') || undefined,
      min_price: url.searchParams.has('min_price') ? parseFloat(url.searchParams.get('min_price')!) : undefined,
      max_price: url.searchParams.has('max_price') ? parseFloat(url.searchParams.get('max_price')!) : undefined,
      condition: url.searchParams.get('condition') || undefined,
      location: url.searchParams.get('location') || undefined,
      search_term: url.searchParams.get('search_term') || undefined,
      sort_by: (url.searchParams.get('sort_by') as 'created_at' | 'price') || 'created_at',
      sort_direction: (url.searchParams.get('sort_direction') as 'asc' | 'desc') || 'desc',
    };

    // Validate limit and offset
    if (isNaN(params.limit!) || params.limit! <= 0 || params.limit! > 50) {
      params.limit = 10;
    }
    
    if (isNaN(params.offset!) || params.offset! < 0) {
      params.offset = 0;
    }

    // Get a client from the pool
    const client = await pool.connect();

    try {
      // Build the query conditions
      const conditions: string[] = [];
      const queryParams: any[] = [];
      let paramCounter = 1;

      if (params.category) {
        conditions.push(`category = $${paramCounter++}`);
        queryParams.push(params.category);
      }

      if (params.user_id) {
        conditions.push(`user_id = $${paramCounter++}`);
        queryParams.push(params.user_id);
      }

      if (params.min_price !== undefined) {
        conditions.push(`price >= $${paramCounter++}`);
        queryParams.push(params.min_price);
      }

      if (params.max_price !== undefined) {
        conditions.push(`price <= $${paramCounter++}`);
        queryParams.push(params.max_price);
      }

      if (params.condition) {
        conditions.push(`condition = $${paramCounter++}`);
        queryParams.push(params.condition);
      }

      if (params.location) {
        conditions.push(`location = $${paramCounter++}`);
        queryParams.push(params.location);
      }

      if (params.search_term) {
        conditions.push(`(title ILIKE $${paramCounter} OR description ILIKE $${paramCounter})`);
        queryParams.push(`%${params.search_term}%`);
        paramCounter++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      // Get total count for pagination
      const countQuery = `SELECT COUNT(*) as total FROM posts ${whereClause}`;
      const countResult = await client.queryObject<{ total: postgres.BigInt }>(countQuery, queryParams);
      const total = Number(countResult.rows[0].total);

      // Build the main query
      const sortClause = `ORDER BY ${params.sort_by} ${params.sort_direction}`;
      const paginationClause = `LIMIT $${paramCounter++} OFFSET $${paramCounter++}`;
      queryParams.push(params.limit, params.offset);

      const postQuery = `
        SELECT * FROM posts
        ${whereClause}
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
              limit: params.limit,
              offset: params.offset
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

      // Add photos and videos to each post
      const postsWithMedia = posts.map(post => ({
        ...post,
        photos: photosByPostId[post.id] || [],
        videos: videosByPostId[post.id] || []
      }));

      // Return the response with safe JSON stringification
      return new Response(
        bigIntSafeJSONStringify({
          success: true,
          data: {
            posts: postsWithMedia,
            total,
            limit: params.limit,
            offset: params.offset
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
