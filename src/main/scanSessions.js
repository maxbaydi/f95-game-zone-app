// @ts-check

/** @typedef {{ id: string, scope: string, startedAt: string, cancelRequested: boolean, cancelledAt: string | null }} ScanSession */

/** @type {Map<number, ScanSession>} */
const activeSessions = new Map();

/**
 * @param {{ webContents?: { id?: number } } | { id?: number }} target
 * @returns {number | null}
 */
function resolveTargetId(target) {
  if (!target || typeof target !== "object") {
    return null;
  }

  if ("webContents" in target && target.webContents?.id) {
    return target.webContents.id;
  }

  if ("id" in target && typeof target.id === "number") {
    return target.id;
  }

  return null;
}

/**
 * @param {{ webContents?: { id?: number } } | { id?: number }} target
 * @param {string} scope
 */
function beginScanSession(target, scope) {
  const targetId = resolveTargetId(target);

  if (targetId === null) {
    return {
      success: false,
      error: "Cannot start a scan without a renderer target",
      errorCode: "SCAN_TARGET_MISSING",
    };
  }

  if (activeSessions.has(targetId)) {
    return {
      success: false,
      error: "A scan is already running for this window",
      errorCode: "SCAN_ALREADY_RUNNING",
    };
  }

  const session = {
    id: `${targetId}:${Date.now()}`,
    scope,
    startedAt: new Date().toISOString(),
    cancelRequested: false,
    cancelledAt: null,
  };

  activeSessions.set(targetId, session);

  return {
    success: true,
    session,
  };
}

/**
 * @param {{ webContents?: { id?: number } } | { id?: number }} target
 */
function cancelScanSession(target) {
  const targetId = resolveTargetId(target);

  if (targetId === null) {
    return {
      success: false,
      error: "Cannot cancel a scan without a renderer target",
      errorCode: "SCAN_TARGET_MISSING",
    };
  }

  const session = activeSessions.get(targetId);

  if (!session) {
    return {
      success: false,
      error: "No active scan is running for this window",
      errorCode: "SCAN_NOT_RUNNING",
    };
  }

  session.cancelRequested = true;
  session.cancelledAt = new Date().toISOString();

  return {
    success: true,
    session,
  };
}

/**
 * @param {{ webContents?: { id?: number } } | { id?: number }} target
 */
function endScanSession(target) {
  const targetId = resolveTargetId(target);

  if (targetId === null) {
    return;
  }

  activeSessions.delete(targetId);
}

/**
 * @param {ScanSession | null | undefined} session
 */
function isScanCancelled(session) {
  return Boolean(session?.cancelRequested);
}

module.exports = {
  beginScanSession,
  cancelScanSession,
  endScanSession,
  isScanCancelled,
};
