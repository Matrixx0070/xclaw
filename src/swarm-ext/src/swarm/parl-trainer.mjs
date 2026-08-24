/**
 * PARL Trainer — Parallel-Agent Reinforcement Learning
 * Trains orchestrator via reward feedback from execution results
 */
import { getConfig } from "./config.mjs";
import { RewardModel } from "./reward-model.mjs";

export class PARLTrainer {
  constructor(llmClient) {
    this.llm = llmClient;
    this.samples = [];
    this.rewardModel = new RewardModel();
  }

  async evaluatePlan(query, plan, executionResults, executionTime) {
    const reward = await this.rewardModel.computeReward(query, plan, executionResults, executionTime);
    const success = executionResults.every(r => !r.error);

    const sample = {
      query,
      plan,
      reward,
      executionTime,
      success,
      timestamp: new Date().toISOString(),
    };

    this.samples.push(sample);
    console.log(`[swarm-parl] Sample recorded: reward=${reward}, success=${success}`);
    return sample;
  }

  getTrainingStats() {
    if (!this.samples.length) return { totalSamples: 0 };
    const rewards = this.samples.map(s => s.reward);
    return {
      totalSamples: this.samples.length,
      avgReward: rewards.reduce((a, b) => a + b, 0) / rewards.length,
      maxReward: Math.max(...rewards),
      minReward: Math.min(...rewards),
      successRate: this.samples.filter(s => s.success).length / this.samples.length,
      avgExecutionTime: this.samples.reduce((a, s) => a + s.executionTime, 0) / this.samples.length,
    };
  }

  exportSamples(path) {
    const fs = require("fs");
    const stream = fs.createWriteStream(path);
    for (const sample of this.samples) {
      stream.write(JSON.stringify(sample) + "\n");
    }
    stream.end();
  }
}
