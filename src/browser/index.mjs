/**
 * XClaw B0 browser surface — human-like Chromium control.
 */
export { humanize, reactionDelay, keyDelay, settleDelay, sleep, mousePath, typingPlan, humanType, humanClick, scrollPlan, humanScroll } from "./humanize.mjs";
export { resolveProfileDir, seedFromSystemChrome, acquireProfileLock, DEFAULT_VAULT } from "./profile.mjs";

export {
  isMitmEnabled,
  mitmPort,
  mitmConfdir,
  ensureMitmConfdir,
  findMitmdump,
  startMitm,
  stopMitm,
  isMitmRunning,
  readMitmPid,
  chromeProxyArgs,
  chromeMitmArgs,
  findMitmCaCert,
  getMitmCaInfo,
  ensureMitmCa,
  exportMitmCa,
  mitmCaStatus,
  mitmCaSpkiHash,
  trustMitmCaInProfile,
  readMitmFlows,
  mitmStatus,
  clearMitmFlows,
  formatMitmFlows,
  mitmEnvFromConfig,
  waitForMitmReady,
  probePort,
} from "./mitm.mjs";

export {
  buildProductionChromeArgs,
  acquireDurableProfileLock,
  releaseDurableProfileLock,
  rotateFileIfLarge,
  horizon0Checklist,
} from "./horizon0.mjs";

export {
  createActionId,
  networkCursor,
  networkDeltaSince,
  bindActionFlows,
  withNetworkBinding,
  formatA11ySnapshot,
  STRUCTURE_SNAPSHOT_JS,
  assertOutcome,
  readActionBindings,
} from "./sense.mjs";

export {
  loadPolicy,
  savePolicy,
  emptyPolicy,
  evaluateRequestPolicy,
  evaluateRequireRules,
  exportProofBundle,
  afterBrowserToolTruth,
  policyToEnvHints,
  matchRule,
} from "./truth.mjs";

export { fittsDuration, fittsID, readingPause } from "./humanize.mjs";
export {
  sanitizeOriginHost,
  resolveOriginProfile,
  listOriginProfiles,
} from "./profile.mjs";

export {
  acquireTabLease,
  renewTabLease,
  releaseTabLease,
  requireTabLease,
  listTabLeases,
  openCommitGate,
  resolveCommitGate,
  requireCommitGate,
  listCommitGates,
  fabricStatus,
  roleCaps,
  isCommitSensitive,
  tickClock,
  assertMotorAllowed,
} from "./physics.mjs";

export {
  loadTimeline,
  buildReplayPlan,
  scoreCausal,
  buildSyntheticOriginCatalog,
  startSyntheticOrigin,
  timeTravelReport,
} from "./timetravel.mjs";

export {
  buildChromeArgs,
  beforeNavigate,
  beforeInput,
  afterAction,
  hooksStatus,
} from "./hooks.mjs";

export {
  planClick,
  planType,
  planScroll,
  planMotor,
  executeSteps,
  runMotor,
} from "./motor.mjs";

export {
  bindRole,
  unbindRole,
  getBoundRole,
  resolveRole,
  normalizeRole,
  VALID_ROLES,
  mapSwarmRoleToFabric,
  bindSwarmSpawnRole,
} from "./role-binding.mjs";
export {
  jscodeMode,
  looksLikeMotorJs,
  assertJsCodeAllowed,
} from "./jscode-policy.mjs";

export { acquireFabricLock, withFabricLock } from "./fabric-lock.mjs";

export {
  touchLease,
  startLeaseHeartbeat,
  stopLeaseHeartbeat,
  stopAllLeaseHeartbeats,
  listLeaseHeartbeats,
  acquireWithHeartbeat,
  onLeaseReleased,
} from "./lease-heartbeat.mjs";
