/**
 * Reward Model — Computes reward scores for orchestrator plans
 * Heuristic-based scoring for PARL training
 */
export class RewardModel {
  async computeReward(query, plan, results, executionTime) {
    const scores = {
      efficiency: this._scoreEfficiency(plan, executionTime),
      parallelism: this._scoreParallelism(plan),
      accuracy: this._scoreAccuracy(results),
      speed: this._scoreSpeed(executionTime, plan.estimatedDurationSeconds),
    };

    const weights = { efficiency: 0.25, parallelism: 0.25, accuracy: 0.35, speed: 0.15 };
    const total = Object.keys(scores).reduce((sum, k) => sum + scores[k] * weights[k], 0);
    return Math.round(total * 100) / 100;
  }

  _scoreEfficiency(plan, actualTime) {
    if (!plan.decomposedTasks?.length) return 0;
    const optimal = Math.min(plan.decomposedTasks.length, 50);
    return Math.min(100, (optimal / 50) * 100);
  }

  _scoreParallelism(plan) {
    const total = plan.decomposedTasks?.length || 0;
    if (!total) return 0;
    const independent = plan.decomposedTasks.filter(t => !t.dependencies?.length).length;
    return (independent / total) * 100;
  }

  _scoreAccuracy(results) {
    if (!results?.length) return 0;
    const successful = results.filter(r => !r.error).length;
    return (successful / results.length) * 100;
  }

  _scoreSpeed(actual, estimated) {
    if (!estimated) return 50;
    const ratio = actual / estimated;
    if (ratio <= 1) return 100;
    if (ratio <= 2) return 75;
    if (ratio <= 3) return 50;
    return 25;
  }
}
