
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// POST — increment on each visit
export async function POST() {
  try {
    const count = await redis.incr("visitor_count");
    return Response.json({ count });
  } catch (err) {
    console.error("Redis error:", err);
    return Response.json({ count: 0 }, { status: 500 });
  }
}

// GET — read without incrementing (optional, useful for admin checks)
export async function GET() {
  try {
    const count = (await redis.get<number>("visitor_count")) ?? 0;
    return Response.json({ count });
  } catch (err) {
    console.error("Redis error:", err);
    return Response.json({ count: 0 }, { status: 500 });
  }
}
