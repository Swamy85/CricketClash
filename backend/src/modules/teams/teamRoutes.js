import { Router } from "express";
import { listTeams, upsertTeam } from "./teamController.js";

const router = Router();

router.get("/", listTeams);
router.post("/", upsertTeam);

export default router;
