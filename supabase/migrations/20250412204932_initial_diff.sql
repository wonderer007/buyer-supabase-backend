create table "public"."photos" (
    "id" uuid not null default gen_random_uuid(),
    "url" character varying not null,
    "name" character varying not null,
    "post_id" uuid,
    "created_at" timestamp with time zone default CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone default CURRENT_TIMESTAMP
);


create table "public"."posts" (
    "id" uuid not null default gen_random_uuid(),
    "title" character varying not null,
    "category" character varying not null,
    "price" numeric not null,
    "currency" character varying not null,
    "condition" character varying not null,
    "location" character varying not null,
    "availability" character varying not null,
    "contact_type" character varying not null,
    "contact_value" character varying not null,
    "description" text not null,
    "created_at" timestamp with time zone default CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone default CURRENT_TIMESTAMP,
    "user_id" uuid
);


create table "public"."videos" (
    "id" uuid not null default gen_random_uuid(),
    "url" character varying not null,
    "name" character varying not null,
    "thumbnail_url" character varying not null,
    "post_id" uuid,
    "created_at" timestamp with time zone default CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone default CURRENT_TIMESTAMP
);


CREATE UNIQUE INDEX photos_pkey ON public.photos USING btree (id);

CREATE UNIQUE INDEX posts_pkey ON public.posts USING btree (id);

CREATE UNIQUE INDEX videos_pkey ON public.videos USING btree (id);

alter table "public"."photos" add constraint "photos_pkey" PRIMARY KEY using index "photos_pkey";

alter table "public"."posts" add constraint "posts_pkey" PRIMARY KEY using index "posts_pkey";

alter table "public"."videos" add constraint "videos_pkey" PRIMARY KEY using index "videos_pkey";

alter table "public"."photos" add constraint "photos_name_check" CHECK ((length((name)::text) >= 1)) not valid;

alter table "public"."photos" validate constraint "photos_name_check";

alter table "public"."photos" add constraint "photos_post_id_fkey" FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE not valid;

alter table "public"."photos" validate constraint "photos_post_id_fkey";

alter table "public"."photos" add constraint "photos_url_check" CHECK ((length((url)::text) >= 1)) not valid;

alter table "public"."photos" validate constraint "photos_url_check";

alter table "public"."posts" add constraint "posts_availability_check" CHECK ((length((availability)::text) >= 1)) not valid;

alter table "public"."posts" validate constraint "posts_availability_check";

alter table "public"."posts" add constraint "posts_category_check" CHECK ((length((category)::text) >= 1)) not valid;

alter table "public"."posts" validate constraint "posts_category_check";

alter table "public"."posts" add constraint "posts_condition_check" CHECK ((length((condition)::text) >= 1)) not valid;

alter table "public"."posts" validate constraint "posts_condition_check";

alter table "public"."posts" add constraint "posts_contact_type_check" CHECK ((length((contact_type)::text) >= 1)) not valid;

alter table "public"."posts" validate constraint "posts_contact_type_check";

alter table "public"."posts" add constraint "posts_contact_value_check" CHECK ((length((contact_value)::text) >= 1)) not valid;

alter table "public"."posts" validate constraint "posts_contact_value_check";

alter table "public"."posts" add constraint "posts_currency_check" CHECK ((length((currency)::text) >= 1)) not valid;

alter table "public"."posts" validate constraint "posts_currency_check";

alter table "public"."posts" add constraint "posts_description_check" CHECK ((length(description) >= 1)) not valid;

alter table "public"."posts" validate constraint "posts_description_check";

alter table "public"."posts" add constraint "posts_location_check" CHECK ((length((location)::text) >= 1)) not valid;

alter table "public"."posts" validate constraint "posts_location_check";

alter table "public"."posts" add constraint "posts_price_check" CHECK ((price > (0)::numeric)) not valid;

alter table "public"."posts" validate constraint "posts_price_check";

alter table "public"."posts" add constraint "posts_title_check" CHECK ((length((title)::text) >= 1)) not valid;

alter table "public"."posts" validate constraint "posts_title_check";

alter table "public"."posts" add constraint "posts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."posts" validate constraint "posts_user_id_fkey";

alter table "public"."videos" add constraint "videos_name_check" CHECK ((length((name)::text) >= 1)) not valid;

alter table "public"."videos" validate constraint "videos_name_check";

alter table "public"."videos" add constraint "videos_post_id_fkey" FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE not valid;

alter table "public"."videos" validate constraint "videos_post_id_fkey";

alter table "public"."videos" add constraint "videos_thumbnail_url_check" CHECK ((length((thumbnail_url)::text) >= 1)) not valid;

alter table "public"."videos" validate constraint "videos_thumbnail_url_check";

alter table "public"."videos" add constraint "videos_url_check" CHECK ((length((url)::text) >= 1)) not valid;

alter table "public"."videos" validate constraint "videos_url_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_post_with_media(post_data jsonb, photos_data jsonb DEFAULT '[]'::jsonb, videos_data jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  new_post_id UUID;
  photo_record RECORD;
  video_record RECORD;
  result JSONB;
