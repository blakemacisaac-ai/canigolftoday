import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST() {
  try {
    const count = await redis.incr("visitor_count");
    return Response.json({ count }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Redis error:", err);
    return Response.json({ count: 0 }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function GET() {
  try {
    const count = (await redis.get<number>("visitor_count")) ?? 0;
    return Response.json({ count }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("Redis error:", err);
    return Response.json({ count: 0 }, { status: 500, headers: CORS_HEADERS });
  }
}
