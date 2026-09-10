import type { NextFunction, Request, Response } from "express";
import { supabaseAuth } from "../config/supabase.js";
import { AppError } from "./error-handling.js";

export async function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  try {
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      throw new AppError(
        401,
        "INVALID_ACCESS_TOKEN",
        "The access token is missing.",
      );
    }

    const {
      data: { user },
      error,
    } = await supabaseAuth.auth.getUser(token);

    if (error || !user) {
      throw new AppError(
        401,
        "INVALID_ACCESS_TOKEN",
        "Your session is invalid or has expired.",
      );
    }

    request.auth = {
      userId: user.id,
      email: user.email ?? null,
    };

    next();
  } catch (error) {
    next(error);
  }
}
