"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { enrichSupabaseStorageError } = require("../src/shared/supabaseStorageErrors");

test("enrichSupabaseStorageError appends JSON body from Response", async () => {
  const body = JSON.stringify({
    statusCode: "InvalidMimeType",
    message: "mime type application/json is not allowed",
  });
  const response = new Response(body, { status: 400 });
  const err = { message: "{}", originalError: response };
  await enrichSupabaseStorageError(err);
  assert.match(err.message, /application\/json is not allowed/);
});
