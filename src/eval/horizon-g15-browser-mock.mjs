/**
 * Deterministic browser-tool mock for G15 offline grader.
 */
export function mockBrowserFormFill(args = {}) {
  const name = args.name || args.fields?.name || "Ada";
  const email = args.email || args.fields?.email || "ada@example.com";
  return {
    ok: true,
    status: "ok",
    submitted: true,
    name,
    email,
    resultText: "SUBMITTED-OK",
  };
}

export default { mockBrowserFormFill };
