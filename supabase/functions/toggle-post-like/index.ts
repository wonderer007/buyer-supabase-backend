// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface RequestData {
  post_id: string;
}

interface PostLikeResponse {
  like_count: number;
  is_liked_by_user: boolean;
}

serve(async (req: Request) => {
  try {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (req.method !== 'POST') {
      return Response.json({ 
        success: false, 
        error: 'Method not allowed' 
      }, { status: 405, headers });
    }

    // Create a Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Get the user's JWT token from the authorization header
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return Response.json({ 
        success: false, 
        error: 'Authentication required' 
      }, { status: 401, headers });
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    // Verify the token and get user information
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return Response.json({ 
        success: false, 
        error: 'Invalid or expired authentication token' 
      }, { status: 401, headers });
    }

    // Parse request body
    let requestData: RequestData;
    try {
      requestData = await req.json();
    } catch (error) {
      console.error('Error parsing request body:', error);
      return Response.json({ 
        success: false, 
        error: 'Invalid JSON in request body' 
      }, { status: 400, headers });
    }

    // Validate input
    const { post_id } = requestData;
    if (!post_id) {
      return Response.json({ 
        success: false, 
        error: 'Missing post_id in request body' 
      }, { status: 400, headers });
    }

    try {
      // Check if the post exists
      const { data: post, error: postError } = await supabase
        .from('posts')
        .select('id')
        .eq('id', post_id)
        .single();

      if (postError || !post) {
        return Response.json({ 
          success: false, 
          error: 'Post not found' 
        }, { status: 404, headers });
      }

      // Check if the user has already liked this post
      const { data: existingLike, error: likeCheckError } = await supabase
        .from('user_liked_posts')
        .select('*')
        .eq('user_id', user.id)
        .eq('post_id', post_id)
        .single();

      if (likeCheckError && likeCheckError.code !== 'PGRST116') { // PGRST116 is "no rows returned" error
        console.error('Error checking existing like:', likeCheckError);
        return Response.json({ 
          success: false, 
          error: 'Error checking existing like' 
        }, { status: 500, headers });
      }

      // Toggle the like status
      if (existingLike) {
        // User has already liked the post, so remove the like
        const { error: deleteError } = await supabase
          .from('user_liked_posts')
          .delete()
          .eq('user_id', user.id)
          .eq('post_id', post_id);

        if (deleteError) {
          console.error('Error removing like:', deleteError);
          return Response.json({ 
            success: false, 
            error: 'Error removing like' 
          }, { status: 500, headers });
        }
      } else {
        // User hasn't liked the post, so add the like
        const { error: insertError } = await supabase
          .from('user_liked_posts')
          .insert({ user_id: user.id, post_id: post_id });

        if (insertError) {
          console.error('Error inserting like:', insertError);
          return Response.json({ 
            success: false, 
            error: 'Error liking post' 
          }, { status: 500, headers });
        }
      }

      // Get updated like count and user's like status
      const { count, error: countError } = await supabase
        .from('user_liked_posts')
        .select('*', { count: 'exact', head: true })
        .eq('post_id', post_id);

      if (countError) {
        console.error('Error getting like count:', countError);
        return Response.json({ 
          success: false, 
          error: 'Error getting like count' 
        }, { status: 500, headers });
      }

      // Check if user has liked the post after the toggle
      const { data: userLikeStatus, error: userLikeError } = await supabase
        .from('user_liked_posts')
        .select('*')
        .eq('user_id', user.id)
        .eq('post_id', post_id)
        .single();

      if (userLikeError && userLikeError.code !== 'PGRST116') {
        console.error('Error checking user like status:', userLikeError);
        return Response.json({ 
          success: false, 
          error: 'Error checking user like status' 
        }, { status: 500, headers });
      }

      const response: PostLikeResponse = {
        id: post_id,
        like_count: count || 0,
        is_liked_by_user: !!userLikeStatus
      };

      // Return success response with like count and user's like status
      return Response.json({ 
        success: true, 
        message: existingLike ? 'Post unliked successfully' : 'Post liked successfully',
        data: response
      }, { status: 200, headers });

    } catch (error) {
      console.error('Unexpected error:', error);
      return Response.json({ 
        success: false, 
        error: `Unexpected error: ${error.message}` 
      }, { status: 500, headers });
    }

  } catch (error) {
    console.error('Unexpected error:', error);
    return Response.json({ 
      success: false, 
      error: `Unexpected error: ${error.message}` 
    }, { status: 500, headers });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/toggle-post-like' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
