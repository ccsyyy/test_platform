import { Redis, type RedisOptions } from "ioredis";
import { config } from "../config.js";

const redisOptions: RedisOptions = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  db: config.REDIS_DB,
  lazyConnect: true,
  maxRetriesPerRequest: 3
};

export function createRedisClient(overrides: Partial<RedisOptions> = {}): Redis {
  return new Redis({
    ...redisOptions,
    ...overrides
  });
}

export function createBlockingRedisClient(): Redis {
  return createRedisClient({ maxRetriesPerRequest: null });
}

export const redis = createRedisClient();

export async function pingRedis(): Promise<void> {
  if (redis.status === "wait") {
    await redis.connect();
  }
  await redis.ping();
}
