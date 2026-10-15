// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
// Modified for my-task: no device-code sign-in during a run. A missing or dead session throws `auth_required`
// pointing at the `morning-desk login todo` command, which is the only place that starts a device-code sign-in
// (`todoAuth.login` in src/index.ts). The `sign_in` tool, the pending-sign-in state and `signIn()` were removed.
import type { AccountInfo, PublicClientApplication } from "@azure/msal-node";
import { AppError } from "../graph/errors";
import type { TokenProvider } from "../graph/client";
import type { Logger } from "../lib/logger";

/**
 * Auth for the running app:
 *  - a cached account → silent refresh on demand;
 *  - no account, or the silent refresh fails → `auth_required` with the login command. Nothing interactive starts here.
 *
 *   uninitialized ─ init w/ cached account ─▶ token_expired ─ silent refresh ok ─▶ authenticated
 *                                              (silent refresh fails → refresh_failed)
 */
export type AuthState = "uninitialized" | "token_expired" | "authenticated" | "refresh_failed";

export interface AuthStatus {
  state: AuthState;
  account?: { username: string; name?: string; homeAccountId: string; tenantId: string };
  tokenExpiresOn?: string;
  configError?: string;
}

/** What to tell the owner when a sign-in is needed. */
export const LOGIN_HINT = "Run `morning-desk login todo` in a terminal to sign in.";

const TOKEN_SKEW_MS = 60_000;

export class AuthManager implements TokenProvider {
  private state: AuthState = "uninitialized";
  private account: AccountInfo | null = null;
  private token: { value: string; expiresOn: Date } | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly pca: PublicClientApplication | null,
    private readonly scopes: string[],
    private readonly logger: Logger,
    private readonly now: () => number = () => Date.now(),
    private readonly configError?: string,
  ) {}

  async init(): Promise<void> {
    if (!this.pca) return;
    try {
      const accounts = await this.pca.getTokenCache().getAllAccounts();
      this.account = accounts[0] ?? null;
    } catch (err) {
      this.logger.warn("token cache unreadable — treating as signed out", { error: (err as Error).message });
      this.account = null;
    }
    this.state = this.account ? "token_expired" : "uninitialized";
  }

  status(): AuthStatus {
    const out: AuthStatus = { state: this.state };
    if (this.configError) out.configError = this.configError;
    if (this.account) out.account = { username: this.account.username, name: this.account.name, homeAccountId: this.account.homeAccountId, tenantId: this.account.tenantId };
    if (this.token) out.tokenExpiresOn = this.token.expiresOn.toISOString();
    return out;
  }

  accountId(): string {
    return this.account?.homeAccountId ?? "anonymous";
  }

  hasAccount(): boolean {
    return this.account != null;
  }

  async getAccessToken(): Promise<string> {
    if (this.configError || !this.pca) {
      throw new AppError("config_error", this.configError ?? "No Microsoft Entra client ID configured.");
    }
    if (this.token && this.token.expiresOn.getTime() - TOKEN_SKEW_MS > this.now()) {
      return this.token.value;
    }
    if (this.account) {
      try {
        if (this.refreshing) return await this.refreshing;
        this.refreshing = this.refreshSilently(this.pca, this.account).finally(() => {
          this.refreshing = null;
        });
        return await this.refreshing;
      } catch (err) {
        // The cached session is dead. Do not start a sign-in here: nobody is watching a scheduled run.
        this.account = null;
        this.state = "refresh_failed";
        this.logger.warn("silent refresh failed — a new sign-in is needed", { error: (err as Error).message });
        throw new AppError("auth_expired", `The saved Microsoft sign-in is no longer valid. ${LOGIN_HINT}`);
      }
    }
    throw new AppError("auth_required", `Not signed in to Microsoft To Do. ${LOGIN_HINT}`);
  }

  private async refreshSilently(pca: PublicClientApplication, account: AccountInfo): Promise<string> {
    const result = await pca.acquireTokenSilent({ account, scopes: this.scopes });
    if (!result?.accessToken) throw new Error("MSAL returned an empty token");
    this.adopt(result.account ?? account, result.accessToken, result.expiresOn);
    return result.accessToken;
  }

  /** Adopt a freshly acquired token (silent refresh). */
  adopt(account: AccountInfo, accessToken: string, expiresOn: Date | null): void {
    this.account = account;
    this.token = { value: accessToken, expiresOn: expiresOn ?? new Date(this.now() + 3_600_000) };
    this.state = "authenticated";
  }
}
