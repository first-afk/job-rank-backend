import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireActiveAccount } from "../../middleware/require-active-account.js";
import { searchJobs } from "./job.controller.js";

import { getWorkspace, saveWorkspace } from "./workspace.controller.js";

export const jobRouter = Router();

jobRouter.post("/search", authenticate, requireActiveAccount, searchJobs);

jobRouter.get("/workspace", authenticate, requireActiveAccount, getWorkspace);
jobRouter.put("/workspace", authenticate, requireActiveAccount, saveWorkspace);
