import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../config/supabase.js";
import { AppError } from "./error-handling.js";

export async function requireAdmin(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  try {
    const userId = request.auth?.userId;

    if (!userId) {
      throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    }

    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .single();

    if (error || data?.role !== "admin") {
      throw new AppError(
        403,
        "ADMIN_REQUIRED",
        "Administrator access is required.",
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
