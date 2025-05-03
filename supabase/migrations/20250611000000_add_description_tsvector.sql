-- Add tsvector column for description search optimization
ALTER TABLE public.posts ADD COLUMN description_search tsvector GENERATED ALWAYS AS (to_tsvector('english', description)) STORED;

-- Create GIN index for full-text search on the description_search column
CREATE INDEX posts_description_search_idx ON public.posts USING GIN (description_search);

-- Function to update the description search vector whenever a post is created or updated
CREATE OR REPLACE FUNCTION update_post_description_search()
RETURNS TRIGGER AS $$
BEGIN
  NEW.description_search = to_tsvector('english', NEW.description);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute the function when posts are inserted or updated
CREATE TRIGGER posts_description_search_update
BEFORE INSERT OR UPDATE ON public.posts
FOR EACH ROW
EXECUTE FUNCTION update_post_description_search();
