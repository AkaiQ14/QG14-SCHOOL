import {
  firestoreApiError,
  migrateLegacyStatsOnServer,
} from "@/lib/firestore-admin";
import type {
  SyncedLeaderboardEntry,
  SyncedPlayerRecord,
} from "@/lib/firestore-types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const records = Array.isArray(body.records)
      ? (body.records as SyncedPlayerRecord[])
      : [];
    const leaderboard = Array.isArray(body.leaderboard)
      ? (body.leaderboard as SyncedLeaderboardEntry[])
      : [];
    const result = await migrateLegacyStatsOnServer({ records, leaderboard });
    return Response.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return firestoreApiError(error);
  }
}
