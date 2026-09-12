import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
) => {
  request.log.error({ error }, "Request failed");

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    });

    return;
  }

  if (error instanceof ZodError) {
    response.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Some supplied values are invalid.",
        details: error.flatten().fieldErrors,
      },
    });

    return;
  }

  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong while processing the request.",
    },
  });
};
