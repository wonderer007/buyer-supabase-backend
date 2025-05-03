// Common types shared across Edge Functions

export interface Photo {
  id: string;
  url: string;
  name: string;
  post_id: string;
  created_at: string;
}

export interface Video {
  id: string;
  url: string;
  name: string;
  thumbnail_url: string;
  post_id: string;
  created_at: string;
}

export interface Profile {
  id: string;
  username: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Post {
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
  updated_at?: string;
  photos: Photo[];
  videos: Video[];
  like_count: number;
  is_liked_by_user: boolean;
  profile: Profile;
  category_id: string;
  category_name: string;
}

export interface PaginationParams {
  limit?: number;
  page?: number;
  offset?: number;
}

export interface SearchParams extends PaginationParams {
  query?: string;
  min_price?: number;
  max_price?: number;
  location?: string;
  category_id?: string;
  condition?: number;
  sort_by?: 'created_at' | 'price' | 'like_count';
  sort_direction?: 'asc' | 'desc';
  currency?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: {
    posts: T[];
    total: number;
    limit: number;
    page: number;
    offset?: number;
    total_pages: number;
  };
}

export interface ErrorResponse {
  success: false;
  error: string;
} 