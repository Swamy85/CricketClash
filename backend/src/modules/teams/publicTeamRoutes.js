import { Router } from "express";
import { listTeams } from "./teamController.js";

const router = Router();

// Public pages use the active team catalog to label shared match fixtures.
// Keep this router read-only; catalog changes remain admin-only.
router.get("/", listTeams);

export default router;
