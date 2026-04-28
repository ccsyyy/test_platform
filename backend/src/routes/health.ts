import { Router } from "express";
import { pingMysql } from "../db/mysql.js";
import { pingRedis } from "../db/redis.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const healthRouter = Router();

healthRouter.get(
  "/health",
  asyncHandler(async (_request, response) => {
    await Promise.all([pingMysql(), pingRedis()]);
    response.json({
      code: 200,
      message: "ok",
      data: {
        mysql: "ok",
        redis: "ok"
      }
    });
  })
);
