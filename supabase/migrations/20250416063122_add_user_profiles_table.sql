create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, name)
  VALUES (
    NEW.id,
    -- Generate a random username if none provided
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(gen_random_uuid()::text, 1, 8)),
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
