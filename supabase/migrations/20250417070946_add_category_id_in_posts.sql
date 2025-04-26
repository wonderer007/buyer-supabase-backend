-- Remove the old columns
ALTER TABLE public.posts
DROP COLUMN IF EXISTS category,
DROP COLUMN IF EXISTS condition,
DROP COLUMN IF EXISTS availability;

-- Add the new foreign key column
ALTER TABLE public.posts
ADD COLUMN category_id UUID;

-- Add the foreign key constraint
ALTER TABLE public.posts
ADD CONSTRAINT fk_category
FOREIGN KEY (category_id)
REFERENCES public.categories(id)
ON DELETE SET NULL;