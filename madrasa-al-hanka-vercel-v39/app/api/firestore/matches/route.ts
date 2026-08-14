import {
  firestoreApiError,
  recordCompletedMatchOnServer,
} from "@/lib/firestore-admin";
import type { CompletedPlayerResult } from "@/lib/firestore-types";

export const dynamic = "force-dynamic";

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
    const rawPlayers = Array.isArray(body.players) ? body.players : [];
    if (!matchId || rawPlayers.length !== 2) {
      return Response.json({ error: "invalid-match" }, { status: 400 });
    }

    const players = rawPlayers.map((value) => {
      const player = value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
      return {
        name: typeof player.name === "string" ? player.name.trim() : "",
        score: finiteNumber(player.score),
        correctAnswers: Math.max(0, finiteNumber(player.correctAnswers)),
        wrongAnswers: Math.max(0, finiteNumber(player.wrongAnswers)),
      } satisfies CompletedPlayerResult;
    }) as [CompletedPlayerResult, CompletedPlayerResult];
    if (!players[0].name || !players[1].name) {
      return Response.json({ error: "invalid-players" }, { status: 400 });
    }

    const result = await recordCompletedMatchOnServer({ matchId, players });
    return Response.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return firestoreApiError(error);
  }
}
