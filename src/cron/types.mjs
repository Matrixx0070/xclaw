/**
 * Adapted from OpenClaw (MIT) cron types / delivery shapes (subset).
 */

/** @typedef {'every'|'at'|'cron'} ScheduleKind */

/**
 * @typedef {object} CronDelivery
 * @property {'announce'|'none'} mode
 * @property {string} [channel]
 * @property {string} [to]
 * @property {string} [accountId]
 * @property {string|number} [threadId]
 * @property {string} [sessionKey]
 */

/**
 * @typedef {object} CronSchedule
 * @property {ScheduleKind} kind
 * @property {number} [everyMs]
 * @property {string} [at] ISO time
 * @property {string} [expr] 5-field cron (minute hour dom month dow) — minimal support
 */

/**
 * @typedef {object} CronJob
 * @property {string} id
 * @property {string} name
 * @property {boolean} enabled
 * @property {CronSchedule} schedule
 * @property {string} [sessionTarget]
 * @property {string} [sessionKey]
 * @property {CronDelivery} [delivery]
 * @property {object} [payload]
 * @property {string} [agentId]
 * @property {number} [nextRunAt]
 * @property {number} [lastRunAt]
 * @property {string} [lastStatus]
 * @property {string} [lastError]
 */
