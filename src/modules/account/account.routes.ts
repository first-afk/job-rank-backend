import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireActiveAccount } from "../../middleware/require-active-account.js";
import {
  getMe,
  getPreferences,
  updateMe,
  updatePreferences,
} from "./account.controller.js";

export const accountRouter = Router();

accountRouter.use(authenticate);
accountRouter.use(requireActiveAccount);

accountRouter.get("/me", getMe);
accountRouter.patch("/me", updateMe);

accountRouter.get("/preferences", getPreferences);
accountRouter.patch("/preferences", updatePreferences);