BEGIN
  -- Start transaction
  BEGIN
    -- Insert post record
    INSERT INTO posts (
      title,
      category,
      price,
      currency,
      condition,
      location,
      availability,
      contact_type,
      contact_value,
      description,
      user_id
    ) VALUES (
      post_data->>'title',
      post_data->>'category',
      (post_data->>'price')::NUMERIC,
      post_data->>'currency',
      post_data->>'condition',
      post_data->>'location',
      post_data->>'availability',
      post_data->>'contact_type',
      post_data->>'contact_value',
      post_data->>'description',
      (post_data->>'user_id')::UUID
    )
    RETURNING id INTO new_post_id;
    
    -- Insert photos if any
    FOR photo_record IN SELECT * FROM jsonb_to_recordset(photos_data) AS photos(url TEXT, name TEXT)
    LOOP
      INSERT INTO photos (url, name, post_id)
      VALUES (photo_record.url, photo_record.name, new_post_id);
    END LOOP;
    
    -- Insert videos if any
    FOR video_record IN SELECT * FROM jsonb_to_recordset(videos_data) AS videos(url TEXT, name TEXT, thumbnail_url TEXT)
    LOOP
      INSERT INTO videos (url, name, thumbnail_url, post_id)
      VALUES (video_record.url, video_record.name, video_record.thumbnail_url, new_post_id);
    END LOOP;
    
    -- Build result
    result = jsonb_build_object(
      'post_id', new_post_id,
      'photos_count', jsonb_array_length(photos_data),
      'videos_count', jsonb_array_length(videos_data)
    );
    
    RETURN result;
  EXCEPTION
    WHEN OTHERS THEN
      -- In case of any error, roll back transaction
      RAISE;
  END;
END;
$function$
;

grant delete on table "public"."photos" to "anon";

grant insert on table "public"."photos" to "anon";

grant references on table "public"."photos" to "anon";

grant select on table "public"."photos" to "anon";

grant trigger on table "public"."photos" to "anon";

grant truncate on table "public"."photos" to "anon";

grant update on table "public"."photos" to "anon";

grant delete on table "public"."photos" to "authenticated";

grant insert on table "public"."photos" to "authenticated";

grant references on table "public"."photos" to "authenticated";

grant select on table "public"."photos" to "authenticated";

grant trigger on table "public"."photos" to "authenticated";

grant truncate on table "public"."photos" to "authenticated";

grant update on table "public"."photos" to "authenticated";

grant delete on table "public"."photos" to "service_role";

grant insert on table "public"."photos" to "service_role";

grant references on table "public"."photos" to "service_role";

grant select on table "public"."photos" to "service_role";

grant trigger on table "public"."photos" to "service_role";

grant truncate on table "public"."photos" to "service_role";

grant update on table "public"."photos" to "service_role";

grant delete on table "public"."posts" to "anon";

grant insert on table "public"."posts" to "anon";

grant references on table "public"."posts" to "anon";

grant select on table "public"."posts" to "anon";

grant trigger on table "public"."posts" to "anon";

grant truncate on table "public"."posts" to "anon";

grant update on table "public"."posts" to "anon";

grant delete on table "public"."posts" to "authenticated";

grant insert on table "public"."posts" to "authenticated";

grant references on table "public"."posts" to "authenticated";

grant select on table "public"."posts" to "authenticated";

grant trigger on table "public"."posts" to "authenticated";

grant truncate on table "public"."posts" to "authenticated";

grant update on table "public"."posts" to "authenticated";

grant delete on table "public"."posts" to "service_role";

grant insert on table "public"."posts" to "service_role";

grant references on table "public"."posts" to "service_role";

grant select on table "public"."posts" to "service_role";

grant trigger on table "public"."posts" to "service_role";

grant truncate on table "public"."posts" to "service_role";

grant update on table "public"."posts" to "service_role";

grant delete on table "public"."videos" to "anon";

grant insert on table "public"."videos" to "anon";

grant references on table "public"."videos" to "anon";

grant select on table "public"."videos" to "anon";

grant trigger on table "public"."videos" to "anon";

grant truncate on table "public"."videos" to "anon";

grant update on table "public"."videos" to "anon";

grant delete on table "public"."videos" to "authenticated";

grant insert on table "public"."videos" to "authenticated";

grant references on table "public"."videos" to "authenticated";

grant select on table "public"."videos" to "authenticated";

grant trigger on table "public"."videos" to "authenticated";

grant truncate on table "public"."videos" to "authenticated";

grant update on table "public"."videos" to "authenticated";

grant delete on table "public"."videos" to "service_role";

grant insert on table "public"."videos" to "service_role";

grant references on table "public"."videos" to "service_role";

grant select on table "public"."videos" to "service_role";

grant trigger on table "public"."videos" to "service_role";

grant truncate on table "public"."videos" to "service_role";

grant update on table "public"."videos" to "service_role";


