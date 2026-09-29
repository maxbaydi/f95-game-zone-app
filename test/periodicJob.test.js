const test = require("node:test");
const assert = require("node:assert/strict");

const { createPeriodicJob } = require("../src/main/periodicJob");

function makeClock() {
  let time = 1000;
  const timers = new Map();
  let sequence = 0;
  return {
    now: () => time,
    setTimer: (callback, delay) => {
      const id = ++sequence;
      timers.set(id, { at: time + delay, callback });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    async advance(ms) {
      const target = time + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) {
          break;
        }
        timers.delete(due[0]);
        time = due[1].at;
        due[1].callback();
        await Promise.resolve();
        await Promise.resolve();
      }
      time = target;
    },
    pending: () => timers.size,
  };
}

test("periodic job repeats after the interval and never overlaps runs", async () => {
  const clock = makeClock();
  const runs = [];
  let resolveRun = () => {};
  const job = createPeriodicJob({
    name: "check",
    intervalMs: 60 * 60 * 1000,
    run: (reason) => {
      runs.push(reason);
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    },
    ...clock,
  });

  job.start({ initialDelayMs: 5000 });
  assert.equal(job.getState().started, true);
  await clock.advance(5000);
  assert.deepEqual(runs, ["interval"]);
  // A kick while the run is in progress is ignored.
  job.kick("resume", 10);
  await clock.advance(100);
  assert.deepEqual(runs, ["interval"]);
  resolveRun();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(job.getState().running, false);
  assert.equal(clock.pending(), 1, "next run scheduled");
  await clock.advance(60 * 60 * 1000);
  assert.deepEqual(runs, ["interval", "interval"]);
  resolveRun();
  await Promise.resolve();
});

test("periodic job skips runs while disabled and can be kicked early", async () => {
  const clock = makeClock();
  const runs = [];
  let enabled = false;
  const job = createPeriodicJob({
    name: "check",
    intervalMs: 60 * 1000,
    isEnabled: () => enabled,
    run: (reason) => {
      runs.push(reason);
    },
    ...clock,
  });
  job.start({ initialDelayMs: 0 });
  await clock.advance(10);
  assert.deepEqual(runs, []);
  enabled = true;
  job.kick("resume", 30 * 1000);
  await clock.advance(30 * 1000);
  assert.deepEqual(runs, ["resume"]);
  job.stop();
  assert.equal(clock.pending(), 0);
  await clock.advance(10 * 60 * 1000);
  assert.deepEqual(runs, ["resume"]);
});

test("periodic job logs a failing run and keeps the schedule", async () => {
  const clock = makeClock();
  const warnings = [];
  let attempt = 0;
  const job = createPeriodicJob({
    name: "check",
    intervalMs: 60 * 1000,
    run: () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("offline");
      }
    },
    logger: { warn: (...args) => warnings.push(args.join(" ")) },
    ...clock,
  });
  job.start({ initialDelayMs: 0 });
  await clock.advance(1);
  assert.equal(attempt, 1);
  assert.match(warnings[0], /offline/);
  await clock.advance(60 * 1000);
  assert.equal(attempt, 2);
});
