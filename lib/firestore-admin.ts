import type {
  CompletedPlayerResult,
  FirestoreStats,
  SyncedLeaderboardEntry,
  SyncedPlayerRecord,
} from "@/lib/firestore-types";
import {
  firestoreDocumentId,
  normalizePlayerName,
  safeMatchDocumentId,
} from "@/lib/firestore-types";

type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
};

type FirestoreValue = Record<string, unknown>;
type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
};

export class FirestoreAdminError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "FirestoreAdminError";
    this.code = code;
    this.status = status;
  }
}

const PLAYERS_COLLECTION = "madrasaAlHankaPlayers";
const LEADERBOARD_COLLECTION = "madrasaAlHankaLeaderboard";
const MATCHES_COLLECTION = "madrasaAlHankaMatches";
const META_COLLECTION = "madrasaAlHankaMeta";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
let cachedAccessToken: { token: string; expiresAt: number; projectId: string } | null = null;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function runtimeEnvironment() {
  return (typeof process === "undefined" ? {} : process.env) as Record<
    string,
    string | undefined
  >;
}

async function readServiceAccount(): Promise<ServiceAccount> {
  const runtime = await runtimeEnvironment();
  const serialized = runtime.FIREBASE_SERVICE_ACCOUNT_KEY;
  let raw: Record<string, unknown> = {};

  if (serialized) {
    try {
      raw = asObject(JSON.parse(serialized));
    } catch {
      throw new FirestoreAdminError(
        "firestore-service-account-invalid",
        "FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON.",
        503,
      );
    }
  }

  const projectId =
    (typeof raw.project_id === "string" ? raw.project_id : "") ||
    runtime.FIREBASE_PROJECT_ID ||
    "";
  const clientEmail =
    (typeof raw.client_email === "string" ? raw.client_email : "") ||
    runtime.FIREBASE_CLIENT_EMAIL ||
    "";
  const privateKey =
    (typeof raw.private_key === "string" ? raw.private_key : "") ||
    runtime.FIREBASE_PRIVATE_KEY ||
    "";
  const privateKeyId =
    (typeof raw.private_key_id === "string" ? raw.private_key_id : "") || undefined;

  if (!projectId || !clientEmail || !privateKey) {
    throw new FirestoreAdminError(
      "firestore-admin-not-configured",
      "The Firebase service account is not configured.",
      503,
    );
  }

  if (runtime.FIREBASE_PROJECT_ID && runtime.FIREBASE_PROJECT_ID !== projectId) {
    throw new FirestoreAdminError(
      "firestore-project-mismatch",
      "The service account belongs to a different Firebase project.",
      503,
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    privateKeyId,
  };
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textToBase64Url(value: unknown) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function privateKeyBytes(privateKey: string) {
  const encoded = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  if (!encoded) {
    throw new FirestoreAdminError(
      "firestore-service-account-invalid",
      "The service account private key is empty.",
      503,
    );
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function createSignedAssertion(account: ServiceAccount) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header: Record<string, string> = { alg: "RS256", typ: "JWT" };
  if (account.privateKeyId) header.kid = account.privateKeyId;
  const claims = {
    iss: account.clientEmail,
    scope: DATASTORE_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const unsigned = textToBase64Url(header) + "." + textToBase64Url(claims);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(account.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return unsigned + "." + bytesToBase64Url(new Uint8Array(signature));
}

async function accessToken(account: ServiceAccount) {
  if (
    cachedAccessToken &&
    cachedAccessToken.projectId === account.projectId &&
    cachedAccessToken.expiresAt > Date.now() + 60000
  ) {
    return cachedAccessToken.token;
  }

  const assertion = await createSignedAssertion(account);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = asObject(await response.json().catch(() => ({})));
  const token = typeof payload.access_token === "string" ? payload.access_token : "";
  const expiresIn = asNumber(payload.expires_in) || 3600;

  if (!response.ok || !token) {
    throw new FirestoreAdminError(
      "firestore-token-failed",
      typeof payload.error_description === "string"
        ? payload.error_description
        : "Unable to obtain a Firestore access token.",
      503,
    );
  }

  cachedAccessToken = {
    token,
    projectId: account.projectId,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return token;
}

function firestoreBaseUrl(projectId: string) {
  return (
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId) +
    "/databases/(default)/documents"
  );
}

async function firestoreRequest(
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const account = await readServiceAccount();
  const token = await accessToken(account);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = asObject(await response.json().catch(() => ({})));

  if (!response.ok) {
    const remoteError = asObject(payload.error);
    const remoteStatus =
      typeof remoteError.status === "string" ? remoteError.status.toLowerCase() : "";
    throw new FirestoreAdminError(
      remoteStatus === "already_exists"
        ? "firestore-already-recorded"
        : "firestore-request-failed",
      typeof remoteError.message === "string"
        ? remoteError.message
        : "Firestore request failed.",
      response.status,
    );
  }
  return payload;
}

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: encodeFields(asObject(value)) } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return String(value.stringValue ?? "");
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue ?? 0);
  if ("doubleValue" in value) return Number(value.doubleValue ?? 0);
  if ("timestampValue" in value) return Date.parse(String(value.timestampValue ?? "")) || 0;
  if ("arrayValue" in value) {
    const arrayValue = asObject(value.arrayValue);
    const values = Array.isArray(arrayValue.values) ? arrayValue.values : [];
    return values.map((item) => fromFirestoreValue(asObject(item)));
  }
  if ("mapValue" in value) {
    const mapValue = asObject(value.mapValue);
    return decodeFields(asObject(mapValue.fields) as Record<string, FirestoreValue>);
  }
  return null;
}

function encodeFields(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, fieldValue]) => fieldValue !== undefined)
      .map(([key, fieldValue]) => [key, toFirestoreValue(fieldValue)]),
  );
}

