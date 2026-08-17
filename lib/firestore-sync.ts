import type {
  CompletedPlayerResult,
  FirestoreStats,
  SyncedLeaderboardEntry,
  SyncedPlayerRecord,
} from "@/lib/firestore-types";

export type {
  CompletedPlayerResult,
  SyncedLeaderboardEntry,
  SyncedPlayerRecord,
} from "@/lib/firestore-types";

type FirestoreCallbacks = {
  onRecords: (records: SyncedPlayerRecord[]) => void;
  onLeaderboard: (entries: SyncedLeaderboardEntry[]) => void;
  onConnected?: () => void;
  onError: (error: Error) => void;
};

class FirestoreSyncError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FirestoreSyncError";
    this.code = code;
  }
}

let refreshActiveSubscription: (() => void) | null = null;

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new FirestoreSyncError(
      typeof payload.error === "string" ? payload.error : "firestore-server-error",
      typeof payload.message === "string" ? payload.message : "Firestore request failed.",
    );
  }
  return payload as T;
}

export async function subscribeToFirestoreStats(callbacks: FirestoreCallbacks) {
  let stopped = false;
  let timer: number | undefined;
  let loading = false;

  const load = async () => {
    if (stopped || loading) return;
    if (timer) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    loading = true;
    try {
      const stats = await apiRequest<FirestoreStats>("/api/firestore/stats");
      if (stopped) return;
      callbacks.onRecords(stats.records);
      callbacks.onLeaderboard(stats.leaderboard);
      callbacks.onConnected?.();
    } catch (error) {
      if (!stopped) {
        callbacks.onError(error instanceof Error ? error : new Error("Firestore request failed."));
      }
    } finally {
      loading = false;
      if (!stopped) timer = window.setTimeout(() => void load(), 4000);
    }
  };

  refreshActiveSubscription = () => void load();
  await load();
  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
    if (refreshActiveSubscription) refreshActiveSubscription = null;
  };
}

function legacyRecords(value: string | null): SyncedPlayerRecord[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as SyncedPlayerRecord[]) : [];
  } catch {
    return [];
  }
}

function legacyLeaderboard(value: string | null): SyncedLeaderboardEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as SyncedLeaderboardEntry[]) : [];
  } catch {
    return [];
  }
}

export async function migrateLegacyStats(
  leaderboardStorageKey: string,
  recordsStorageKey: string,
) {
  const storedLeaderboard = window.localStorage.getItem(leaderboardStorageKey);
  const storedRecords = window.localStorage.getItem(recordsStorageKey);
  if (!storedLeaderboard && !storedRecords) return;

  await apiRequest("/api/firestore/migrate", {
    method: "POST",
    body: JSON.stringify({
      leaderboard: legacyLeaderboard(storedLeaderboard),
      records: legacyRecords(storedRecords),
    }),
  });
  window.localStorage.removeItem(leaderboardStorageKey);
  window.localStorage.removeItem(recordsStorageKey);
  refreshActiveSubscription?.();
}

export async function recordCompletedMatch({
  matchId,
  players,
}: {
  matchId: string;
  players: [CompletedPlayerResult, CompletedPlayerResult];
}) {
  await apiRequest("/api/firestore/matches", {
    method: "POST",
    body: JSON.stringify({ matchId, players }),
  });
  refreshActiveSubscription?.();
}

export async function deleteFirestorePlayer(player: string) {
  await apiRequest("/api/firestore/players", {
    method: "DELETE",
    body: JSON.stringify({ player }),
  });
  refreshActiveSubscription?.();
}

export async function replaceFirestorePlayerRecords(records: SyncedPlayerRecord[]) {
  await apiRequest("/api/firestore/players", {
    method: "PUT",
    body: JSON.stringify({ records }),
  });
  refreshActiveSubscription?.();
}
