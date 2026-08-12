/**
 * xclaw keys — automated key rotation control
 *
 *   xclaw keys status
 *   xclaw keys rotate
 *   xclaw keys evaluate
 *   xclaw keys scheduler start|stop|status
 *   xclaw keys strategies
 */
import {
  ensureKeyStore,
  rotateKeys,
  evaluateKeyRotation,
  keyRotationStatus,
  listKeyRotationStrategies,
  maybeAutoRotate,
} from "../auth/key-rotation.mjs";
import {
  startKeyRotationScheduler,
  stopKeyRotationScheduler,
  getSchedulerStatus,
  runRotationOnce,
  installAutomatedKeyRotation,
} from "../auth/key-rotation-scheduler.mjs";
import {
  recoverFromCompromise,
  recoveryStatus,
} from "../auth/key-compromise-recovery.mjs";
import {
  listPlaybooks,
  runPlaybook,
  recommendPlaybook,
} from "../auth/key-compromise-playbooks.mjs";
import {
  exportJwks,
  getJwksCached,
  invalidateJwksCache,
  refreshJwksAfterRotation,
  listJwksCacheStrategies,
  findJwkByKid,
} from "../auth/jwks.mjs";
import {
  publishJwksInvalidation,
  getInvalidationEpoch,
} from "../auth/jwks-invalidation.mjs";
import {
  startJwksRedisSubscriber,
  stopJwksRedisSubscriber,
  jwksRedisStatus,
} from "../auth/jwks-redis-pubsub.mjs";

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function has(args, name) {
  return args.includes(name);
}

export async function runKeysCli(cfg, argv = []) {
  const [cmd, ...args] = argv;
  const sub = cmd || "status";

  if (sub === "strategies") {
    console.log(JSON.stringify(listKeyRotationStrategies(), null, 2));
    return 0;
  }

  if (sub === "status") {
    await ensureKeyStore(cfg);
    const st = await keyRotationStatus(cfg);
    const sch = getSchedulerStatus();
    console.log(JSON.stringify({ ...st, scheduler: sch }, null, 2));
    return 0;
  }

  if (sub === "evaluate") {
    const ev = await evaluateKeyRotation(cfg);
    console.log(JSON.stringify(ev, null, 2));
    return ev.action === "rotate" ? 2 : 0;
  }

  if (sub === "rotate") {
    const r = await rotateKeys(cfg, {
      reason: flag(args, "--reason") || "cli",
    });
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  if (sub === "auto") {
    const r = await maybeAutoRotate(cfg, { force: true });
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }

  if (sub === "once") {
    const r = await runRotationOnce(cfg);
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }

  if (sub === "scheduler") {
    const action = args[0] || "status";
    if (action === "start") {
      const intervalMs = Number(flag(args, "--interval")) || undefined;
      const r = startKeyRotationScheduler(cfg, { intervalMs });
      console.log(JSON.stringify(r, null, 2));
      return 0;
    }
    if (action === "stop") {
      console.log(JSON.stringify(stopKeyRotationScheduler(), null, 2));
      return 0;
    }
    if (action === "status") {
      console.log(JSON.stringify(getSchedulerStatus(), null, 2));
      return 0;
    }
    if (action === "install") {
      const r = await installAutomatedKeyRotation(cfg);
      console.log(JSON.stringify({ ok: true, intervalMs: r.intervalMs }, null, 2));
      return 0;
    }
    console.error("Usage: xclaw keys scheduler <start|stop|status|install>");
    return 1;
  }

  if (sub === "recover") {
    const r = await recoverFromCompromise(cfg, {
      reason: flag(args, "--reason") || "cli_recover",
    });
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  if (sub === "recovery-status") {
    console.log(JSON.stringify(await recoveryStatus(cfg), null, 2));
    return 0;
  }

  if (sub === "playbooks") {
    console.log(JSON.stringify(listPlaybooks(), null, 2));
    return 0;
  }

  if (sub === "playbook") {
    const name = args[0];
    if (!name) {
      console.error(
        "Usage: xclaw keys playbook <soft_suspect|previous_leak|current_leak|full_host|drain_then_cut> [--reason ...] [--dry-run]"
      );
      return 1;
    }
    const report = await runPlaybook(cfg, name, {
      reason: flag(args, "--reason") || `cli:${name}`,
      dryRun: has(args, "--dry-run"),
    });
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  if (sub === "recommend-playbook") {
    const signal = {
      hostCompromise: has(args, "--host"),
      currentKeyLeaked: has(args, "--current"),
      previousKeyLeaked: has(args, "--previous"),
      suspectOnly: has(args, "--suspect"),
      drainFirst: has(args, "--drain"),
    };
    const name = recommendPlaybook(signal);
    console.log(JSON.stringify({ signal, playbook: name }, null, 2));
    return 0;
  }

  if (sub === "jwks") {
    const action = args[0] || "export";
    if (action === "export") {
      const exp = await exportJwks(cfg);
      console.log(JSON.stringify(exp, null, 2));
      return 0;
    }
    if (action === "cache") {
      const r = await getJwksCached(cfg, {
        force: has(args, "--force"),
        kid: flag(args, "--kid"),
      });
      console.log(JSON.stringify(r, null, 2));
      return 0;
    }
    if (action === "invalidate") {
      console.log(JSON.stringify(await invalidateJwksCache(cfg), null, 2));
      return 0;
    }
    if (action === "refresh") {
      console.log(JSON.stringify(await refreshJwksAfterRotation(cfg), null, 2));
      return 0;
    }
    if (action === "find") {
      const kid = flag(args, "--kid") || args[1];
      const r = await findJwkByKid(cfg, kid);
      console.log(JSON.stringify(r, null, 2));
      return r.ok ? 0 : 1;
    }
    if (action === "strategies") {
      console.log(JSON.stringify(listJwksCacheStrategies(), null, 2));
      return 0;
    }
    if (action === "publish-invalidation") {
      const r = await publishJwksInvalidation(cfg, {
        reason: flag(args, "--reason") || "cli",
      });
      console.log(JSON.stringify(r, null, 2));
      return r.ok ? 0 : 1;
    }
    if (action === "epoch") {
      console.log(JSON.stringify(await getInvalidationEpoch(cfg), null, 2));
      return 0;
    }
    if (action === "redis-status") {
      console.log(JSON.stringify(jwksRedisStatus(cfg), null, 2));
      return 0;
    }
    if (action === "redis-subscribe") {
      const r = await startJwksRedisSubscriber(cfg);
      console.log(JSON.stringify(r, null, 2));
      return r.ok ? 0 : 1;
    }
    if (action === "redis-stop") {
      console.log(JSON.stringify(await stopJwksRedisSubscriber(), null, 2));
      return 0;
    }
    console.error(
      "Usage: xclaw keys jwks <export|cache|invalidate|refresh|find|strategies|publish-invalidation|epoch|redis-status|redis-subscribe|redis-stop> [--force] [--kid ...] [--reason ...]"
    );
    return 1;
  }

  console.error(`Usage:
  xclaw keys status
  xclaw keys strategies
  xclaw keys evaluate
  xclaw keys rotate [--reason ...]
  xclaw keys auto
  xclaw keys once
  xclaw keys scheduler start|stop|status|install [--interval ms]
  xclaw keys recover [--reason ...]
  xclaw keys recovery-status
  xclaw keys playbooks
  xclaw keys playbook <name> [--reason ...] [--dry-run]
  xclaw keys recommend-playbook [--host|--current|--previous|--suspect|--drain]
  xclaw keys jwks export|cache|invalidate|refresh|find|strategies`);
  return 1;
}