function decodeFields(fields: Record<string, FirestoreValue>) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, fieldValue]) => [
      key,
      fromFirestoreValue(asObject(fieldValue)),
    ]),
  );
}

function documentName(projectId: string, collectionName: string, documentId: string) {
  return (
    "projects/" +
    projectId +
    "/databases/(default)/documents/" +
    collectionName +
    "/" +
    documentId
  );
}

async function listCollection(collectionName: string) {
  const account = await readServiceAccount();
  const documents: FirestoreDocument[] = [];
  let pageToken = "";

  do {
    const query = new URLSearchParams({ pageSize: "300" });
    if (pageToken) query.set("pageToken", pageToken);
    const payload = await firestoreRequest(
      firestoreBaseUrl(account.projectId) +
        "/" +
        collectionName +
        "?" +
        query.toString(),
    );
    const pageDocuments = Array.isArray(payload.documents) ? payload.documents : [];
    pageDocuments.forEach((item) => {
      const document = asObject(item);
      if (typeof document.name === "string") {
        documents.push({
          name: document.name,
          fields: asObject(document.fields) as Record<string, FirestoreValue>,
        });
      }
    });
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
  } while (pageToken);

  return documents;
}

async function commitWrites(writes: Array<Record<string, unknown>>) {
  if (writes.length === 0) return;
  const account = await readServiceAccount();
  await firestoreRequest(firestoreBaseUrl(account.projectId) + ":commit", {
    method: "POST",
    body: JSON.stringify({ writes }),
  });
}

function playerRecordFromDocument(document: FirestoreDocument) {
  const raw = decodeFields(document.fields || {});
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;
  return {
    id,
    name,
    points: asNumber(raw.points),
    correct: asNumber(raw.correct),
    wrong: asNumber(raw.wrong),
    games: asNumber(raw.games),
    wins: asNumber(raw.wins),
    losses: asNumber(raw.losses),
    updatedAt: asNumber(raw.updatedAt),
  } satisfies SyncedPlayerRecord;
}

function leaderboardEntryFromDocument(document: FirestoreDocument) {
  const raw = decodeFields(document.fields || {});
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  return {
    name,
    score: asNumber(raw.score),
    updatedAt: asNumber(raw.updatedAt),
  } satisfies SyncedLeaderboardEntry;
}

function updateWrite(
  projectId: string,
  collectionName: string,
  documentId: string,
  value: Record<string, unknown>,
) {
  return {
    update: {
      name: documentName(projectId, collectionName, documentId),
      fields: encodeFields(value),
    },
  };
}

export async function readFirestoreStats(): Promise<FirestoreStats> {
  const [playerDocuments, leaderboardDocuments] = await Promise.all([
    listCollection(PLAYERS_COLLECTION),
    listCollection(LEADERBOARD_COLLECTION),
  ]);
  const records = playerDocuments
    .map(playerRecordFromDocument)
    .filter((record): record is SyncedPlayerRecord => record !== null)
    .sort((first, second) => second.points - first.points || second.updatedAt - first.updatedAt);
  const leaderboard = leaderboardDocuments
    .map(leaderboardEntryFromDocument)
    .filter((entry): entry is SyncedLeaderboardEntry => entry !== null)
    .sort((first, second) => second.score - first.score || second.updatedAt - first.updatedAt)
    .slice(0, 10);
  return { records, leaderboard };
}

