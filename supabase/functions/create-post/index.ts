import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { Pool } from 'https://deno.land/x/postgres@v0.17.0/mod.ts';
import * as postgres from 'https://deno.land/x/postgres@v0.17.0/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Photo {
  url: string;
  name: string;
}

interface Video {
  url: string;
  name: string;
  thumbnail_url: string;
}

interface Post {
  title: string;
  category_id: string;
  price: number;
  currency: string;
  location: string;
  contact_type: string;
  contact_value: string;
  description: string;
  photos?: Photo[];
  videos?: Video[];
  user_id?: string;
}

interface RequestData {
  post: Post;
}

const pool = new Pool(
  Deno.env.get('DATABASE_URL') || '',
  3,
  true
);

serve(async (req: Request) => {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

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

    // Create a Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Get the user's JWT token from the authorization header
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
    
    const token = authHeader.replace('Bearer ', '');
    
    // Verify the token and get user information
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid or expired authentication token' 
        }),
        { status: 401, headers }
      );
    }

    // Parse request body
    let requestData: RequestData;
    try {
      requestData = await req.json();
    } catch (error) {
      console.error('Error parsing request body:', error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid JSON in request body' 
        }),
        { status: 400, headers }
      );
    }

    // Validate input
    const { post } = requestData;
    if (!post) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing post data' 
        }),
        { status: 400, headers }
      );
    }

    // Add user_id to the post
    post.user_id = user.id;

    // Validate required post fields
    const requiredFields = [
      'title', 'category_id', 'price', 'currency',
      'location', 'contact_type', 'contact_value',
      'description'
    ];
    
    for (const field of requiredFields) {
      if (!post[field]) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Missing required field: ${field}` 
          }),
          { status: 400, headers }
        );
      }
    }

    // Validate price is positive
    if (typeof post.price !== 'number' || post.price <= 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Price must be a positive number' 
        }),
        { status: 400, headers }
      );
    }

    // Get a client from the pool
    const client = await pool.connect();
    let newPostId: string | null = null;

    try {
      // Start transaction
      await client.queryObject('BEGIN');

      // Insert post and get its ID
      const postResult = await client.queryObject<{ id: string }>(
        `INSERT INTO posts (
          title, category_id, price, currency, location,
          contact_type, contact_value, description, user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          post.title,
          post.category_id,
          post.price,
          post.currency,
          post.location,
          post.contact_type,
          post.contact_value,
          post.description,
          post.user_id
        ]
      );

      newPostId = postResult.rows[0].id;

      // Insert photos if any
      if (post.photos && post.photos.length > 0) {
        for (const photo of post.photos) {
          await client.queryObject(
            `INSERT INTO photos (url, name, post_id)
            VALUES ($1, $2, $3)`,
            [photo.url, photo.name, newPostId]
          );
        }
      }

      // Insert videos if any
      if (post.videos && post.videos.length > 0) {
        for (const video of post.videos) {
          await client.queryObject(
            `INSERT INTO videos (url, name, thumbnail_url, post_id)
            VALUES ($1, $2, $3, $4)`,
            [video.url, video.name, video.thumbnail_url, newPostId]
          );
        }
      }

      // Commit transaction
      await client.queryObject('COMMIT');

      // Return success response
      return new Response(
        JSON.stringify({ 
          success: true, 
          data: { post_id: newPostId } 
        }),
        { status: 200, headers }
      );

    } catch (error) {
      // Rollback transaction on error
      await client.queryObject('ROLLBACK');
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