(function (data, host) {
  const freeze = Object.freeze, text = String;
  function job(path) {
    const ref = host.parsePath(path);
    return freeze({ start(options) { return host.jobStart(ref, options ?? {}); } });
  }
  function agent(path) {
    const ref = host.parsePath(path);
    return freeze({ chat(options) { return host.agentChat(ref, options ?? {}); } });
  }
  return freeze({
    event: data.event,
    run: data.run,
    jobs: freeze({ get: job }),
    agents: freeze({ get: agent }),
    state: freeze({
      get(key) { return host.stateGet(key); },
      put(key, value, options) { return host.statePut(key, value, options ?? {}); },
      delete(key, options) { return host.stateDelete(key, options ?? {}); },
    }),
    log: freeze({
      info(message, fields) { host.logInfo(text(message), fields ?? {}); },
      warn(message, fields) { host.logWarn(text(message), fields ?? {}); },
      error(message, fields) { host.logError(text(message), fields ?? {}); },
    }),
    sleep(ms) { return host.sleep(ms ?? null); },
  });
})
