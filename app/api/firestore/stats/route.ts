import { firestoreApiError, readFirestoreStats } from "@/lib/firestore-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await readFirestoreStats();
    return Response.json(stats, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return firestoreApiError(error);
  }
}
