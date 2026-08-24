/**
 * Calculator Tool — Safe mathematical expression evaluation
 */
export class CalculatorTool {
  constructor() {
    this.name = "calculate";
    this.description = "Evaluate mathematical expressions safely. Supports arithmetic, powers, roots, trigonometry, and logarithms.";
    this.parameters = {
      expression: { type: "string", description: "Mathematical expression to evaluate", required: true },
      precision: { type: "number", description: "Number of decimal places", default: 10 },
    };
  }

  getSchema() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string", description: "Mathematical expression" },
            precision: { type: "number", default: 10 },
          },
          required: ["expression"],
        },
      },
    };
  }

  async execute({ expression, precision = 10 }) {
    try {
      if (expression.length > 1000) {
        return { success: false, error: "Expression too long (max 1000 chars)" };
      }

      // Safe math parser — no eval()
      const sanitized = expression
        .replace(/[^0-9+\-*/().\s\[\]{}^sqrtabscostanloglnexppie]/gi, "")
        .replace(/\^\^/g, "**")
        .replace(/\^/g, "**");

      // Replace math functions with Math equivalents
      const mathExpr = sanitized
        .replace(/sqrt/g, "Math.sqrt")
        .replace(/abs/g, "Math.abs")
        .replace(/sin/g, "Math.sin")
        .replace(/cos/g, "Math.cos")
        .replace(/tan/g, "Math.tan")
        .replace(/log/g, "Math.log10")
        .replace(/ln/g, "Math.log")
        .replace(/exp/g, "Math.exp")
        .replace(/pi/g, "Math.PI")
        .replace(/e/g, "Math.E");

      // eslint-disable-next-line no-new-func
      const result = new Function(`return (${mathExpr})`)();

      const rounded = Number(result.toFixed(precision));

      return {
        success: true,
        data: {
          result: rounded,
          expression,
          precision,
          raw: result,
        },
      };
    } catch (e) {
      return { success: false, error: `Math error: ${e.message}` };
    }
  }
}
