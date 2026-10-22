import { decideLocalLogout, type AccountView, type LocalLogoutReason } from '@meutreino/shared';
import { create } from 'zustand';
import {
  clearSessionSecrets,
  logoutCurrentDevice,
  logoutEveryDevice,
  onSessionRevoked,
  restoreSession,
} from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { cacheAccount, countPendingOperations, readCachedAccount } from '@/catalog/catalog-store';
import { deleteLocalDatabase, openLocalDatabase } from '@/db/local-database';
import {
  deleteLastUserId,
  readLastUserId,
  readRefreshToken,
  saveLastUserId,
} from '@/security/secure-store';
import {
  cachedOfflineAccount,
  localCleanupPlan,
  planSessionBootstrap,
} from '@/session/session-policy';
import { clearAccessToken } from '@/session/token-memory';
import { useThemeStore } from '@/state/theme-store';

export type SessionStatus = 'booting' | 'authenticated' | 'anonymous' | 'offline';
export type SignOutResult = 'signed_out' | 'needs_confirm';

type SignOutOptions = {
  discardPending?: boolean;
  reason?: LocalLogoutReason;
};

type SessionState = {
  status: SessionStatus;
  account: AccountView | null;
  bootstrap: () => Promise<void>;
  setAccount: (account: AccountView) => void;
  signOut: (options?: SignOutOptions) => Promise<SignOutResult>;
  signOutEverywhere: (options?: SignOutOptions) => Promise<SignOutResult>;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'booting',
  account: null,
  bootstrap: async () => {
    const refreshToken = await readRefreshToken();
    if (planSessionBootstrap(refreshToken) === 'signed_out') {
      clearAccessToken();
      set({ status: 'anonymous', account: null });
      return;
    }
    try {
      const account = await restoreSession();
      await rememberAccount(account);
      set({ status: 'authenticated', account });
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.status !== 401) {
        const userId = await readLastUserId();
        const account = userId ? await readCachedAccount(userId).catch(() => null) : null;
        set({
          status: 'offline',
          account: cachedOfflineAccount(refreshToken, userId, account, error),
        });
        return;
      }
      set({ status: 'anonymous', account: null });
    }
  },
  setAccount: (account) => {
    const previous = get().account?.id;
    void switchLocalUser(previous, account);
    set({ status: 'authenticated', account });
  },
  signOut: (options) => finishSignOut(get().account?.id, options, 'device'),
  signOutEverywhere: (options) => finishSignOut(get().account?.id, options, 'everywhere'),
}));

onSessionRevoked(() => {
  const userId = useSessionStore.getState().account?.id;
  void (async () => {
    if (userId) {
      const pending = await countPendingOperations(userId).catch(() => 0);
      const decision = decideLocalLogout({
        pendingCount: pending,
        discardPending: false,
        reason: 'revoked',
      });
      if (decision.action === 'delete') {
        await deleteLocalDatabase(userId).catch(() => undefined);
        await deleteLastUserId().catch(() => undefined);
      }
    }
    useSessionStore.setState({ status: 'anonymous', account: null });
  })();
});

async function finishSignOut(
  userId: string | undefined,
  options: SignOutOptions | undefined,
  scope: 'device' | 'everywhere',
): Promise<SignOutResult> {
  const reason = options?.reason ?? 'voluntary';
  const pending = userId ? await countPendingOperations(userId).catch(() => 0) : 0;
  const plan = userId
    ? localCleanupPlan(userId, {
        pendingCount: pending,
        discardPending: options?.discardPending ?? false,
        reason,
      })
    : { action: 'delete' as const, databaseName: null, secureKeys: ['meutreino.refresh_token'] };
  if (plan.action === 'confirm') {
    return 'needs_confirm';
  }
  if (reason === 'voluntary') {
    if (scope === 'everywhere') {
      await logoutEveryDevice().catch(() => undefined);
    } else {
      await logoutCurrentDevice().catch(() => undefined);
    }
  }
  if (plan.secureKeys.length > 0) {
    await clearSessionSecrets();
  }
  if (plan.databaseName && userId) {
    await deleteLocalDatabase(userId).catch(() => undefined);
    await deleteLastUserId().catch(() => undefined);
  }
  useSessionStore.setState({ status: 'anonymous', account: null });
  return 'signed_out';
}

async function rememberAccount(account: AccountView): Promise<void> {
  useThemeStore.getState().setPreference(account.profile.theme);
  await saveLastUserId(account.id);
  await openLocalDatabase(account.id);
  await cacheAccount(account.id, account);
}

async function switchLocalUser(previous: string | undefined, account: AccountView): Promise<void> {
  if (previous && previous !== account.id) {
    const pending = await countPendingOperations(previous).catch(() => 0);
    const decision = decideLocalLogout({
      pendingCount: pending,
      discardPending: false,
      reason: 'user_switch',
    });
    if (decision.action === 'delete') {
      await deleteLocalDatabase(previous).catch(() => undefined);
    }
  }
  await rememberAccount(account);
}
