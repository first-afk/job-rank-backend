import { Router } from "express";
import { rankingConfiguration } from "./ranking.configuration.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireActiveAccount } from "../../middleware/require-active-account.js";
import {
  startRankingRun,
  getRankingRun,
  getRankingRunResults,
} from "./ranking.controller.js";

export const rankingRouter = Router();

rankingRouter.get("/configuration", authenticate, requireActiveAccount, (_request, response) => {
  response.json({ data: rankingConfiguration() });
});

rankingRouter.post("/", authenticate, requireActiveAccount, startRankingRun);

rankingRouter.get("/:runId", authenticate, requireActiveAccount, getRankingRun);

rankingRouter.get(
  "/:runId/results",
  authenticate,
  requireActiveAccount,
  getRankingRunResults,
);
