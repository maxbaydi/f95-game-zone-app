(function attachCloudSyncErrors(globalScope) {
  function normalizeErrorText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function formatByteSize(bytes) {
    const numericValue = Number(bytes) || 0;
    if (numericValue <= 0) {
      return "0 B";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = numericValue;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${
      units[unitIndex]
    }`;
  }

  function getFallbackMessage(action) {
    if (action === "restore") {
      return "Could not restore the cloud backup right now.";
    }

    return "Could not back up your saves to the cloud right now.";
  }

  function getGenericHelpSuffix(action) {
    if (action === "restore") {
      return "Your current local saves were left unchanged.";
    }

    return "Your local saves are still safe on this PC.";
  }

  function getCloudSyncErrorDetails(error, options = {}) {
    const action = options.action === "restore" ? "restore" : "upload";
    const rawMessage = normalizeErrorText(error?.message || error);
    const normalizedMessage = rawMessage.toLowerCase();

    if (!rawMessage) {
      return {
        code: "cloud_sync_failed",
        rawMessage: "",
        userMessage: getFallbackMessage(action),
      };
    }

    if (
      normalizedMessage.includes("object exceeded the maximum allowed size") ||
      normalizedMessage.includes("payload too large") ||
      normalizedMessage.includes("request entity too large") ||
      normalizedMessage.includes("body exceeded") ||
      normalizedMessage.includes("maximum allowed size")
    ) {
      const archiveSizeSuffix =
        Number(options.archiveBytes) > 0
          ? ` Current backup size: ${formatByteSize(options.archiveBytes)}.`
          : "";

      return {
        code: "cloud_archive_too_large",
        rawMessage,
        userMessage:
          action === "restore"
            ? "This cloud backup is too large for the current restore path. Your local saves were left unchanged."
            : `This save backup is too large for the current cloud upload limit.${archiveSizeSuffix} Your local saves are still safe on this PC.`,
      };
    }

    if (
      normalizedMessage.includes("object not found") ||
      normalizedMessage.includes("no such object") ||
      normalizedMessage.includes("not found")
    ) {
      return {
        code: "cloud_backup_missing",
        rawMessage,
        userMessage:
          action === "restore"
            ? "No cloud backup was found for this game yet."
            : getFallbackMessage(action),
      };
    }

    if (
      normalizedMessage.includes("invalid login credentials") ||
      normalizedMessage.includes("email not confirmed") ||
      normalizedMessage.includes("user not found") ||
      normalizedMessage.includes("invalid grant")
    ) {
      return {
        code: "cloud_auth_failed",
        rawMessage,
        userMessage:
          "Sign-in failed. Check your email, password, and account confirmation status.",
      };
    }

    if (
      normalizedMessage.includes("network") ||
      normalizedMessage.includes("fetch failed") ||
      normalizedMessage.includes("timed out") ||
      normalizedMessage.includes("timeout") ||
      normalizedMessage.includes("connection")
    ) {
      return {
        code: "cloud_network_failed",
        rawMessage,
        userMessage:
          action === "restore"
            ? "Could not reach cloud saves right now. Check your connection and try again. Your current local saves were left unchanged."
            : "Could not reach cloud saves right now. Check your connection and try again. Your local saves are still safe on this PC.",
      };
    }

    return {
      code: "cloud_sync_failed",
      rawMessage,
      userMessage: `${getFallbackMessage(action)} ${getGenericHelpSuffix(action)}`,
    };
  }

  const api = {
    formatByteSize,
    getCloudSyncErrorDetails,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.cloudSyncErrors = api;
  }
})(globalThis);
