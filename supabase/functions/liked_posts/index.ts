// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Hello from Liked Posts Function!")

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { PaginationParams } from '../_shared/types.ts';
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
  createUnauthorizedResponse
} from '../_shared/response-helper.ts';

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') {
      return createOptionsResponse();
    }

    if (req.method !== 'GET') {
      return createMethodNotAllowedResponse();
    }

    // Verify user authentication
    const userId = await authenticateUser(req.headers.get('Authorization'));
    if (!userId) {
      return createUnauthorizedResponse();
    }

    // Parse query parameters
    const url = new URL(req.url);
    const pagination = parsePaginationParams(url);

    try {
      // Get total count of user's liked posts for pagination
      const whereClause = 'WHERE EXISTS (SELECT 1 FROM user_liked_posts ul WHERE p.id = ul.post_id AND ul.user_id = $1)';
      const queryParams = [userId];
      const total = await getPostsCount(whereClause, queryParams);

      // Get posts with join to user_liked_posts
      const posts = await getPosts(whereClause, queryParams, pagination);

      // If no posts found, return empty array
      if (posts.length === 0) {
        return createPaginatedResponse([], total, pagination);
      }

      // Get the post IDs
      const postIds = posts.map(post => post.id);

      // Get photos and videos for these posts
      const photos = await getPostPhotos(postIds);
      const videos = await getPostVideos(postIds);

      // All posts are liked by this user
      const userLikedPosts = postIds.reduce((acc, id) => {
        acc[id] = true;
        return acc;
      }, {} as Record<string, boolean>);

      // Format posts with media and like information
      const postsWithMedia = formatPostsWithMedia(posts, photos, videos, userId, userLikedPosts);

      // Return the success response
      return createPaginatedResponse(postsWithMedia, total, pagination);

    } catch (error) {
      console.error('Database error:', error);
      return createErrorResponse(`Database error: ${error.message}`);
    }

  } catch (error) {
    console.error('Unexpected error:', error);
    return createErrorResponse(`Unexpected error: ${error.message}`);
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/liked_posts' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' 

*/
