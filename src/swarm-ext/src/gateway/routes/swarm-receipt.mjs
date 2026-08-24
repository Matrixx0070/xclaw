/**
 * Swarm Receipt API — Retrieve and validate execution receipts
 */
import { Router } from "express";
import { ReceiptValidator } from "../../swarm/receipt/validator.mjs";

const router = Router();

// GET /api/swarm/receipts/:taskId
router.get("/receipts/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const sessionId = req.query.sessionId || "default";

    // In production, retrieve from persistent store
    res.json({
      taskId,
      status: "not_found",
      message: "Receipt storage not yet implemented — hook into ReceiptGenerator",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/swarm/receipts/:taskId/validate
router.post("/receipts/:taskId/validate", async (req, res) => {
  try {
    const { taskId } = req.params;
    const receipt = req.body;

    const validator = new ReceiptValidator();
    const result = validator.validate(receipt);

    res.json({
      taskId,
      valid: result.valid,
      errors: result.errors,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
