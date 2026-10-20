import express from "express";
import Router from "./views/router.js";

const app = express();

app.use(express.json());
app.use(Router);
app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status =
    Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
      ? err.status
      : 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({
    error: status >= 500 ? "Internal server error" : err.message,
  });
});

export default app;
