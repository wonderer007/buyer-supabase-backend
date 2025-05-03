import { Post, Photo, Video, Profile, PaginationParams } from './types.ts';
import { getPool } from './postgres-helper.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { processQueryResult, createPlaceholders } from './util.ts';

// Get total count of posts with optional conditions
export async function getPostsCount(
  whereClause: string = '',
  queryParams: any[] = []
): Promise<number> {
  const client = await getPool().connect();
  try {
    // If whereClause references table alias 'p', we need to include that alias in FROM
    const fromClause = whereClause.includes('p.') ? 'FROM posts p' : 'FROM posts';
    const countQuery = `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
    const countResult = await client.queryObject<{ total: bigint }>(countQuery, queryParams);
    return Number(countResult.rows[0].total);
  } finally {
    client.release();
  }
}

// Get posts with pagination
export async function getPosts(
  whereClause: string = '',
  queryParams: any[] = [],
  pagination: PaginationParams,
  sortClause: string = 'ORDER BY created_at DESC'
): Promise<any[]> {
  const client = await getPool().connect();
  
  try {
    let paramCount = queryParams.length;
    const paginationParams = [pagination.limit, pagination.offset];
    
    const paginationClause = `LIMIT $${++paramCount} OFFSET $${++paramCount}`;
    
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

    const postResult = await client.queryObject(postQuery, [...queryParams, ...paginationParams]);
    return processQueryResult(postResult.rows);
  } finally {
    client.release();
  }
}

// Get photos for a list of posts
export async function getPostPhotos(postIds: string[]): Promise<Photo[]> {
  if (postIds.length === 0) return [];
  
  const client = await getPool().connect();
  try {
    const placeholders = createPlaceholders(postIds);
    const photoQuery = `
      SELECT * FROM photos
      WHERE post_id IN (${placeholders})
      ORDER BY created_at ASC
    `;
    const photoResult = await client.queryObject(photoQuery, postIds);
    return processQueryResult(photoResult.rows);
  } finally {
    client.release();
  }
}

// Get videos for a list of posts
export async function getPostVideos(postIds: string[]): Promise<Video[]> {
  if (postIds.length === 0) return [];
  
  const client = await getPool().connect();
  try {
    const placeholders = createPlaceholders(postIds);
    const videoQuery = `
      SELECT * FROM videos
      WHERE post_id IN (${placeholders})
      ORDER BY created_at ASC
    `;
    const videoResult = await client.queryObject(videoQuery, postIds);
    return processQueryResult(videoResult.rows);
  } finally {
    client.release();
  }
}

// Authenticate user from token and verify they are logged in
export async function authenticateUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    const token = authHeader.replace('Bearer ', '');
    
    // Verify the token and get user information
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return null;
    }

    return user.id;
  } catch (error) {
    console.error('Authentication error:', error);
    return null;
  }
}

// Get liked posts for a user from a list of post IDs
export async function getUserLikedPosts(
  userId: string, 
  postIds: string[]
): Promise<Record<string, boolean>> {
  if (!userId || postIds.length === 0) return {};
  
  const client = await getPool().connect();
  try {
    const likedPostsMap: Record<string, boolean> = {};
    const placeholders = createPlaceholders(postIds, 2);
    
    const userLikedQuery = `
      SELECT post_id FROM user_liked_posts
      WHERE user_id = $1 AND post_id IN (${placeholders})
    `;
    const userLikedResult = await client.queryObject(userLikedQuery, [userId, ...postIds]);
    
    userLikedResult.rows.forEach(row => {
      likedPostsMap[row.post_id] = true;
    });
    
    return likedPostsMap;
  } finally {
    client.release();
  }
}

// Format posts with their related photos, videos, and like information
export function formatPostsWithMedia(
  posts: any[],
  photos: Photo[],
  videos: Video[],
  userId: string | null,
  userLikedPosts: Record<string, boolean>
): Post[] {
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
  return posts.map(post => ({
    ...post,
    photos: photosByPostId[post.id] || [],
    videos: videosByPostId[post.id] || [],
    like_count: post.like_count || 0,
    is_liked_by_user: userId ? !!userLikedPosts[post.id] : false,
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
} 