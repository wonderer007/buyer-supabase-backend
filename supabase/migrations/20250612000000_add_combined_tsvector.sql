-- Add combined tsvector column for searching across both title and description
ALTER TABLE public.posts ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') || 
  setweight(to_tsvector('english', coalesce(description, '')), 'B')
) STORED;

-- Create GIN index for the combined search vector
CREATE INDEX posts_search_document_idx ON public.posts USING GIN (search_document);

-- Function to update the combined search vector whenever a post is created or updated
CREATE OR REPLACE FUNCTION update_post_search_document()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_document = 
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') || 
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute the function when posts are inserted or updated
CREATE TRIGGER posts_search_document_update
BEFORE INSERT OR UPDATE ON public.posts
FOR EACH ROW
EXECUTE FUNCTION update_post_search_document(); 