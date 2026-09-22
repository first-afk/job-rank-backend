import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireActiveAccount } from "../../middleware/require-active-account.js";
import { searchJobs } from "./job.controller.js";

export const jobRouter = Router();

jobRouter.post("/search", authenticate, requireActiveAccount, searchJobs);
