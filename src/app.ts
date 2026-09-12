import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env.js";
import { pinoHttp } from "pino-http";
import { errorHandler } from "./middleware/error-handling.js";
import { authTestRouter } from "./routes/auth-test.routes.js";
import { accountRouter } from "./modules/account/account.routes.js";
import { candidateRouter } from "./modules/candidate/candidate.route.js";

export const app = express();

app.disable("x-powered-by");

app.use(helmet());

app.use(
  cors({
    origin: env.FRONTEND_URL,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "1mb" }));

app.use(pinoHttp({ autoLogging: false }));

app.get("/", (_request, response) => {
  response.status(200).json({
    name: "Job Rank API",
    message: "Welcome to the Job Rank backend.",
    healthCheck: "/health",
  });
});

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    message: "Job Rank API is running",
    environment: env.NODE_ENV,
  });
});

app.use("/v1/auth-test", authTestRouter);
app.use("/v1", accountRouter);
app.use("/v1/candidate", candidateRouter);
app.use((request, response) => {
  response.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `The route ${request.method} ${request.path} does not exist.`,
    },
  });
});
app.use(errorHandler);
