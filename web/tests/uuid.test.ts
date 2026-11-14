import { afterEach, expect, it, vi } from "vitest";
import { uuid } from "@/lib/utils";

afterEach(() => vi.unstubAllGlobals());

it("uses the native UUID generator when available", () => {
  const randomUUID = vi.fn(() => "b7c70526-f48f-4329-a72e-bc966107f371");
  vi.stubGlobal("crypto", { randomUUID });
  expect(uuid()).toBe("b7c70526-f48f-4329-a72e-bc966107f371");
  expect(randomUUID).toHaveBeenCalledOnce();
});

it("generates UUID v4 command keys on HTTP origins without randomUUID", () => {
  const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto));
  vi.stubGlobal("crypto", { getRandomValues });
  const keys = Array.from({ length: 100 }, () => uuid());
  for (const key of keys)
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  expect(new Set(keys).size).toBe(keys.length);
  expect(getRandomValues).toHaveBeenCalledTimes(keys.length);
});