export async function recordCompletedMatchOnServer({
  matchId,
  players,
}: {
  matchId: string;
  players: [CompletedPlayerResult, CompletedPlayerResult];
}) {
  const account = await readServiceAccount();
  const playedAt = Date.now();
  const tied = players[0].score === players[1].score;
  const winnerIndex: 0 | 1 | null = tied ? null : players[0].score > players[1].score ? 0 : 1;
  const matchDocumentId = safeMatchDocumentId(matchId);
  const writes: Array<Record<string, unknown>> = [
    {
      ...updateWrite(account.projectId, MATCHES_COLLECTION, matchDocumentId, {
        playedAt,
        winner: winnerIndex === null ? null : players[winnerIndex].name.trim(),
        players: players.map((player) => ({
          name: player.name.trim(),
          score: player.score,
          correct: player.correctAnswers,
          wrong: player.wrongAnswers,
        })),
      }),
      currentDocument: { exists: false },
    },
  ];

  players.forEach((player, index) => {
    const id = normalizePlayerName(player.name);
    writes.push({
      update: {
        name: documentName(
          account.projectId,
          PLAYERS_COLLECTION,
          firestoreDocumentId(id),
        ),
        fields: encodeFields({ id, name: player.name.trim(), updatedAt: playedAt }),
      },
      updateMask: { fieldPaths: ["id", "name", "updatedAt"] },
      updateTransforms: [
        { fieldPath: "points", increment: toFirestoreValue(player.score) },
        { fieldPath: "correct", increment: toFirestoreValue(player.correctAnswers) },
        { fieldPath: "wrong", increment: toFirestoreValue(player.wrongAnswers) },
        { fieldPath: "games", increment: toFirestoreValue(1) },
        {
          fieldPath: "wins",
          increment: toFirestoreValue(winnerIndex === index ? 1 : 0),
        },
        {
          fieldPath: "losses",
          increment: toFirestoreValue(
            winnerIndex !== null && winnerIndex !== index ? 1 : 0,
          ),
        },
      ],
    });
  });

  if (winnerIndex !== null) {
    const winner = players[winnerIndex];
    writes.push(
      updateWrite(
        account.projectId,
        LEADERBOARD_COLLECTION,
        firestoreDocumentId(normalizePlayerName(winner.name)),
        { name: winner.name.trim(), score: winner.score, updatedAt: playedAt },
      ),
    );
  }

  try {
    await commitWrites(writes);
    return { duplicate: false };
  } catch (error) {
    if (error instanceof FirestoreAdminError && error.code === "firestore-already-recorded") {
      return { duplicate: true };
    }
    throw error;
  }
}

export async function deletePlayerOnServer(playerName: string) {
  const name = playerName.trim();
  if (!name) return;

  const account = await readServiceAccount();
  const documentId = firestoreDocumentId(normalizePlayerName(name));
  await commitWrites([
    { delete: documentName(account.projectId, PLAYERS_COLLECTION, documentId) },
    { delete: documentName(account.projectId, LEADERBOARD_COLLECTION, documentId) },
  ]);
}

export async function replacePlayerRecordsOnServer(records: SyncedPlayerRecord[]) {
  const account = await readServiceAccount();
  const existing = await listCollection(PLAYERS_COLLECTION);
  const desiredIds = new Set(
    records.map((record) =>
      firestoreDocumentId(record.id || normalizePlayerName(record.name)),
    ),
  );
  const writes: Array<Record<string, unknown>> = [];

  existing.forEach((document) => {
    const documentId = document.name.split("/").pop() || "";
    if (documentId && !desiredIds.has(documentId)) {
      writes.push({ delete: document.name });
    }
  });
  records.forEach((record) => {
    writes.push(
      updateWrite(
        account.projectId,
        PLAYERS_COLLECTION,
        firestoreDocumentId(record.id || normalizePlayerName(record.name)),
        record,
      ),
    );
  });

  for (let offset = 0; offset < writes.length; offset += 400) {
    await commitWrites(writes.slice(offset, offset + 400));
  }
}

export async function migrateLegacyStatsOnServer({
  records,
  leaderboard,
}: FirestoreStats) {
  const current = await readFirestoreStats();
  if (current.records.length > 0 || current.leaderboard.length > 0) {
    return { migrated: false };
  }

  const account = await readServiceAccount();
  const writes: Array<Record<string, unknown>> = [];
  records.forEach((record) => {
    writes.push(
      updateWrite(
        account.projectId,
        PLAYERS_COLLECTION,
        firestoreDocumentId(record.id || normalizePlayerName(record.name)),
        record,
      ),
    );
  });
  leaderboard.forEach((entry) => {
    writes.push(
      updateWrite(
        account.projectId,
        LEADERBOARD_COLLECTION,
        firestoreDocumentId(normalizePlayerName(entry.name)),
        entry,
      ),
    );
  });
  writes.push(
    updateWrite(account.projectId, META_COLLECTION, "legacyMigration", {
      migratedAt: Date.now(),
      schemaVersion: 2,
    }),
  );

  for (let offset = 0; offset < writes.length; offset += 400) {
    await commitWrites(writes.slice(offset, offset + 400));
  }
  return { migrated: true };
}

export function firestoreApiError(error: unknown) {
  if (error instanceof FirestoreAdminError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: "firestore-server-error" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
