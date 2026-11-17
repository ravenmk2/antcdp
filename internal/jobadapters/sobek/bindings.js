(function (data, host) {
  const text = String;
  const state = Object.freeze({
    get(key, options) { return host.stateGet(key ?? null, options ?? null); },
    put(key, value, options) { return host.statePut(key ?? null, value, options ?? null); },
    delete(key, options) { return host.stateDelete(key ?? null, options ?? null); },
  });
  const log = Object.freeze({
    info(message, fields) { host.logInfo(text(message), fields ?? {}); },
    warn(message, fields) { host.logWarn(text(message), fields ?? {}); },
    error(message, fields) { host.logError(text(message), fields ?? {}); },
  });
  return Object.freeze({
    inputs: data.inputs,
    run: data.run,
    state,
    log,
    sleep(ms) { return host.sleep(ms ?? null); },
    resources: Object.freeze({ call(...args) { return host.resources(...args); } }),
    dingtalk: Object.freeze({ send(...args) { return host.dingtalk(...args); } }),
  });
})
