create table public.user_liked_posts (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  liked_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
