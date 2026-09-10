import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireActiveAccount } from "../middleware/require-active-account.js";
import { requireAdmin } from "../middleware/require-admin.js";

export const authTestRouter = Router();

authTestRouter.get(
  "/protected",
  authenticate,
  requireActiveAccount,
  (request, response) => {
    response.json({
      message: "You are authenticated.",
      user: request.auth,
    });
  },
);

authTestRouter.get(
  "/admin",
  authenticate,
  requireActiveAccount,
  requireAdmin,
  (request, response) => {
    response.json({
      message: "You are an administrator.",
    });
  },
);
