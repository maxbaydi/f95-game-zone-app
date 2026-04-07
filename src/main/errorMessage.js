function getErrorMessage(error, fallback = "Unknown error") {
  if (error instanceof Error) {
    const message = String(error.message || "").trim();
    return message || fallback;
  }

  if (typeof error === "string") {
    const message = error.trim();
    return message || fallback;
  }

  if (error && typeof error === "object") {
    if (typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Ignore non-serializable payloads and use fallback below.
    }
  }

  return fallback;
}

module.exports = {
  getErrorMessage,
};
