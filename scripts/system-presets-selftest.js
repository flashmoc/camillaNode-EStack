"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const express = require("express");
const store = require("../server/presetStore");
const gate = require("../server/workflowGate");
const clone = (value) => JSON.parse(JSON.stringify(value));
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "estack-system-test-"));
  const saved = path.join(root, "savedConfigs.dat");
  const stateFile = path.join(root, "startupConfig.json");
  const signal = path.join(root, "signal.json"),
    batch = path.join(root, "batch.json");
  let config = {
    devices: {
      samplerate: 48000,
      chunksize: 1024,
      capture: { type: "Alsa", device: "hardware-in", channels: 2 },
      playback: { type: "Alsa", device: "hardware-out", channels: 2 },
    },
    mixers: { main: { channels: { in: 2, out: 2 }, mapping: [] } },
    filters: { gain: { type: "Gain", parameters: { gain: -3 } } },
    processors: {},
    pipeline: [
      { type: "Mixer", name: "main" },
      { type: "Filter", channels: [0, 1], names: ["gain"] },
    ],
  };
  let volume = -18,
    corrupt = false;
  const commands = [];
  class Socket extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => this.emit("open"));
    }
    close() {}
    terminate() {}
    send(text) {
      const payload = JSON.parse(text),
        name = typeof payload === "string" ? payload : Object.keys(payload)[0];
      commands.push(clone(payload));
      let value;
      if (name === "GetConfigJson") value = JSON.stringify(config);
      if (name === "GetVolume") value = volume;
      if (name === "SetVolume") volume = payload.SetVolume;
      if (name === "SetConfigJson") {
        config = JSON.parse(payload.SetConfigJson);
        if (corrupt) config.filters.gain.parameters.gain = -99;
      }
      queueMicrotask(() =>
        this.emit(
          "message",
          JSON.stringify({ [name]: { result: "Ok", value } }),
        ),
      );
    }
  }
  const unrelated = [
    { id: "eq", type: "global-eq", name: "EQ", data: { bands: [] } },
    { id: "other", type: "foreign", data: { keep: true } },
  ];
  store.atomicWrite(saved, unrelated);
  const app = express();
  require("../server/startupConfiguration")(app, {
    root,
    stateFile,
    savedConfigsFile: saved,
    signalSnapshotPath: signal,
    measurementSessionPath: batch,
    WebSocket: Socket,
    demo: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  async function api(url, data) {
    const response = await fetch(
      base + url,
      data === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(data),
          },
    );
    return { ok: response.ok, body: await response.json() };
  }
  try {
    const original = clone(config);
    const capture = await api("/api/system-presets/capture", {
      name: "Reference",
    });
    assert(capture.ok);
    const id = capture.body.id;
    const record = store.read(saved).find((r) => r.id === id);
    assert.equal(record.data.version, 1);
    assert.equal(record.data.masterVolume, -18);
    assert.equal(record.data.processing.devices, undefined);
    assert.equal(record.data.processing.mixers, undefined);
    assert.deepEqual(store.read(saved).slice(0, 2), unrelated);
    assert.equal(
      (await api("/api/system-presets/capture", { name: "Reference" })).ok,
      false,
    );
    assert(
      (
        await api("/api/system-presets/capture", {
          name: "Reference",
          overwrite: true,
        })
      ).ok,
    );
    assert.equal(store.read(saved).find((r) => r.name === "Reference").id, id);
    config.filters.gain.parameters.gain = -7;
    commands.length = 0;
    assert((await api("/api/system-presets/apply", { id })).ok);
    assert.deepEqual(config.devices, original.devices);
    assert.deepEqual(config.mixers, original.mixers);
    assert.deepEqual(config.filters, record.data.processing.filters);
    assert.equal(volume, -18);
    const writes = commands.filter((x) => typeof x === "object");
    assert.deepEqual(writes[0], { SetVolume: -60 });
    assert("SetConfigJson" in writes[1]);
    assert.deepEqual(writes[2], { SetVolume: -18 });
    assert.equal((await api("/api/startup-config")).body.dirty, false);
    config.filters.gain.parameters.gain = -5;
    assert.equal((await api("/api/startup-config")).body.dirty, true);
    for (const mode of ["specific", "last", "yaml"]) {
      const before = clone(config);
      assert((await api("/api/startup-config", { mode, configId: id })).ok);
      assert.deepEqual(config, before);
      assert.equal((await api("/api/startup-config")).body.mode, mode);
    }
    assert.equal((await api("/api/system-presets/delete", { id })).ok, false);
    for (const file of [signal, batch]) {
      store.atomicWrite(file, {});
      assert.equal((await api("/api/system-presets/apply", { id })).ok, false);
      assert.equal(
        (await api("/api/system-presets/capture", { name: "Blocked" })).ok,
        false,
      );
      fs.unlinkSync(file);
    }
    // Lock acquired before a temporary workflow creates its snapshot must
    // still block a queued system application once that workflow starts.
    let release;
    const pending = gate(async () => {
      await new Promise((r) => {
        release = r;
      });
      store.atomicWrite(signal, {});
    });
    await new Promise((r) => setImmediate(r));
    const attempt = api("/api/system-presets/apply", { id });
    release();
    await pending;
    assert.equal((await attempt).ok, false);
    fs.unlinkSync(signal);
    const spare = await api("/api/system-presets/capture", { name: "Spare" });
    assert(spare.ok);
    assert((await api("/api/system-presets/delete", { id: spare.body.id })).ok);
    const broken = await api("/api/system-presets/capture", { name: "Broken" });
    const metadata = fs.readFileSync(stateFile, "utf8");
    corrupt = true;
    assert.equal(
      (await api("/api/system-presets/apply", { id: broken.body.id })).ok,
      false,
    );
    assert.equal(volume, -60);
    assert.equal(fs.readFileSync(stateFile, "utf8"), metadata);
    corrupt = false;
    store.update(saved, (records) => {
      const r = records.find((r) => r.id === broken.body.id);
      r.data.processing.pipeline.push({ type: "Processor", name: "missing" });
    });
    assert.equal(
      (await api("/api/system-presets/apply", { id: broken.body.id })).ok,
      false,
    );
    assert(
      (
        await api("/api/startup-config", {
          mode: "specific",
          configId: broken.body.id,
        })
      ).ok,
    );
    assert.match(
      (await api("/api/startup-config")).body.resolutionError,
      /missing processor/,
    );
    store.update(saved, (records) =>
      records.splice(
        records.findIndex((r) => r.id === broken.body.id),
        1,
      ),
    );
    assert.match(
      (await api("/api/startup-config")).body.resolutionError,
      /no longer exists/,
    );
    assert.deepEqual(store.read(saved).slice(0, 2), unrelated);
    const legacy = store.read(saved).find((r) => r.id === id);
    delete legacy.data.masterVolume;
    store.update(saved, (records) => {
      records[records.findIndex((r) => r.id === id)] = legacy;
    });
    assert((await api("/api/system-presets/apply", { id })).ok);
    assert.equal(volume, -40);
    fs.chmodSync(saved, 0o640);
    store.update(saved, () => {});
    assert.equal(fs.statSync(saved).mode & 0o777, 0o640);
    const bytes = fs.readFileSync(saved);
    assert.throws(() =>
      store.update(saved, () => {
        throw Error("interrupted");
      }),
    );
    assert.deepEqual(fs.readFileSync(saved), bytes);
    console.log(
      "OK: System presets capture, mixed persistence, guarded apply/readback, Master, dirty state, startup, references, failure and cross-workflow ordering",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
