/**
 * Swarm WebSocket Handler
 * Real-time progress streaming for task execution
 */
import { getTaskQueue } from "../../swarm/task-queue.mjs";

export function setupSwarmWebSocket(wsServer) {
  wsServer.on("connection", async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const taskId = url.searchParams.get("taskId");
    const sessionId = url.searchParams.get("sessionId") || "default";

    if (!taskId) {
      ws.send(JSON.stringify({ type: "error", message: "Missing taskId" }));
      ws.close();
      return;
    }

    console.log(`[swarm-ws] Client connected: task=${taskId}, session=${sessionId}`);

    let subscriber = null;

    try {
      const queue = await getTaskQueue();
      subscriber = await queue.subscribeProgress(taskId, (data) => {
        if (ws.readyState === 1) { // OPEN
          ws.send(JSON.stringify(data));
        }
      });

      ws.on("message", (msg) => {
        const text = msg.toString();
        if (text === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        }
      });

      ws.on("close", () => {
        if (subscriber) subscriber.unsubscribe();
        console.log(`[swarm-ws] Client disconnected: ${taskId}`);
      });

      ws.send(JSON.stringify({
        type: "connected",
        taskId,
        sessionId,
        message: "Subscribed to swarm progress",
      }));

    } catch (e) {
      ws.send(JSON.stringify({ type: "error", message: e.message }));
      ws.close();
    }
  });
}
