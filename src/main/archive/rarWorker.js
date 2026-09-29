// @ts-check

/**
 * Worker-thread entry for RAR tasks (see rarTask.js). The extraction in
 * node-unrar-js is synchronous, so it runs here instead of on the main
 * thread.
 */
const { parentPort, workerData } = require("worker_threads");
const { runRarTask } = require("./rarTask");

runRarTask(workerData)
  .then((result) => {
    parentPort?.postMessage(result);
  })
  .catch((error) => {
    parentPort?.postMessage({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  });
