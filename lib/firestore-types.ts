export type SyncedLeaderboardEntry = {
  name: string;
  score: number;
  updatedAt: number;
};

export type SyncedPlayerRecord = {
  id: string;
  name: string;
  points: number;
  correct: number;
  wrong: number;
  games: number;
  wins: number;
  losses: number;
  updatedAt: number;
};

export type CompletedPlayerResult = {
  name: string;
  score: number;
  correctAnswers: number;
  wrongAnswers: number;
};

export type FirestoreStats = {
  records: SyncedPlayerRecord[];
  leaderboard: SyncedLeaderboardEntry[];
};

export function normalizePlayerName(name: string) {
  return name.trim().toLocaleLowerCase("ar");
}

export function firestoreDocumentId(value: string) {
  const bytes = new TextEncoder().encode(value || "player");
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeMatchDocumentId(matchId: string) {
  return matchId.trim().replace(/[^a-zA-Z0-9_-]/g, "-") || crypto.randomUUID();
}
