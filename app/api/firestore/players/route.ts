import {
  firestoreApiError,
  replacePlayerRecordsOnServer,
} from "@/lib/firestore-admin";
import type { SyncedPlayerRecord } from "@/lib/firestore-types";
import { normalizePlayerName } from "@/lib/firestore-types";

export const dynamic = "force-dynamic";

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const rawRecords = Array.isArray(body.records) ? body.records : [];
    const records = rawRecords
      .map((value) => {
        const raw = value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
        const name = typeof raw.name === "string" ? raw.name.trim() : "";
        if (!name) return null;
        return {
          id:
            typeof raw.id === "string" && raw.id.trim()
              ? raw.id.trim()
              : normalizePlayerName(name),
          name,
          points: finiteNumber(raw.points),
          correct: Math.max(0, finiteNumber(raw.correct)),
          wrong: Math.max(0, finiteNumber(raw.wrong)),
          games: Math.max(0, finiteNumber(raw.games)),
          wins: Math.max(0, finiteNumber(raw.wins)),
          losses: Math.max(0, finiteNumber(raw.losses)),
          updatedAt: finiteNumber(raw.updatedAt) || Date.now(),
        } satisfies SyncedPlayerRecord;
      })
      .filter((record): record is SyncedPlayerRecord => record !== null);

    await replacePlayerRecordsOnServer(records);
    return Response.json({ ok: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return firestoreApiError(error);
  }
}
