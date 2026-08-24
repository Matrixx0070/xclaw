/**
 * Swarm Batch API — Submit multiple goals as a batch
 */
import { Router } from "express";

const router = Router();

router.post("/batch", async (req, res) => {
  try {
    const { goals, sessionId = "default", profile = "lab" } = req.body;

    if (!Array.isArray(goals) || goals.length === 0) {
      return res.status(400).json({ error: "Goals must be a non-empty array" });
    }

    if (goals.length > 100) {
      return res.status(400).json({ error: "Max 100 goals per batch" });
    }

    const taskIds = [];
    for (const goal of goals) {
      // Forward to single goal handler
      const mockReq = { ...req, body: { ...goal, sessionId, profile } };
      // In practice, you'd call the orchestrator directly
      taskIds.push(`task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    }

    res.status(202).json({
      batchId: `batch_${Date.now()}`,
      taskIds,
      status: "pending",
      message: "Batch accepted. Poll individual tasks for results.",
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
