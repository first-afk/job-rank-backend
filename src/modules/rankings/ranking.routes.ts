import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireActiveAccount } from "../../middleware/require-active-account.js";
import {
  startRankingRun,
  getRankingRun,
  getRankingRunResults,
} from "./ranking.controller.js";

export const rankingRouter = Router();

rankingRouter.post("/", authenticate, requireActiveAccount, startRankingRun);

rankingRouter.get("/:runId", authenticate, requireActiveAccount, getRankingRun);

rankingRouter.get(
  "/:runId/results",
  authenticate,
  requireActiveAccount,
  getRankingRunResults,
);
