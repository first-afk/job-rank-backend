import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../config/supabase.js";
import { AppError } from "./error-handling.js";

export async function requireActiveAccount(
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
      .from("user_entitlements")
      .select("account_status")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      throw new AppError(
        403,
        "ENTITLEMENT_NOT_FOUND",
        "No account entitlement was found.",
      );
    }

    if (data.account_status !== "active") {
      throw new AppError(
        403,
        "ACCOUNT_SUSPENDED",
        "This account has been suspended.",
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
