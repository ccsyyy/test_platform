import { Router } from "express";
import { z } from "zod";
import { mysqlPool } from "../db/mysql.js";
import { requireAuth, signToken } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyPassword } from "../utils/password.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

authRouter.post(
  "/auth/login",
  asyncHandler(async (request, response) => {
    const body = loginSchema.parse(request.body);
    const [rows] = await mysqlPool.query(
      `
      SELECT u.id, u.username, u.password_hash, r.role_code
      FROM sys_user u
      JOIN sys_role r ON r.id = u.role_id
      WHERE u.username = ? AND u.status = 1
      LIMIT 1
      `,
      [body.username]
    );
    const users = rows as Array<{
      id: number;
      username: string;
      password_hash: string;
      role_code: string;
    }>;
    const user = users[0];
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      throw new HttpError(401, "用户名或密码错误");
    }

    await mysqlPool.query("UPDATE sys_user SET last_login_at = NOW(3) WHERE id = ?", [user.id]);
    const token = signToken({
      id: user.id,
      username: user.username,
      roleCode: user.role_code
    });

    response.json({
      code: 200,
      message: "success",
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          roleCode: user.role_code
        }
      }
    });
  })
);

authRouter.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (request, response) => {
    response.json({
      code: 200,
      message: "success",
      data: request.user
    });
  })
);

authRouter.post(
  "/auth/logout",
  requireAuth,
  asyncHandler(async (_request, response) => {
    response.json({
      code: 200,
      message: "success",
      data: null
    });
  })
);
