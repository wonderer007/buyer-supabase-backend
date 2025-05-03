import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { PaginationParams, Post } from '../_shared/types.ts';
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
  createMethodNotAllowedResponse 
} from '../_shared/response-helper.ts';

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') {
      return createOptionsResponse();
    }

    if (req.method !== 'GET') {
      return createMethodNotAllowedResponse();
    }

    // Parse query parameters
    const url = new URL(req.url);
    const pagination = parsePaginationParams(url);

    try {
      // Get total count for pagination
      const total = await getPostsCount();

      // Get posts with like count and user profile
      const posts = await getPosts('', [], pagination);

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
      console.error('Database error:', error);
      return createErrorResponse(`Database error: ${error.message}`);
    }

  } catch (error) {
    console.error('Unexpected error:', error);
    return createErrorResponse(`Unexpected error: ${error.message}`);
  }
});
