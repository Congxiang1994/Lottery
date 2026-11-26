import { createApi } from "../common/http";

const api = createApi("/api/workbuddy");

export interface WBAccount {
  id: string;
  region: string;
  uid_masked: string;
  nickname: string;
  uin_masked: string;
  domain: string;
  enterprise: boolean;
  member: boolean;
  current: boolean;
  hidden: boolean;
  token_expiry: number;
  refresh_expiry: number;
  credits?: number;
  expiringSoon?: number;
  nearestExpiryMs?: number;
  checkin?: { status: string; todayCheckedIn?: boolean; streakDays?: number; credit?: number };
  probe?: { outcome: string; atMs: number; message?: string };
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface WBSettings {
  enabled: boolean;
  checkinSupported: boolean;
  autoCheckin: boolean;
  pollIntervalMs: number;
  targetModelId?: string;
}

export interface WBModel {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  maxTokens: number;
  creditMultiplier: number | null;
  supportsImages: boolean;
  efforts: string[];
  promo?: unknown;
}

export interface WBOverview {
  region: string;
  settings: WBSettings;
  accounts: WBAccount[];
  total: number;
  members: number;
  creditsTotal: number;
  serverTime: string;
}

export interface WBDiagnostics {
  region: string;
  upstreamBase: string;
  accountCount: number;
  memberCount: number;
  currentAccount: string;
  currentExpiry: number;
  settings: WBSettings;
  serverTime: string;
  recentErrors: string[];
}

export interface OAuthStart {
  loginId: string;
  verificationUri: string;
  expiresIn: number;
  region: string;
  hint: string;
}

export interface OAuthPoll {
  done: boolean;
  accountId?: string;
  nickname?: string;
  region?: string;
}

export const workbuddyApi = {
  session: () => api.get<{ valid: boolean }>("/session").then((d) => d.valid),
  auth: (password: string) => api.post<{ ok: boolean }>("/auth", { password }),
  logout: () => api.post<{ ok: boolean }>("/logout"),

  overview: (region: string) => api.get<WBOverview>("/overview", { region }),
  accounts: (region: string) => api.get<WBAccount[]>("/accounts", { region }),
  settings: (region: string) => api.get<WBSettings>("/settings", { region }),
  saveSettings: (region: string, data: Partial<WBSettings>) =>
    api.post<WBSettings>("/settings", { region, ...data }),

  oauthStart: (region: string, base?: string) =>
    api.post<OAuthStart>("/oauth/start", { region, base }),
  oauthPoll: (loginId: string) => api.post<OAuthPoll>("/oauth/poll", { loginId }),

  setMember: (id: string, member: boolean) =>
    api.post<{ ok: boolean }>(`/accounts/${encodeURIComponent(id)}/member`, { member }),
  setCurrent: (id: string) =>
    api.post<{ ok: boolean }>(`/accounts/${encodeURIComponent(id)}/current`),
  deleteAccount: (id: string) => api.del<{ ok: boolean }>(`/accounts/${encodeURIComponent(id)}`),
  refreshCred: (id: string) =>
    api.post<{ ok: boolean }>(`/accounts/${encodeURIComponent(id)}/refresh-cred`),
  accountCredits: (id: string) =>
    api.post<{ total: number; expiringSoon: number; nearestExpiryMs: number | null }>(
      `/accounts/${encodeURIComponent(id)}/credits`,
    ),
  accountCheckin: (id: string) =>
    api.post<{ status: string; credit?: number; streakDays?: number }>(
      `/accounts/${encodeURIComponent(id)}/checkin`,
    ),
  poolCheckin: (accountIds: string[]) =>
    api.post<{ rows: { accountId: string; status: string; message: string }[] }>("/pool/checkin", { accountIds }),
  poolCredits: (accountIds: string[]) =>
    api.post<{ rows: { accountId: string; ok: boolean; credits?: number; message?: string }[] }>(
      "/pool/credits",
      { accountIds },
    ),
  catalogRefresh: (region: string) =>
    api.post<{ models: WBModel[]; count: number; fetchedAt: string }>("/catalog/refresh", { region }),
  diagnostics: (region: string) => api.get<WBDiagnostics>("/diagnostics", { region }),
};
