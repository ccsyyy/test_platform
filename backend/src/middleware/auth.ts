import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { config } from "../config.js";
import { HttpError } from "./error.js";

export interface AuthUser {
  id: number;
  username: string;
  roleCode: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  const options: SignOptions = {
    expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"]
  };
  return jwt.sign(user, config.JWT_SECRET, {
    ...options
  });
}

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  const header = request.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    next(new HttpError(401, "未登录或 token 缺失"));
    return;
  }

  try {
    request.user = jwt.verify(token, config.JWT_SECRET) as AuthUser;
    next();
  } catch {
    next(new HttpError(401, "token 无效或已过期"));
  }
}

export function requireRole(...roles: string[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.user) {
      next(new HttpError(401, "未登录"));
      return;
    }
    if (!roles.includes(request.user.roleCode)) {
      next(new HttpError(403, "权限不足"));
      return;
    }
    next();
  };
}
