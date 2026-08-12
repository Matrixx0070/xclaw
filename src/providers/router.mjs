/**
 * Provider routing — registry + multi-provider failover + role routing.
 */
export {
  resolveProviderRoute,
  resolveProviderRouteAsync,
  listProviders,
  listModels,
  parseModelRef,
  inferProviderFromModel,
  getProvider,
  BUILTIN_PROVIDERS,
} from "./registry.mjs";

export {
  buildModelChain,
  shouldFailover,
  createProviderForRef,
  createFailoverProvider,
  listRoutableProviders,
} from "./failover-router.mjs";

export {
  ROLES,
  resolveRoleMap,
  resolveRolePolicy,
  selectRole,
  createRoleProviders,
  createRoleAwareProvider,
  createRoleRouter,
} from "./role-router.mjs";
