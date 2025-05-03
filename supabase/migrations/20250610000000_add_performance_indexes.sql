-- Add performance indexes for Supabase Edge Functions

-- Index for posts by category_id (used in search-results)
CREATE INDEX IF NOT EXISTS posts_category_id_idx ON public.posts(category_id);

-- Index for posts by user_id (used in my_posts function)
CREATE INDEX IF NOT EXISTS posts_user_id_idx ON public.posts(user_id);

-- Index for posts by location (used in search-results)
CREATE INDEX IF NOT EXISTS posts_location_idx ON public.posts(location);

-- Index for posts by price (used in search filtering)
CREATE INDEX IF NOT EXISTS posts_price_idx ON public.posts(price);

-- Index for posts by condition (used in search filtering)
CREATE INDEX IF NOT EXISTS posts_condition_idx ON public.posts(condition);

-- Index for posts by currency (used in search filtering)
CREATE INDEX IF NOT EXISTS posts_currency_idx ON public.posts(currency);

-- Create GIN index for full-text search on the description column
CREATE INDEX IF NOT EXISTS posts_description_search_idx ON public.posts USING GIN (to_tsvector('english', description));

-- Multi-column index for user_liked_posts (helps toggle-post-like and liked_posts functions)
CREATE INDEX IF NOT EXISTS user_liked_posts_post_id_idx ON public.user_liked_posts(post_id);

-- Indexes for photos and videos by post_id to speed up media retrieval
CREATE INDEX IF NOT EXISTS photos_post_id_idx ON public.photos(post_id);
CREATE INDEX IF NOT EXISTS videos_post_id_idx ON public.videos(post_id);

-- Index on posts created_at which is used for sorting in most queries
CREATE INDEX IF NOT EXISTS posts_created_at_idx ON public.posts(created_at DESC); 