-- Add tsvector column for title search
ALTER TABLE public.posts ADD COLUMN title_search tsvector GENERATED ALWAYS AS (to_tsvector('english', title)) STORED;

-- Create GIN index for full-text search on the title_search column
CREATE INDEX posts_title_search_idx ON public.posts USING GIN (title_search);

-- Function to update the search vector whenever a post is created or updated
CREATE OR REPLACE FUNCTION update_post_title_search()
RETURNS TRIGGER AS $$
BEGIN
  NEW.title_search = to_tsvector('english', NEW.title);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute the function when posts are inserted or updated
CREATE TRIGGER posts_title_search_update
BEFORE INSERT OR UPDATE ON public.posts
FOR EACH ROW
EXECUTE FUNCTION update_post_title_search();