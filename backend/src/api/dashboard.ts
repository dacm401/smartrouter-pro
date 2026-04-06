import { Hono } from "hono";
import { calculateDashboard } from "../observatory/metrics-calculator.js";
import { GrowthRepo } from "../db/repositories.js";

const dashboardRouter = new Hono();

dashboardRouter.get("/dashboard/:userId", async (c) => {
  const userId = c.req.param("userId");
  try {
    const data = await calculateDashboard(userId);
    return c.json(data);
  } catch (error: any) {
    console.error("Dashboard error:", error);
    return c.json({ error: error.message }, 500);
  }
});

dashboardRouter.get("/growth/:userId", async (c) => {
  const userId = c.req.param("userId");
  try {
    const profile = await GrowthRepo.getProfile(userId);
    return c.json(profile);
  } catch (error: any) { return c.json({ error: error.message }, 500); }
});

export { dashboardRouter };
