// Entry module: workerd treats every named export here as an entrypoint, so
// it exports only the handler. The logic lives in stats.js.
import { handleRequest, pruneOldDays, utcDay } from "./stats.js";

export default {
  /**
   * @param {Request} request
   * @param {any} env
   */
  fetch(request, env) {
    return handleRequest(request, env);
  },
  /**
   * @param {any} _controller
   * @param {any} env
   */
  async scheduled(_controller, env) {
    await pruneOldDays(env.DB, utcDay(Date.now()));
  },
};
