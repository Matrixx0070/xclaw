/**
 * Doctor skills.integrity check — uses doctorSkillsIntegrityCheck for prod posture.
 */
export async function pushSkillsIntegrity(push, cfg) {
  try {
    const integrity = await import("../skills/integrity.mjs");
    const { doctorSkillsIntegrityCheck } = await import(
      "../skills/doctor-integrity.mjs"
    );
    const { loadAllSkills } = await import("../skills/loader.mjs");
    const { path: lockPath, data } = await integrity.readLockfile(process.cwd());
    if (!data) {
      const finding = doctorSkillsIntegrityCheck(cfg, { hasLockfile: false });
      push(finding.id, finding.status, finding.message);
      return;
    }
    const rawCfg = { ...cfg, skills: { ...(cfg.skills || {}), integrity: "off" } };
    const skills = await loadAllSkills({
      configDir: cfg.paths?.configDir,
      cwd: process.cwd(),
      cfg: rawCfg,
    });
    const { evaluated, missing } = await integrity.evaluateSkills(skills, data);
    const drift =
      evaluated.filter((e) => e.status !== "verified").length + missing.length;
    const mode = integrity.resolveIntegrityMode(cfg, true);
    const finding = doctorSkillsIntegrityCheck(cfg, {
      hasLockfile: true,
      driftCount: drift,
      mode,
    });
    if (finding.status === "ok" && drift === 0) {
      push(
        "skills.integrity",
        "ok",
        `${evaluated.length} skill(s) verified against lockfile (mode=${mode}) path=${lockPath}`
      );
    } else {
      push(finding.id, finding.status, finding.message);
    }
  } catch (ie) {
    push("skills.integrity", "warn", ie?.message || String(ie));
  }
}
