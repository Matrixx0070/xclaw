/**
 * xclaw_skill — on-demand skill loading (progressive disclosure, brief 7.3).
 *
 * The system prompt carries only a compact skill index (see
 * skills/loader.mjs buildContextSections); this tool returns any skill's
 * FULL body + metadata when the agent decides it needs it. Read-only,
 * runs in-process on the local plane.
 */
import { loadAllSkills } from "../skills/loader.mjs";

function textResult(text, extra = {}) {
  return {
    content: [{ type: "text", text: String(text ?? "") }],
    ...extra,
  };
}

function errorResult(msg) {
  return {
    isError: true,
    content: [{ type: "text", text: String(msg) }],
  };
}

export function createSkillTools({ workingDir, cfg } = {}) {
  const wd = workingDir || process.cwd();
  const conf = cfg || {};
  return [
    {
      name: "xclaw_skill",
      description:
        "Load a skill's full instructions by name (the system prompt only carries the skill index). Call without a name to list all available skills.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Skill name from the Available skills index. Omit to list skills.",
          },
        },
      },
      isReadOnly: () => true,
      async execute(args = {}) {
        let skills;
        try {
          skills = await loadAllSkills({
            configDir: conf.paths?.configDir,
            cwd: wd,
            cfg: conf,
          });
        } catch (err) {
          return errorResult(`skill load failed: ${err?.message || err}`);
        }
        const name = String(args.name || "").trim();
        if (!name) {
          const lines = skills.map(
            (s) =>
              `- ${s.name}${s.description ? `: ${s.description}` : ""} (${String(s.body || "").length} chars)`
          );
          return textResult(
            lines.length ? `Available skills (${lines.length}):\n${lines.join("\n")}` : "No skills installed.",
            { count: skills.length }
          );
        }
        const found = skills.find(
          (s) => String(s.name).toLowerCase() === name.toLowerCase()
        );
        if (!found) {
          const names = skills.map((s) => s.name).join(", ") || "(none)";
          return errorResult(`Unknown skill "${name}". Available: ${names}`);
        }
        const meta = { ...found.meta };
        return textResult(
          `# Skill: ${found.name}\n${found.description ? `${found.description}\n` : ""}\n${found.body}`,
          { skill: { name: found.name, path: found.path, meta } }
        );
      },
    },
  ];
}

export default { createSkillTools };
