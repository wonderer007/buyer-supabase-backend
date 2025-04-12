import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";


const s3Client = new S3Client({
  region: Deno.env.get('AWS_REGION'),
  credentials: {
    accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID'),
    secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY')
  }
});

async function generateSignedUrl(objectUrl, expiresIn = 3600) {
  try {
    const url = new URL(objectUrl);
    const pathParts = url.pathname.split('/').filter(part => part.length > 0);
    const folder = pathParts[0];
    const key = pathParts.slice(1).join('/');
    
    const command = new GetObjectCommand({
      Bucket: Deno.env.get('AWS_BUCKET_NAME'),
      Key: `${folder}/${key}`
    });
    
    // Generate signed URL
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
}

Deno.serve(async (req) => {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Method not allowed' 
        }),
        { status: 405, headers }
      );
    }
    
    // Parse request for URLs to sign
    const { urls } = await req.json();
    
    // Validate input
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid request. Expected array of URLs.' 
        }),
        { status: 400, headers }
      );
    }
    
    // Limit to max 5 URLs per request
    const urlsToProcess = urls.slice(0, 10);
    
    // Generate signed URLs
    const signedUrls = await Promise.all(
      urlsToProcess.map(async (url) => {
        try {
          // Generate signed URL with 1-hour expiry
          const signedUrl = await generateSignedUrl(url, 3600);
          
          return {
            originalUrl: url,
            signedUrl,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
          };
        } catch (error) {
          return {
            originalUrl: url,
            error: error.message
          };
        }
      })
    );
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        signedUrls 
      }),
      { status: 200, headers }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { status: 500, headers }
    );
  }
});