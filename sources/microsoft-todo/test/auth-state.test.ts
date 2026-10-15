// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
// Modified for my-task: a run never starts a device-code sign-in; a missing or dead session is `auth_required`/`auth_expired`
// with the `morning-desk login todo` hint.
import { describe, expect, it } from "vitest";
import { AuthManager } from "../src/auth/auth-state";
import { createLogger } from "../src/lib/logger";

const silent = createLogger("silent");

interface FakeAccount {
  username: string;
  name?: string;
  homeAccountId: string;
  tenantId: string;
}

const DEVICE_CODE = {
  userCode: "ABCD-EFGH",
  verificationUri: "https://microsoft.com/devicelogin",
  message: "To sign in, open https://microsoft.com/devicelogin and enter the code ABCD-EFGH",
  expiresIn: 900,
};

function fakePca(
  opts: {
    accounts?: FakeAccount[];
    silentResult?: () => Promise<unknown>;
    /** Resolves to an AuthenticationResult, rejects, or never settles (default: never — poll pending). */
    deviceCodeResult?: () => Promise<unknown>;
    onDeviceCodeCall?: () => void;
  } = {},
) {
  return {
    getTokenCache: () => ({ getAllAccounts: async () => opts.accounts ?? [] }),
    acquireTokenSilent: opts.silentResult ?? (async () => { throw new Error("no_silent_token"); }),
    acquireTokenByDeviceCode: async ({ deviceCodeCallback }: { deviceCodeCallback: (info: typeof DEVICE_CODE) => void; scopes: string[] }) => {
      opts.onDeviceCodeCall?.();
      deviceCodeCallback(DEVICE_CODE);
      return (opts.deviceCodeResult ?? (() => new Promise(() => {})))();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("AuthManager", () => {
  it("starts uninitialized with no cached account", async () => {
    const auth = new AuthManager(fakePca(), ["Tasks.ReadWrite"], silent);
    await auth.init();
    expect(auth.status().state).toBe("uninitialized");
    expect(auth.hasAccount()).toBe(false);
  });

  it("getAccessToken with no account does not start a sign-in: auth_required with the login command", async () => {
    let deviceCodeCalls = 0;
    const auth = new AuthManager(fakePca({ onDeviceCodeCall: () => { deviceCodeCalls += 1; } }), ["Tasks.ReadWrite"], silent);
    await auth.init();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "auth_required", message: expect.stringContaining("morning-desk login todo") });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "auth_required" });
    expect(deviceCodeCalls).toBe(0);
    expect(auth.status().state).toBe("uninitialized");
  });

  it("authenticates via a silent token when a cached account exists", async () => {
    const account: FakeAccount = { username: "u@example.com", name: "U", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({ accounts: [account], silentResult: async () => ({ accessToken: "tok-silent", expiresOn: new Date(Date.now() + 3_600_000), account }) }),
      ["Tasks.ReadWrite"],
      silent,
    );
    await auth.init();
    expect(auth.status().state).toBe("token_expired");
    expect(await auth.getAccessToken()).toBe("tok-silent");
    expect(auth.status().state).toBe("authenticated");
  });

  it("caches the access token until it nears expiry", async () => {
    let now = 10_000;
    let calls = 0;
    const account: FakeAccount = { username: "u@example.com", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({ accounts: [account], silentResult: async () => { calls += 1; return { accessToken: `tok-${calls}`, expiresOn: new Date(now + 3_600_000), account }; } }),
      ["Tasks.ReadWrite"],
      silent,
      () => now,
    );
    await auth.init();
    expect(await auth.getAccessToken()).toBe("tok-1");
    now += 60_000;
    expect(await auth.getAccessToken()).toBe("tok-1");
    expect(calls).toBe(1);
  });

  it("when the silent refresh fails, reports auth_expired with the login command and does not start a sign-in", async () => {
    let deviceCodeCalls = 0;
    const account: FakeAccount = { username: "u@example.com", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({ accounts: [account], silentResult: async () => { throw new Error("interaction_required"); }, onDeviceCodeCall: () => { deviceCodeCalls += 1; } }),
      ["Tasks.ReadWrite"],
      silent,
    );
    await auth.init();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "auth_expired", message: expect.stringContaining("morning-desk login todo") });
    expect(auth.status().state).toBe("refresh_failed");
    expect(deviceCodeCalls).toBe(0);
  });

  it("reports config_error and never signs in when constructed without a client id", async () => {
    const auth = new AuthManager(null, ["Tasks.ReadWrite"], silent, undefined, "no client id configured");
    await auth.init();
    expect(auth.status()).toMatchObject({ state: "uninitialized", configError: "no client id configured" });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "config_error" });
  });
});
