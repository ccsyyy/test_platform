import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function notFoundHandler(request: Request, _response: Response, next: NextFunction) {
  next(new HttpError(404, `Route not found: ${request.method} ${request.path}`));
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction
) {
  if (error instanceof ZodError) {
    response.status(400).json({
      code: 400,
      message: "参数校验失败",
      data: error.issues
    });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.statusCode).json({
      code: error.statusCode,
      message: error.message,
      data: null
    });
    return;
  }

  const message = error instanceof Error ? error.message : "服务器内部错误";
  response.status(500).json({
    code: 500,
    message,
    data: null
  });
}
