import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";
import { Sha256 } from "npm:@aws-crypto/sha256-js";

Deno.serve(async (req) => {
  try {
    const { fileName, fileType, mediaType } = await req.json();

    if (!["video", "image"].includes(mediaType)) {
      return new Response(
        JSON.stringify({ error: "Invalid media type. Use 'video' or 'image'." }),
        { status: 400 }
      );
    }

    const sizeLimits = {
      video: Deno.env.get("VIDEO_SIZE_LIMIT"),
      image: Deno.env.get("IMAGE_SIZE_LIMIT"),
    };

    const maxSize = sizeLimits[mediaType];
    const prefix = mediaType === "video" ? "videos/" : "images/";
    const key = `${prefix}${fileName}`;

    const s3Client = new S3Client({
      region: Deno.env.get("AWS_REGION"),
      credentials: {
        accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID"),
        secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY"),
      },
      sha256: Sha256,
    });

    const params = {
      Bucket: Deno.env.get("AWS_BUCKET_NAME"),
      Key: key,
      ContentType: fileType,
      // ContentLength: maxSize,
    };

    const command = new PutObjectCommand(params);
    const signedUrl = await getSignedUrl(s3Client, command, { 
      expiresIn: Deno.env.get("PRE_SIGNED_URL_EXPIRATION"),
      // signingDate: new Date(),
      // signableHeaders: new Set(['content-length', 'content-type', 'host']),
    });

    return new Response(
      JSON.stringify({ signedUrl, key }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate presigned URL." }),
      { status: 500 }
    );
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/pre-signed-url' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
