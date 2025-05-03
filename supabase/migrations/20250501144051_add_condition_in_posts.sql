-- Add condition column to posts table
ALTER TABLE posts
ADD COLUMN condition INTEGER NOT NULL DEFAULT 0;

-- Add comment to explain the column
COMMENT ON COLUMN posts.condition IS 'Represents the condition of the post (0 = default)';
