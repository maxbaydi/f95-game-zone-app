"use strict";

async function enrichSupabaseStorageError(error) {
  if (!error || typeof error !== "object") {
    return error;
  }

  const original = error.originalError;
  if (!(original instanceof Response)) {
    return error;
  }

  let bodyText = "";
  try {
    bodyText = await original.clone().text();
  } catch {
    return error;
  }

  const trimmed = bodyText.trim();
  if (!trimmed) {
    return appendHttp400Hint(error, original.status);
  }

  let detail = trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      detail =
        parsed.message ||
        parsed.error ||
        parsed.error_description ||
        detail;
    }
  } catch {
    /* keep raw */
  }

  const base = String(error.message || "").trim();
  if (detail && !base.includes(detail.slice(0, 120))) {
    error.message = base ? `${base}: ${detail}` : detail;
  }

  return appendHttp400Hint(error, original.status);
}

function appendHttp400Hint(error, status) {
  if (status !== 400) {
    return error;
  }

  const msg = String(error.message || "");
  const lower = msg.toLowerCase();
  if (
    lower.includes("object not found") ||
    lower.includes("not found") ||
    lower.includes("no such object") ||
    lower.includes("the resource was not found")
  ) {
    return error;
  }

  const hint =
    "Storage HTTP 400: confirm the bucket exists; in Dashboard → Storage → bucket → Configuration allow MIME type application/json (or remove MIME restrictions); apply RLS SQL from docs/supabase/cloud-save-setup.sql.";
  if (!msg.includes("application/json")) {
    error.message = msg ? `${msg}\n${hint}` : hint;
  }
  return error;
}

module.exports = {
  enrichSupabaseStorageError,
};
