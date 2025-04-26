import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSignedUrl } from "npm:@aws-sdk/cloudfront-signer";

// CloudFront configuration
const cloudFrontDomain = Deno.env.get('CLOUDFRONT_DOMAIN');
const cloudFrontKeyPairId = Deno.env.get('CLOUDFRONT_KEY_PAIR_ID');
const cloudFrontPrivateKey = Deno.env.get('CLOUDFRONT_PRIVATE_KEY');
const cloudFrontExpiresIn = Deno.env.get('CLOUDFRONT_EXPIRES_IN');

// Validate environment variables
if (!cloudFrontDomain || !cloudFrontKeyPairId || !cloudFrontPrivateKey) {
  throw new Error('Missing required CloudFront configuration. Please check your environment variables.');
}

async function generateSignedUrl(objectUrl, expiresIn = cloudFrontExpiresIn) {
  try {
    const url = new URL(objectUrl);
    const pathParts = url.pathname.split('/').filter(part => part.length > 0);
    const folder = pathParts[0];
    const key = pathParts.slice(1).join('/');
    
    // Construct the CloudFront URL
    const cloudFrontUrl = `https://${cloudFrontDomain}/${folder}/${key}`;
    
    // Generate signed URL using the decoded private key
    const signedUrl = getSignedUrl({
      url: cloudFrontUrl,
      keyPairId: cloudFrontKeyPairId,
      privateKey: cloudFrontPrivateKey,
      dateLessThan: new Date(Date.now() + expiresIn * 1000).toISOString()
    });
    
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
          const signedUrl = await generateSignedUrl(url, cloudFrontExpiresIn);
          
          return {
            originalUrl: url,
            signedUrl,
            expiresAt: new Date(Date.now() + cloudFrontExpiresIn * 1000).toISOString()
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