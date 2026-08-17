"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  recordCompletedMatch,
  replaceFirestorePlayerRecords,
  subscribeToFirestoreStats,
} from "@/lib/firestore-sync";

type Screen = "home" | "setup" | "categories" | "rapid" | "results";
type PlayerIndex = 0 | 1;
type AidKey = "double" | "wheel" | "disaster" | "steal" | "sensei" | "custom";
type QuestionType = "easy" | "normal" | "hard" | "dual" | "double";
type CategoryKey = "football" | "anime" | "general" | "movies" | "games";

type Aid = {
  key: AidKey;
  name: string;
  description: string;
  symbol: string;
  used: boolean;
};

type Player = {
  name: string;
  avatar: string;
  score: number;
  categoryScore: number;
  rapidScore: number;
  correctAnswers: number;
  wrongAnswers: number;
  aids: Aid[];
};

type SetupPlayer = {
  name: string;
  avatar: string;
  removedAid: Exclude<AidKey, "custom">;
  customName: string;
  customDescription: string;
};

type Question = {
  id: string;
  category: string;
  type: QuestionType;
  question?: string;
  answer?: string;
  hint?: string;
  choices?: string[];
  hardQuestion?: string;
  hardAnswer?: string;
  hardHint?: string;
  parts?: { question: string; answer: string }[];
};

type RapidQuestion = {
  id: string;
  question: string;
  answer: string;
};

type QuestionBank = {
  categories: Question[];
  rapid: RapidQuestion[];
};

type CurrentQuestion = {
  id: string;
  slotKey: string;
  mode: "normal" | "hard" | null;
  respondent: PlayerIndex;
  answerShown: boolean;
  hintVisible: boolean;
  doubleApplied: boolean;
};

type PendingReveal = {
  category: string;
  slot: number;
  questionId: string;
  player: PlayerIndex;
  doubleCommitted: boolean;
  stealCommitted: boolean;
};

type RapidState = {
  index: number;
  status: "waiting" | "claimed" | "fallback" | "resolved";
  claimant: PlayerIndex | null;
  answerShown: boolean;
  resultText: string;
};

type GameState = {
  screen: Screen;
  matchStarted: boolean;
  saveToLeaderboard: boolean;
  matchId: string | null;
  setup: [SetupPlayer, SetupPlayer];
  startingPlayer: PlayerIndex;
  players: [Player, Player];
  activePlayer: PlayerIndex;
  categoryDeck: Record<string, string[]>;
  rapidQuestionIds: string[];
  usedQuestionIds: string[];
  usedSlots: string[];
  pendingReveal: PendingReveal | null;
  currentQuestion: CurrentQuestion | null;
  rapid: RapidState;
  finalRecorded: boolean;
};

type QuestionHistory = {
  categories: string[];
  rapid: string[];
};

type LeaderboardEntry = {
  name: string;
  score: number;
  updatedAt: number;
};

type PlayerRecord = {
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

type RecordField = "points" | "correct" | "wrong";

const STORAGE_GAME = "madrasa-al-hanka-game-v2";
const STORAGE_QUESTION_HISTORY = "madrasa-al-hanka-question-history-v1";
const QUESTION_BANK_URL = "/data/questions.json";
const CATEGORY_QUESTION_TARGET = 16;
const CATEGORY_SLOT_COUNT = 5;
const RAPID_QUESTION_TARGET = 12;
const CATEGORY_QUESTION_TYPES: QuestionType[] = ["double", "normal", "normal", "hard", "dual"];

const AVATARS = [
  { id: "naruto", name: "ناروتو", src: "/avatars/avatar-naruto.jpg" },
  { id: "sasuke", name: "ساسكي", src: "/avatars/avatar-sasuke.jpg" },
  { id: "aizen", name: "آيزن", src: "/avatars/avatar-aizen.jpg" },
  { id: "akai", name: "أكاي", src: "/avatars/avatar-akai.jpg" },
  { id: "gojo", name: "غوجو", src: "/avatars/avatar-gojo.jpg" },
  { id: "itachi", name: "إيتاتشي", src: "/avatars/avatar-itachi.jpg" },
  { id: "killua", name: "كيلوا", src: "/avatars/avatar-killua.jpg" },
  { id: "luffy", name: "لوفي", src: "/avatars/avatar-luffy.jpg" },
  { id: "madara", name: "مادارا", src: "/avatars/avatar-madara.jpg" },
  { id: "shanks", name: "شانكس", src: "/avatars/avatar-shanks.jpg" },
  { id: "sukuna", name: "سوكونا", src: "/avatars/avatar-sukuna.jpg" },
  { id: "zaraki", name: "زاراكي", src: "/avatars/avatar-zaraki.jpg" },
  { id: "zoro", name: "زورو", src: "/avatars/avatar-zoro.jpg" },
] as const;

function validAvatarSource(value: string | undefined, fallback: string) {
  return value && AVATARS.some((avatar) => avatar.src === value) ? value : fallback;
}

const AID_DEFS: Omit<Aid, "used">[] = [
  {
    key: "double",
    name: "دبل 2×",
    description: "يضاعف نقاط الإجابة الصحيحة.",
    symbol: "×2",
  },
  {
    key: "wheel",
    name: "لف الدوامة",
    description: "لفة أو لفتان لاختيار سؤال عشوائي.",
    symbol: "↻",
  },
  {
    key: "disaster",
    name: "النكبة",
    description: "يرمي السؤال الحالي للمنافس.",
    symbol: "↝",
  },
  {
    key: "steal",
    name: "السرقة",
    description: "يحوّل السؤال الحالي إلى الخصم.",
    symbol: "⇄",
  },
  {
    key: "sensei",
    name: "السينسي",
    description: "يكشف تلميح الهوست للسؤال.",
    symbol: "師",
  },
];

const CATEGORIES: Array<{ name: string; className: CategoryKey }> = [
  { name: "كرة قدم", className: "football" },
  { name: "أنمي", className: "anime" },
  { name: "معلومات عامة", className: "general" },
  { name: "أفلام ومسلسلات", className: "movies" },
  { name: "ألعاب", className: "games" },
];

const emptyPlayer = (avatar: string): Player => ({
  name: "",
  avatar,
  score: 0,
  categoryScore: 0,
  rapidScore: 0,
  correctAnswers: 0,
  wrongAnswers: 0,
  aids: [],
});

const initialRapid = (): RapidState => ({
  index: 0,
  status: "waiting",
  claimant: null,
  answerShown: false,
  resultText: "",
});

const initialGame = (): GameState => ({
  screen: "home",
  matchStarted: false,
  saveToLeaderboard: false,
  matchId: null,
  setup: [
    {
      name: "",
      avatar: AVATARS[0].src,
      removedAid: "disaster",
      customName: "",
      customDescription: "",
    },
    {
      name: "",
      avatar: AVATARS[1].src,
      removedAid: "disaster",
      customName: "",
      customDescription: "",
    },
  ],
  startingPlayer: 0,
  players: [emptyPlayer(AVATARS[0].src), emptyPlayer(AVATARS[1].src)],
  activePlayer: 0,
  categoryDeck: {},
  rapidQuestionIds: [],
  usedQuestionIds: [],
  usedSlots: [],
  pendingReveal: null,
  currentQuestion: null,
  rapid: initialRapid(),
  finalRecorded: false,
});

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function normalizePlayerName(name: string) {
  return name.trim().toLocaleLowerCase("ar");
}

function createMatchId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function firestoreConnectionMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "firestore-admin-not-configured") {
    return "لم يتم ربط مفتاح خدمة Firestore بالخادم بعد.";
  }
  if (
    code === "firestore-service-account-invalid" ||
    code === "firestore-project-mismatch" ||
    code === "firestore-token-failed"
  ) {
    return "تعذر توثيق خادم Firestore. تحقق من مفتاح الخدمة.";
  }
  return "تعذر الاتصال بـ Firestore. لن تُحفظ النتائج حتى يعود الاتصال.";
}

function makeSlotKey(category: string, slot: number) {
  return category + "::" + slot;
}

function readSlotKey(key: string) {
  const separator = key.lastIndexOf("::");
  return {
    category: key.slice(0, separator),
    slot: Number(key.slice(separator + 2)),
  };
}

function shuffleList<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function buildCategoryDeck(questions: Question[], history: string[]) {
  let retainedHistory = history.filter((id) => questions.some((question) => question.id === id));
  const deck: Record<string, string[]> = {};

  CATEGORIES.forEach((category) => {
    const selected: string[] = [];
    const selectedIds = new Set<string>();

    CATEGORY_QUESTION_TYPES.forEach((type) => {
      const pool = questions.filter(
        (question) => question.category === category.name && question.type === type,
      );
      if (!pool.length) return;

      let available = pool.filter(
        (question) => !retainedHistory.includes(question.id) && !selectedIds.has(question.id),
      );

      if (!available.length) {
        const poolIds = new Set(pool.map((question) => question.id));
        retainedHistory = retainedHistory.filter((id) => !poolIds.has(id));
        available = pool.filter((question) => !selectedIds.has(question.id));
      }

      if (!available.length) return;
      const picked = shuffleList(available)[0];
      selected.push(picked.id);
      selectedIds.add(picked.id);
    });

    deck[category.name] = shuffleList(selected);
  });

  return { deck, retainedHistory };
}

function buildRapidDeck(questions: RapidQuestion[], history: string[]) {
  const validIds = new Set(questions.map((question) => question.id));
  let retainedHistory = history.filter((id) => validIds.has(id));
  let available = questions.filter((question) => !retainedHistory.includes(question.id));

  if (available.length < RAPID_QUESTION_TARGET) {
    const recentIds = new Set(retainedHistory.slice(-RAPID_QUESTION_TARGET));
    retainedHistory = [];
    available = questions.filter((question) => !recentIds.has(question.id));
    if (available.length < RAPID_QUESTION_TARGET) available = questions;
  }

  const ids = shuffleList(available)
    .slice(0, Math.min(RAPID_QUESTION_TARGET, available.length))
    .map((question) => question.id);
  return { ids, retainedHistory: [...retainedHistory, ...ids] };
}

function questionMeta(question: Question) {
  if (question.type === "easy") return { label: "سهل", points: "2", tone: "easy" };
  if (question.type === "normal") return { label: "عادي", points: "2", tone: "normal" };
  if (question.type === "hard") return { label: "صعب", points: "4", tone: "hard" };
  if (question.type === "dual") return { label: "صعب / عادي", points: "2 / 4", tone: "dual" };
  return { label: "سؤالين سهلين", points: "2 + 2", tone: "double" };
}

function questionRevealMeta(question: Question) {
  if (question.type === "easy") {
    return { title: "سؤال سهل", symbol: "س", description: "+2 عند الإجابة الصحيحة", tone: "easy" };
  }
  if (question.type === "normal") {
    return { title: "سؤال عادي", symbol: "ع", description: "+2 عند الإجابة الصحيحة", tone: "normal" };
  }
  if (question.type === "hard") {
    return { title: "سؤال صعب", symbol: "ص", description: "+4 للصحيح و−2 للخطأ", tone: "hard" };
  }
  if (question.type === "dual") {
    return { title: "سؤال صعب / عادي", symbol: "↔", description: "اختر النمط بعد الكشف", tone: "dual" };
  }
  return { title: "سؤالين سهلين", symbol: "2", description: "نقطتان لكل إجابة صحيحة", tone: "double" };
}

function AidGlyph({ type }: { type: AidKey }) {
  if (type === "double") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h5M6.5 4.5v5M14 6l6 12M20 6l-6 12" />
        <path d="M3.5 16.5c1.8-2 4.7-2.2 6.6-.4l-6.6 4h7" />
      </svg>
    );
  }
  if (type === "wheel") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.5 8.5A8 8 0 1 0 20 15" />
        <path d="M19.5 3.8v4.7h-4.7" />
        <circle cx="12" cy="12" r="2.3" />
        <path d="M12 4v5M12 15v5M4 12h5M15 12h5" />
      </svg>
    );
  }
  if (type === "disaster") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12h11" />
        <path d="m12 8 4 4-4 4" />
        <path d="m18 5 1 2.5L22 8l-2.5 1L19 12l-1-2.5L15 9l2.5-1z" />
      </svg>
    );
  }
  if (type === "steal") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 8h13l-3-3M19 16H6l3 3" />
        <path d="M18 5v6M6 13v6" />
      </svg>
    );
  }
  if (type === "sensei") {
    return <span className="sensei-image-glyph" aria-hidden="true" />;
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />
      <path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </svg>
  );
}

function AidIcon({ aid, compact = false }: { aid: Pick<Aid, "symbol" | "key">; compact?: boolean }) {
  return (
    <span className={cn("aid-icon", "aid-" + aid.key, compact && "is-compact")} aria-hidden="true">
      <AidGlyph type={aid.key} />
    </span>
  );
}

function CategoryIcon({ type }: { type: CategoryKey }) {
  if (type === "football") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m12 7 3 2.2-1.1 3.5h-3.8L9 9.2zM6.3 8.2 9 9.2M5.3 15l4.8-2.3M13.9 12.7l4.8 2.3M15 9.2l2.7-1M8.2 18.8l1.9-6.1M15.8 18.8l-1.9-6.1" />
      </svg>
    );
  }
  if (type === "anime") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5z" />
        <circle cx="12" cy="12" r="2.6" />
        <path d="M5.5 6.2 8 8M18.5 6.2 16 8" />
      </svg>
    );
  }
  if (type === "general") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 17h6M10 20h4" />
        <path d="M8.2 14.5A6 6 0 1 1 15.8 14.5C14.7 15.3 14 16 14 17h-4c0-1-.7-1.7-1.8-2.5z" />
        <path d="M12 3V1M4.2 5.2 2.8 3.8M19.8 5.2l1.4-1.4" />
      </svg>
    );
  }
  if (type === "movies") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9h16v11H4zM4 9l2-5h16l-2 5z" />
        <path d="m8 4-2 5M14 4l-2 5M20 4l-2 5M4 13h16" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 8h7.6c3 0 5.2 2.4 5.2 5.4V17a2.2 2.2 0 0 1-3.9 1.4L15.5 16h-7l-1.6 2.4A2.2 2.2 0 0 1 3 17v-3.6C3 10.4 5.2 8 8.2 8z" />
      <path d="M8 11v4M6 13h4" />
      <circle cx="16.5" cy="12" r=".8" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="14" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={cn("brand", small && "brand-small")}>
      <img className="brand-logo" src="/qg14-logo.png" alt="" aria-hidden="true" />
      <span>
        <strong>مدرسة الحنكة</strong>
        {!small && <small>المعرفة تحتاج جرأة</small>}
      </span>
    </div>
  );
}

export default function Home() {
  const [game, setGame] = useState<GameState>(initialGame);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [playerRecords, setPlayerRecords] = useState<PlayerRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [pendingAid, setPendingAid] = useState<{ player: PlayerIndex; aid: Aid } | null>(null);
  const [wheelPlayer, setWheelPlayer] = useState<PlayerIndex | null>(null);
  const [wheelResults, setWheelResults] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [setupError, setSetupError] = useState("");
  const [questionBank, setQuestionBank] = useState<QuestionBank | null>(null);
  const [questionHistory, setQuestionHistory] = useState<QuestionHistory>({ categories: [], rapid: [] });
  const [questionBankError, setQuestionBankError] = useState("");
  const [firestoreError, setFirestoreError] = useState("");
  const [openingSetup, setOpeningSetup] = useState(false);

  useEffect(() => {
    if (!openingSetup) return;
    const timer = window.setTimeout(() => {
      setGame((previous) => ({ ...previous, screen: "setup" }));
      setOpeningSetup(false);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [openingSetup]);

  useEffect(() => {
    const controller = new AbortController();
    const loadQuestionBank = async () => {
      try {
        const response = await fetch(QUESTION_BANK_URL, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("question-bank-request-failed");
        const data = (await response.json()) as QuestionBank;
        if (!Array.isArray(data.categories) || !data.categories.length || !Array.isArray(data.rapid) || !data.rapid.length) {
          throw new Error("question-bank-invalid");
        }
        setQuestionBank(data);
      } catch {
        if (controller.signal.aborted) return;
        setQuestionBankError("تعذر تحميل بنك الأسئلة من ملف JSON.");
      }
    };
    void loadQuestionBank();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      const storedGame = window.localStorage.getItem(STORAGE_GAME);
      if (storedGame) {
        const saved = JSON.parse(storedGame) as Partial<GameState>;
        const fallback = initialGame();
        const savedSlots = Array.isArray(saved.usedSlots) ? saved.usedSlots : [];
        const savedQuestionIds = Array.isArray(saved.usedQuestionIds) ? saved.usedQuestionIds : [];
        const progressIsConsistent = savedSlots.length === savedQuestionIds.length;
        const savedSetup = ([0, 1].map((index) => {
          const savedPlayer = saved.setup?.[index as PlayerIndex];
          const mergedPlayer = {
            ...fallback.setup[index as PlayerIndex],
            ...savedPlayer,
          };
          return {
            ...mergedPlayer,
            avatar: validAvatarSource(
              mergedPlayer.avatar,
              fallback.setup[index as PlayerIndex].avatar,
            ),
            customName: mergedPlayer.customName === "رأي الجمهور" ? "" : mergedPlayer.customName,
            customDescription:
              mergedPlayer.customDescription === "يحدد الجمهور المساعدة وطريقة تنفيذها."
                ? ""
                : mergedPlayer.customDescription,
          };
        }) as [SetupPlayer, SetupPlayer]);
        // Hydrate the saved match once when the client becomes available.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setGame({
          ...fallback,
          ...saved,
          setup: savedSetup.map((player) => ({ ...player, name: "" })) as [SetupPlayer, SetupPlayer],
          players: ([0, 1].map((index) => {
            const savedPlayer = saved.players?.[index as PlayerIndex];
            return {
              ...fallback.players[index as PlayerIndex],
              ...savedPlayer,
              avatar: validAvatarSource(
                savedPlayer?.avatar,
                fallback.players[index as PlayerIndex].avatar,
              ),
              correctAnswers:
                typeof savedPlayer?.correctAnswers === "number" ? savedPlayer.correctAnswers : 0,
              wrongAnswers:
                typeof savedPlayer?.wrongAnswers === "number" ? savedPlayer.wrongAnswers : 0,
            };
          }) as [Player, Player]),
          categoryDeck:
            saved.categoryDeck && typeof saved.categoryDeck === "object" ? saved.categoryDeck : {},
          rapidQuestionIds: Array.isArray(saved.rapidQuestionIds) ? saved.rapidQuestionIds : [],
          usedQuestionIds: progressIsConsistent ? savedQuestionIds : [],
          usedSlots: progressIsConsistent ? savedSlots : [],
          pendingReveal:
            saved.pendingReveal && "questionId" in saved.pendingReveal
              ? { ...saved.pendingReveal, stealCommitted: Boolean(saved.pendingReveal.stealCommitted) }
              : null,
          currentQuestion: saved.currentQuestion?.slotKey ? saved.currentQuestion : null,
        });
      }
      const storedHistory = window.localStorage.getItem(STORAGE_QUESTION_HISTORY);
      if (storedHistory) {
        const savedHistory = JSON.parse(storedHistory) as Partial<QuestionHistory>;
        setQuestionHistory({
          categories: Array.isArray(savedHistory.categories) ? savedHistory.categories : [],
          rapid: Array.isArray(savedHistory.rapid) ? savedHistory.rapid : [],
        });
      }
    } catch {
      window.localStorage.removeItem(STORAGE_GAME);
      window.localStorage.removeItem(STORAGE_QUESTION_HISTORY);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_GAME, JSON.stringify(game));
  }, [game, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_QUESTION_HISTORY, JSON.stringify(questionHistory));
  }, [hydrated, questionHistory]);

  useEffect(() => {
    if (!hydrated) return;
    let disposed = false;
    let stopFirestoreSync = () => {};

    const connectFirestore = async () => {
      try {
        const stop = await subscribeToFirestoreStats({
          onRecords: (records) => {
            if (!disposed) setPlayerRecords(records);
          },
          onLeaderboard: (entries) => {
            if (!disposed) setLeaderboard(entries);
          },
          onConnected: () => {
            if (!disposed) setFirestoreError("");
          },
          onError: (error) => {
            if (!disposed) {
              setFirestoreError(firestoreConnectionMessage(error));
            }
          },
        });
        if (disposed) {
          stop();
          return;
        }
        stopFirestoreSync = stop;
      } catch (error) {
        if (!disposed) {
          setFirestoreError(firestoreConnectionMessage(error));
        }
      }
    };

    void connectFirestore();
    return () => {
      disposed = true;
      stopFirestoreSync();
    };
  }, [hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (
      !hydrated ||
      game.screen !== "results" ||
      !game.saveToLeaderboard ||
      game.finalRecorded ||
      !game.matchId
    ) {
      return;
    }

    let disposed = false;
    let retryTimer: number | undefined;
    const completedMatchId = game.matchId;
    const completedPlayers = game.players.map((player) => ({
      name: player.name,
      score: player.score,
      correctAnswers: player.correctAnswers,
      wrongAnswers: player.wrongAnswers,
    })) as [
      { name: string; score: number; correctAnswers: number; wrongAnswers: number },
      { name: string; score: number; correctAnswers: number; wrongAnswers: number },
    ];

    const saveResult = async () => {
      try {
        await recordCompletedMatch({ matchId: completedMatchId, players: completedPlayers });
        if (disposed) return;
        setFirestoreError("");
        setToast("تم حفظ نتيجة المباراة في Firestore");
        setGame((previous) =>
          previous.matchId === completedMatchId
            ? { ...previous, finalRecorded: true }
            : previous,
        );
      } catch (error) {
        if (disposed) return;
        setFirestoreError(firestoreConnectionMessage(error));
        retryTimer = window.setTimeout(() => void saveResult(), 10000);
      }
    };

    void saveResult();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [
    game.finalRecorded,
    game.matchId,
    game.players,
    game.saveToLeaderboard,
    game.screen,
    hydrated,
  ]);

  const currentQuestion = useMemo(
    () =>
      game.currentQuestion && questionBank
        ? questionBank.categories.find((question) => question.id === game.currentQuestion?.id) ?? null
        : null,
    [game.currentQuestion, questionBank],
  );

  const rapidQuestions = useMemo(() => {
    if (!questionBank) return [];
    const selected = game.rapidQuestionIds
      .map((id) => questionBank.rapid.find((question) => question.id === id))
      .filter((question): question is RapidQuestion => Boolean(question));
    return selected.length > 0
      ? selected
      : questionBank.rapid.slice(0, Math.min(RAPID_QUESTION_TARGET, questionBank.rapid.length));
  }, [game.rapidQuestionIds, questionBank]);

  const updateSetup = (player: PlayerIndex, patch: Partial<SetupPlayer>) => {
    setGame((previous) => {
      const setup = [...previous.setup] as [SetupPlayer, SetupPlayer];
      setup[player] = { ...setup[player], ...patch };
      return { ...previous, setup };
    });
    setSetupError("");
  };

  const updateSharedAid = (
    patch: Partial<Pick<SetupPlayer, "customName" | "customDescription">>,
  ) => {
    setGame((previous) => ({
      ...previous,
      setup: previous.setup.map((player) => ({ ...player, ...patch })) as [SetupPlayer, SetupPlayer],
    }));
    setSetupError("");
  };

  const startMatch = () => {
    if (!questionBank) {
      setSetupError(
        questionBankError
          ? "تعذر تحميل ملف الأسئلة. أعد تحميل الصفحة ثم حاول مرة أخرى."
          : "يتم تجهيز ملف الأسئلة الآن، حاول بعد لحظة.",
      );
      return;
    }
    const names = game.setup.map((player) => player.name.trim());
    if (!names[0] || !names[1]) {
      setSetupError("اكتب اسمَي اللاعبين أولًا.");
      return;
    }
    if (names[0].toLocaleLowerCase("ar") === names[1].toLocaleLowerCase("ar")) {
      setSetupError("استخدم اسمًا مختلفًا لكل لاعب.");
      return;
    }
    const audienceAidName = game.setup[0].customName.trim();
    const audienceAidDescription = game.setup[0].customDescription.trim();
    if (!audienceAidName) {
      setSetupError("اكتب اسم وسيلة الجمهور البديلة.");
      return;
    }

    const players = game.setup.map((setupPlayer, index) => {
      const regularAids = AID_DEFS.filter((aid) => aid.key !== setupPlayer.removedAid).map((aid) => ({
        ...aid,
        used: false,
      }));
      const customAid: Aid = {
        key: "custom",
        name: audienceAidName,
        description: audienceAidDescription || "ينفذها الهوست وفق القاعدة المتفق عليها.",
        symbol: "✦",
        used: false,
      };
      return {
        name: names[index],
        avatar: setupPlayer.avatar,
        score: 0,
        categoryScore: 0,
        rapidScore: 0,
        correctAnswers: 0,
        wrongAnswers: 0,
        aids: [...regularAids, customAid],
      };
    }) as [Player, Player];

    const categorySelection = buildCategoryDeck(questionBank.categories, questionHistory.categories);
    const rapidSelection = buildRapidDeck(questionBank.rapid, questionHistory.rapid);
    setQuestionHistory({
      categories: categorySelection.retainedHistory,
      rapid: rapidSelection.retainedHistory,
    });

    setGame((previous) => ({
      ...previous,
      screen: "categories",
      matchStarted: true,
      matchId: createMatchId(),
      players,
      activePlayer: previous.startingPlayer,
      categoryDeck: categorySelection.deck,
      rapidQuestionIds: rapidSelection.ids,
      usedQuestionIds: [],
      usedSlots: [],
      pendingReveal: null,
      currentQuestion: null,
      rapid: initialRapid(),
      finalRecorded: false,
    }));
  };

  const adjustScore = (player: PlayerIndex, amount: number) => {
    setGame((previous) => {
      const players = [...previous.players] as [Player, Player];
      const section = previous.screen === "rapid" ? "rapidScore" : "categoryScore";
      players[player] = {
        ...players[player],
        score: players[player].score + amount,
        [section]: players[player][section] + amount,
      };
      return { ...previous, players };
    });
    setToast(amount > 0 ? "تمت إضافة نقطة تصحيح." : "تم خصم نقطة تصحيح.");
  };

  const prepareQuestionSlot = (category: string, slot: number) => {
    const selectedSlot = makeSlotKey(category, slot);
    if (game.usedSlots.includes(selectedSlot)) return;
    const assignedQuestionId = game.categoryDeck[category]?.[slot - 1];
    const categoryQuestions = questionBank?.categories.filter((question) => question.category === category) ?? [];
    const unseenQuestions = categoryQuestions.filter(
      (question) =>
        !game.usedQuestionIds.includes(question.id) &&
        !questionHistory.categories.includes(question.id),
    );
    const unusedQuestions = categoryQuestions.filter(
      (question) => !game.usedQuestionIds.includes(question.id),
    );
    const fallbackPool = unseenQuestions.length > 0
      ? unseenQuestions
      : unusedQuestions.length > 0
        ? unusedQuestions
        : categoryQuestions;
    const question =
      categoryQuestions.find((item) => item.id === assignedQuestionId) ??
      shuffleList(fallbackPool)[0];
    if (!question) return;
    setWheelResults([]);
    setQuestionHistory((previous) =>
      previous.categories.includes(question.id)
        ? previous
        : { ...previous, categories: [...previous.categories, question.id] },
    );
    setGame((previous) => ({
      ...previous,
      pendingReveal: {
        category,
        slot,
        questionId: question.id,
        player: previous.activePlayer,
        doubleCommitted: false,
        stealCommitted: false,
      },
    }));
  };

  const revealPendingQuestion = () => {
    if (!game.pendingReveal) return;
    const pending = game.pendingReveal;
    const question = questionBank?.categories.find((item) => item.id === pending.questionId);
    if (!question) return;
    setGame((previous) => ({
      ...previous,
      pendingReveal: null,
      currentQuestion: {
        id: question.id,
        slotKey: makeSlotKey(pending.category, pending.slot),
        mode: question.type === "dual" ? null : question.type === "hard" ? "hard" : "normal",
        respondent: pending.player,
        answerShown: false,
        hintVisible: false,
        doubleApplied: pending.doubleCommitted,
      },
    }));
  };

  const setQuestionMode = (mode: "normal" | "hard") => {
    setGame((previous) => ({
      ...previous,
      currentQuestion: previous.currentQuestion ? { ...previous.currentQuestion, mode } : null,
    }));
  };

  const scoreCategoryQuestion = (rawPoints: number) => {
    if (!game.currentQuestion) return;
    const respondent = game.currentQuestion.respondent;
    const awarded = rawPoints > 0 && game.currentQuestion.doubleApplied ? rawPoints * 2 : rawPoints;
    const questionId = game.currentQuestion.id;
    const selectedSlot = game.currentQuestion.slotKey;
    const selectedQuestion = questionBank?.categories.find((question) => question.id === questionId);
    const correctDelta = selectedQuestion?.type === "double" ? Math.max(0, rawPoints / 2) : rawPoints > 0 ? 1 : 0;
    const wrongDelta = selectedQuestion?.type === "double" ? Math.max(0, 2 - correctDelta) : rawPoints <= 0 ? 1 : 0;

    setGame((previous) => {
      const players = [...previous.players] as [Player, Player];
      players[respondent] = {
        ...players[respondent],
        score: players[respondent].score + awarded,
        categoryScore: players[respondent].categoryScore + awarded,
        correctAnswers: players[respondent].correctAnswers + correctDelta,
        wrongAnswers: players[respondent].wrongAnswers + wrongDelta,
      };
      return {
        ...previous,
        players,
        usedQuestionIds: [...previous.usedQuestionIds, questionId],
        usedSlots: [...previous.usedSlots, selectedSlot],
        currentQuestion: null,
        activePlayer: (previous.activePlayer === 0 ? 1 : 0) as PlayerIndex,
      };
    });
    setToast(
      awarded > 0
        ? "إجابة صحيحة: +" + awarded + " لـ " + game.players[respondent].name
        : awarded < 0
          ? "إجابة خاطئة: " + awarded + " لـ " + game.players[respondent].name
          : "لا نقاط لهذه الإجابة.",
    );
  };

  const aidAllowed = (player: PlayerIndex, aid: Aid) => {
    if (aid.used) return false;
    if (aid.key === "double") {
      return Boolean(
        game.pendingReveal &&
          !game.pendingReveal.doubleCommitted &&
          game.pendingReveal.player === player &&
          !game.currentQuestion,
      );
    }
    if (aid.key === "steal" && game.pendingReveal) {
      return Boolean(
        !game.pendingReveal.stealCommitted &&
          !game.pendingReveal.doubleCommitted &&
          game.pendingReveal.player === player &&
          !game.currentQuestion,
      );
    }
    if (aid.key === "wheel") {
      return Boolean(
        game.currentQuestion &&
          !game.pendingReveal &&
          game.currentQuestion.respondent === player,
      );
    }
    if (!game.currentQuestion) return false;
    if (aid.key === "steal") return game.currentQuestion.respondent !== player;
    if (aid.key === "custom") return game.currentQuestion.respondent === player;
    return game.currentQuestion.respondent === player;
  };

  const requestAid = (player: PlayerIndex, aid: Aid) => {
    if (!aidAllowed(player, aid)) return;
    setPendingAid({ player, aid });
  };

  const confirmAid = () => {
    if (!pendingAid) return;
    const { player, aid } = pendingAid;
    if (aid.key === "wheel") {
      setWheelPlayer(player);
      setPendingAid(null);
      return;
    }
    setGame((previous) => {
      const players = [...previous.players] as [Player, Player];
      players[player] = {
        ...players[player],
        aids: players[player].aids.map((item) => (item.key === aid.key ? { ...item, used: true } : item)),
      };
      const current = previous.currentQuestion ? { ...previous.currentQuestion } : null;
      const pendingReveal = previous.pendingReveal ? { ...previous.pendingReveal } : null;
      if (aid.key === "double" && pendingReveal) pendingReveal.doubleCommitted = true;
      if (aid.key === "steal" && pendingReveal) {
        pendingReveal.player = (player === 0 ? 1 : 0) as PlayerIndex;
        pendingReveal.stealCommitted = true;
      }
      if (current) {
        if (aid.key === "disaster") current.respondent = (player === 0 ? 1 : 0) as PlayerIndex;
        if (aid.key === "steal") current.respondent = player;
        if (aid.key === "sensei") current.hintVisible = true;
      }
      return { ...previous, players, currentQuestion: current, pendingReveal };
    });
    setToast("استخدم " + game.players[player].name + " وسيلة «" + aid.name + "».");
    setPendingAid(null);
  };

  const spinWheel = (spins: 1 | 2) => {
    if (wheelPlayer === null) return;
    const unusedSlots = CATEGORIES.flatMap((category) =>
      Array.from({ length: CATEGORY_SLOT_COUNT }, (_, index) => makeSlotKey(category.name, index + 1)),
    ).filter((slot) => !game.usedSlots.includes(slot));
    const replacementSlots = unusedSlots.filter((slot) => slot !== game.currentQuestion?.slotKey);
    const available = replacementSlots.length > 0 ? replacementSlots : unusedSlots;
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const results = shuffled.slice(0, Math.min(spins, shuffled.length));
    setGame((previous) => {
      const players = [...previous.players] as [Player, Player];
      players[wheelPlayer] = {
        ...players[wheelPlayer],
        aids: players[wheelPlayer].aids.map((aid) => (aid.key === "wheel" ? { ...aid, used: true } : aid)),
      };
      return { ...previous, players, currentQuestion: null };
    });
    setWheelResults(results);
    setToast("دارت الدوامة " + (spins === 1 ? "لفة واحدة." : "لفتين."));
    setWheelPlayer(null);
  };

  const moveToRapid = () => {
    if (
      !questionBank ||
      game.usedSlots.length < Math.min(CATEGORY_QUESTION_TARGET, questionBank.categories.length)
    ) return;
    setGame((previous) => ({
      ...previous,
      screen: "rapid",
      pendingReveal: null,
      currentQuestion: null,
      rapid: initialRapid(),
    }));
  };

  const claimRapid = (player: PlayerIndex) => {
    if (game.rapid.status !== "waiting") return;
    setGame((previous) => ({
      ...previous,
      rapid: { ...previous.rapid, status: "claimed", claimant: player, resultText: "" },
    }));
  };

  const rapidFirstWrong = () => {
    setGame((previous) => {
      const players = [...previous.players] as [Player, Player];
      if (previous.rapid.claimant !== null) {
        const claimant = previous.rapid.claimant;
        players[claimant] = {
          ...players[claimant],
          wrongAnswers: players[claimant].wrongAnswers + 1,
        };
      }
      return {
        ...previous,
        players,
        rapid: { ...previous.rapid, status: "fallback", answerShown: false, resultText: "" },
      };
    });
  };

  const resolveRapid = (
    scoringPlayer: PlayerIndex | null,
    points: number,
    answeredBy: PlayerIndex | null,
    correct: boolean,
  ) => {
    setGame((previous) => {
      const players = [...previous.players] as [Player, Player];
      if (scoringPlayer !== null && points > 0) {
        players[scoringPlayer] = {
          ...players[scoringPlayer],
          score: players[scoringPlayer].score + points,
          rapidScore: players[scoringPlayer].rapidScore + points,
        };
      }
      if (answeredBy !== null) {
        players[answeredBy] = {
          ...players[answeredBy],
          correctAnswers: players[answeredBy].correctAnswers + (correct ? 1 : 0),
          wrongAnswers: players[answeredBy].wrongAnswers + (correct ? 0 : 1),
        };
      }
      const resultText =
        scoringPlayer !== null && points > 0
          ? "+" + points + " لـ " + players[scoringPlayer].name
          : "انتهى السؤال بلا نقاط";
      return {
        ...previous,
        players,
        rapid: { ...previous.rapid, status: "resolved", answerShown: true, resultText },
      };
    });
  };

  const nextRapid = () => {
    setGame((previous) => ({
      ...previous,
      rapid: {
        ...initialRapid(),
        index: Math.min(previous.rapid.index + 1, (questionBank?.rapid.length ?? 1) - 1),
      },
    }));
  };

  const finishGame = () => {
    const completedMatchId = game.matchId || createMatchId();
    setGame((previous) => ({
      ...previous,
      matchId: previous.matchId || completedMatchId,
      screen: "results",
      finalRecorded: false,
    }));
  };

  const savePlayerRecords = (records: PlayerRecord[]) => {
    const sortedRecords = [...records].sort(
      (first, second) => second.points - first.points || second.updatedAt - first.updatedAt,
    );
    void replaceFirestorePlayerRecords(sortedRecords)
      .then(() => {
        setFirestoreError("");
        setToast("تم حفظ تغييرات لوحة التحكم في Firestore");
      })
      .catch((error) => {
        setFirestoreError(firestoreConnectionMessage(error));
      });
  };

  const resetToSetup = () => {
    const next = initialGame();
    next.screen = "setup";
    setSetupError("");
    setGame(next);
  };

  const openNewMatchSetup = () => {
    setGame((previous) => {
      const shouldResetFinishedMatch =
        previous.finalRecorded || Boolean(previous.matchId && !previous.matchStarted);
      const next = shouldResetFinishedMatch
        ? { ...initialGame(), saveToLeaderboard: previous.saveToLeaderboard }
        : previous;
      return {
        ...next,
        setup: next.setup.map((player) => ({ ...player, name: "" })) as [SetupPlayer, SetupPlayer],
      };
    });
    setSetupError("");
    setOpeningSetup(true);
  };

  const leaveSetup = () => {
    setSetupError("");
    setGame((previous) => ({
      ...previous,
      screen: "home",
      setup: previous.setup.map((player) => ({ ...player, name: "" })) as [SetupPlayer, SetupPlayer],
    }));
  };

  const abandonMatch = () => {
    if (game.matchStarted && game.screen !== "results") {
      const accepted = window.confirm("سيتم حذف تقدم المباراة الحالية. هل تريد المتابعة؟");
      if (!accepted) return;
    }
    setGame(initialGame());
  };

  const visibleScreen =
    !questionBank && (game.screen === "categories" || game.screen === "rapid")
      ? "home"
      : game.screen;

  return (
    <main className="site-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      {(questionBankError || firestoreError) && (
        <div className="data-warning" role="status">{questionBankError || firestoreError}</div>
      )}

      {visibleScreen === "home" && (
        <HomeScreen
          hasMatch={game.matchStarted}
          isStarting={openingSetup}
          saveToLeaderboard={game.saveToLeaderboard}
          onToggleLeaderboardSave={() =>
            setGame((previous) => ({
              ...previous,
              saveToLeaderboard: !previous.saveToLeaderboard,
            }))
          }
          onStart={openNewMatchSetup}
          onResume={() => {
            if (!questionBank) {
              setToast("يتم تجهيز ملف الأسئلة الآن.");
              return;
            }
            setGame((previous) => ({
              ...previous,
              screen:
                previous.usedSlots.length < Math.min(CATEGORY_QUESTION_TARGET, questionBank.categories.length)
                  ? "categories"
                  : "rapid",
            }));
          }}
          onLeaderboard={() => setLeaderboardOpen(true)}
          onAdmin={() => setAdminOpen(true)}
          onBottom={() => setBottomOpen(true)}
        />
      )}

      {visibleScreen === "setup" && (
        <SetupScreen
          game={game}
          error={setupError}
          onUpdate={updateSetup}
          onSharedAidUpdate={updateSharedAid}
          onStarter={(player) => setGame((previous) => ({ ...previous, startingPlayer: player }))}
          onStart={startMatch}
          onBack={leaveSetup}
        />
      )}

      {visibleScreen === "categories" && questionBank && (
        <CategoriesScreen
          game={game}
          questions={questionBank.categories}
          onPrepareQuestion={prepareQuestionSlot}
          onAdjust={adjustScore}
          onNext={moveToRapid}
          onHome={abandonMatch}
        />
      )}

      {visibleScreen === "rapid" && questionBank && (
        <RapidScreen
          game={game}
          questions={rapidQuestions}
          onClaim={claimRapid}
          onFirstCorrect={() =>
            game.rapid.claimant !== null &&
            resolveRapid(game.rapid.claimant, 2, game.rapid.claimant, true)
          }
          onFirstWrong={rapidFirstWrong}
          onFallbackCorrect={() => {
            if (game.rapid.claimant === null) return;
            const fallback = (game.rapid.claimant === 0 ? 1 : 0) as PlayerIndex;
            resolveRapid(fallback, 1, fallback, true);
          }}
          onFallbackWrong={() => {
            if (game.rapid.claimant === null) return;
            const fallback = (game.rapid.claimant === 0 ? 1 : 0) as PlayerIndex;
            resolveRapid(null, 0, fallback, false);
          }}
          onReveal={() =>
            setGame((previous) => ({
              ...previous,
              rapid: { ...previous.rapid, answerShown: !previous.rapid.answerShown },
            }))
          }
          onNext={nextRapid}
          onFinish={finishGame}
          onAdjust={adjustScore}
          onHome={abandonMatch}
        />
      )}

      {visibleScreen === "results" && (
        <ResultsScreen
          players={game.players}
          onRematch={resetToSetup}
          onHome={() => setGame(initialGame())}
          onLeaderboard={() => setLeaderboardOpen(true)}
        />
      )}

      {currentQuestion && game.currentQuestion && (
        <QuestionModal
          question={currentQuestion}
          current={game.currentQuestion}
          players={game.players}
          onMode={setQuestionMode}
          onRespondent={(respondent) =>
            setGame((previous) => ({
              ...previous,
              currentQuestion: previous.currentQuestion
                ? { ...previous.currentQuestion, respondent }
                : null,
            }))
          }
          onReveal={() =>
            setGame((previous) => ({
              ...previous,
              currentQuestion: previous.currentQuestion
                ? { ...previous.currentQuestion, answerShown: !previous.currentQuestion.answerShown }
                : null,
            }))
          }
          onAid={requestAid}
          aidAllowed={aidAllowed}
          onScore={scoreCategoryQuestion}
          onClose={() => setGame((previous) => ({ ...previous, currentQuestion: null }))}
        />
      )}

      {game.pendingReveal && questionBank && (
        <PreRevealModal
          pending={game.pendingReveal}
          player={game.players[game.pendingReveal.player]}
          questions={questionBank.categories}
          onAid={(aid) => requestAid(game.pendingReveal!.player, aid)}
          onReveal={revealPendingQuestion}
          onClose={() => setGame((previous) => ({ ...previous, pendingReveal: null }))}
        />
      )}

      {pendingAid && (
        <ConfirmAidModal
          playerName={game.players[pendingAid.player].name}
          aid={pendingAid.aid}
          onConfirm={confirmAid}
          onClose={() => setPendingAid(null)}
        />
      )}

      {wheelPlayer !== null && (
        <WheelModal
          playerName={game.players[wheelPlayer].name}
          onSpin={spinWheel}
          onClose={() => setWheelPlayer(null)}
        />
      )}

      {wheelResults.length > 0 && (
        <WheelResultModal
          ids={wheelResults}
          onChoose={(key) => {
            const selected = readSlotKey(key);
            prepareQuestionSlot(selected.category, selected.slot);
          }}
          onClose={() => setWheelResults([])}
        />
      )}

      {leaderboardOpen && (
        <LeaderboardModal
          entries={leaderboard}
          records={playerRecords}
          onClose={() => setLeaderboardOpen(false)}
        />
      )}

      {adminOpen && (
        <AdminPanelModal
          records={playerRecords}
          onSave={savePlayerRecords}
          onClose={() => setAdminOpen(false)}
        />
      )}

      {bottomOpen && (
        <BottomLeaderboardModal records={playerRecords} onClose={() => setBottomOpen(false)} />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
    </main>
  );
}

function HomeScreen({
  hasMatch,
  isStarting,
  saveToLeaderboard,
  onToggleLeaderboardSave,
  onStart,
  onResume,
  onLeaderboard,
  onAdmin,
  onBottom,
}: {
  hasMatch: boolean;
  isStarting: boolean;
  saveToLeaderboard: boolean;
  onToggleLeaderboardSave: () => void;
  onStart: () => void;
  onResume: () => void;
  onLeaderboard: () => void;
  onAdmin: () => void;
  onBottom: () => void;
}) {
  return (
    <section className="home-screen home-menu-page page">
      <div className="home-menu-shell">
        <header className="home-menu-head">
          <span className="home-menu-kicker">KNOWLEDGE BATTLE SYSTEM</span>
          <h1>مدرسة <span>الحنكة</span></h1>
        </header>

        <section className="home-menu-card">
          <div className="home-menu-layout">
            <div className="home-logo-panel" aria-label="شعار مدرسة الحنكة">
              <img src="/qg14-logo.png" alt="شعار مدرسة الحنكة" />
            </div>

            <div className="home-main-menu">
              <span className="home-menu-label">القائمة الرئيسية</span>

              <button
                type="button"
                className={cn("home-save-toggle", saveToLeaderboard && "is-active")}
                onClick={onToggleLeaderboardSave}
                disabled={hasMatch || isStarting}
                role="switch"
                aria-checked={saveToLeaderboard}
              >
                <span className="home-save-check" aria-hidden="true">✓</span>
                <span>حفظ في جدول المتصدرين</span>
              </button>

              <button
                className={cn("home-start-button", isStarting && "is-loading")}
                onClick={onStart}
                disabled={isStarting}
                aria-busy={isStarting}
              >
                {isStarting ? (
                  <>
                    <span className="home-button-spinner" aria-hidden="true" />
                    جارٍ التحميل…
                  </>
                ) : (
                  <>
                    ابدء المباراة
                    <span aria-hidden="true">←</span>
                  </>
                )}
              </button>

              {hasMatch && (
                <button className="home-resume-button" onClick={onResume}>
                  متابعة المباراة الحالية
                </button>
              )}

              <div className="home-quick-panel">
                <div className="home-quick-grid">
                  <button className="home-menu-link leaderboard-link" onClick={onLeaderboard}>
                    المتصدرون
                  </button>
                  <button className="home-menu-link admin-link" onClick={onAdmin}>
                    لوحة التحكم
                  </button>
                  <button className="home-menu-link bottom-link" onClick={onBottom}>
                    قاع الهامور
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <p className="home-footer-mark">QG14 • MADRASAT AL-HANKA</p>
      </div>
    </section>
  );
}

function SetupScreen({
  game,
  error,
  onUpdate,
  onSharedAidUpdate,
  onStarter,
  onStart,
  onBack,
}: {
  game: GameState;
  error: string;
  onUpdate: (player: PlayerIndex, patch: Partial<SetupPlayer>) => void;
  onSharedAidUpdate: (
    patch: Partial<Pick<SetupPlayer, "customName" | "customDescription">>,
  ) => void;
  onStarter: (player: PlayerIndex) => void;
  onStart: () => void;
  onBack: () => void;
}) {
  const [avatarPlayer, setAvatarPlayer] = useState<PlayerIndex | null>(null);

  return (
    <section className="setup-screen setup-refined page">
      <PageTop onHome={onBack} />

      <header className="setup-page-title">
        <span>إعداد المباراة</span>
        <h1>أسماء اللاعبين</h1>
      </header>

      <section className="audience-aid-builder">
        <div className="audience-aid-intro">
          <AidIcon aid={{ key: "custom", symbol: "✦" }} />
          <div>
            <span>إعداد مشترك للاعبين</span>
            <h2>وسيلة مساعدة الجمهور</h2>
          </div>
        </div>
        <div className="audience-aid-fields">
          <label className="field">
            <span>اسم الوسيلة</span>
            <input
              value={game.setup[0].customName}
              maxLength={26}
              placeholder="اكتب اسم الوسيلة"
              onChange={(event) => onSharedAidUpdate({ customName: event.target.value })}
            />
          </label>
          <label className="field">
            <span>ماذا تفعل؟</span>
            <textarea
              value={game.setup[0].customDescription}
              maxLength={110}
              placeholder="اكتب وصف الوسيلة وطريقة استخدامها"
              onChange={(event) => onSharedAidUpdate({ customDescription: event.target.value })}
            />
          </label>
        </div>
      </section>

      <div className="setup-players-grid">
        {game.setup.map((player, playerIndex) => (
          <article
            className={cn(
              "setup-player-card",
              "setup-compact-card",
              playerIndex === 0 ? "player-blue" : "player-red",
            )}
            key={playerIndex}
          >
            <div className="player-card-head">
              <span className="player-number">0{playerIndex + 1}</span>
              <div>
                <small>المتنافس</small>
                <h2>اللاعب {playerIndex + 1}</h2>
              </div>
              <label className="starter-toggle">
                <input
                  type="radio"
                  name="starter"
                  checked={game.startingPlayer === playerIndex}
                  onChange={() => onStarter(playerIndex as PlayerIndex)}
                />
                يبدأ
              </label>
            </div>

            <div className="player-identity-row">
              <label className="field">
                <span>اسم اللاعب</span>
                <input
                  value={player.name}
                  maxLength={24}
                  placeholder={"اكتب اسم اللاعب " + (playerIndex + 1)}
                  onChange={(event) => onUpdate(playerIndex as PlayerIndex, { name: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="avatar-picker-trigger"
                onClick={() => setAvatarPlayer(playerIndex as PlayerIndex)}
                aria-label={"تغيير أفاتار اللاعب " + (playerIndex + 1)}
              >
                <img src={player.avatar} alt="" aria-hidden="true" />
              </button>
            </div>

            <div className="aid-replacement-block">
              <div className="aid-replacement-head">
                <span className="replacement-icon"><AidGlyph type="steal" /></span>
                <div>
                  <strong>استبدل وسيلة أساسية</strong>
                  <small>اختر الوسيلة التي ستخرج ويحل مكانها «{game.setup[0].customName || "وسيلة الجمهور"}»</small>
                </div>
              </div>
              <div className="replacement-aid-grid">
                {AID_DEFS.map((aid) => {
                  const selected = player.removedAid === aid.key;
                  return (
                    <button
                      key={aid.key}
                      className={cn("aid-choice", selected && "selected")}
                      onClick={() =>
                        onUpdate(playerIndex as PlayerIndex, {
                          removedAid: aid.key as Exclude<AidKey, "custom">,
                        })
                      }
                      aria-pressed={selected}
                    >
                      <AidIcon aid={aid} />
                      <span><strong>{aid.name}</strong></span>
                      {selected && <b>ستحذف</b>}
                    </button>
                  );
                })}
              </div>
            </div>

          </article>
        ))}
      </div>

      <div className="setup-footer setup-refined-footer setup-footer-action-only">
        <div className="setup-action">
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary button-large" onClick={onStart}>
            ابدأ فقرة التصنيفات
            <span aria-hidden="true">←</span>
          </button>
        </div>
      </div>

      {avatarPlayer !== null && (
        <div
          className="modal-backdrop avatar-picker-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={"اختيار أفاتار اللاعب " + (avatarPlayer + 1)}
          onClick={() => setAvatarPlayer(null)}
        >
          <div className="avatar-picker-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="avatar-modal-close"
              onClick={() => setAvatarPlayer(null)}
              aria-label="إغلاق نافذة الأفاتارات"
            >
              ×
            </button>
            <div className="avatar-modal-heading">
              <span>صورة اللاعب</span>
              <h2>اختر أفاتار اللاعب {avatarPlayer + 1}</h2>
              <p>كل لاعب يمتلك صورة مختلفة عن منافسه.</p>
            </div>
            <div className="avatar-modal-grid">
              {AVATARS.map((avatar) => {
                const selected = game.setup[avatarPlayer].avatar === avatar.src;
                const opponent = (avatarPlayer === 0 ? 1 : 0) as PlayerIndex;
                const usedByOpponent = game.setup[opponent].avatar === avatar.src;
                return (
                  <button
                    key={avatar.id}
                    type="button"
                    className={cn("avatar-modal-option", selected && "selected")}
                    disabled={usedByOpponent && !selected}
                    onClick={() => {
                      onUpdate(avatarPlayer, { avatar: avatar.src });
                      setAvatarPlayer(null);
                    }}
                    aria-label={"اختيار " + avatar.name}
                    aria-pressed={selected}
                  >
                    <img src={avatar.src} alt="" aria-hidden="true" />
                    <strong>{avatar.name}</strong>
                    {selected && <span>المحدد</span>}
                    {usedByOpponent && !selected && <span>مستخدم</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PageTop({ onHome }: { onHome: () => void }) {
  return (
    <button className="floating-page-exit" onClick={onHome} aria-label="العودة للرئيسية">×</button>
  );
}

function AnswersFileLink({ section }: { section: "categories" | "rapid" }) {
  return (
    <div className="answers-launch-footer">
      <a
        className="answers-file-button"
        href={"/answers?section=" + section}
        target="_blank"
        rel="noopener noreferrer"
      >
        عرض ملف الإجابات
      </a>
    </div>
  );
}

function ScoreStrip({
  players,
  activePlayer,
  onAdjust,
  label,
}: {
  players: [Player, Player];
  activePlayer?: PlayerIndex;
  onAdjust: (player: PlayerIndex, amount: number) => void;
  label: string;
}) {
  return (
    <div className="score-strip">
      {[0, 1].map((index) => {
        const playerIndex = index as PlayerIndex;
        const player = players[playerIndex];
        return (
          <div
            className={cn(
              "score-player",
              index === 0 ? "blue" : "red",
              activePlayer === playerIndex && "is-active",
            )}
            key={player.name}
          >
            <div className="score-person">
              <img className="avatar avatar-image" src={player.avatar} alt={"أفاتار " + player.name} />
              <div>
                <small>{activePlayer === playerIndex ? "الدور الحالي" : "المتنافس"}</small>
                <strong>{player.name}</strong>
              </div>
            </div>
            <div className="score-controls">
              <button onClick={() => onAdjust(playerIndex, -1)} aria-label={"خصم نقطة من " + player.name}>−</button>
              <span>{player.score}</span>
              <button onClick={() => onAdjust(playerIndex, 1)} aria-label={"إضافة نقطة إلى " + player.name}>+</button>
            </div>
          </div>
        );
      })}
      <div className="score-label">
        <span>النقاط</span>
        <strong>{label}</strong>
      </div>
    </div>
  );
}

function CategoriesScreen({
  game,
  questions,
  onPrepareQuestion,
  onAdjust,
  onNext,
  onHome,
}: {
  game: GameState;
  questions: Question[];
  onPrepareQuestion: (category: string, slot: number) => void;
  onAdjust: (player: PlayerIndex, amount: number) => void;
  onNext: () => void;
  onHome: () => void;
}) {
  const categoryTarget = Math.min(CATEGORY_QUESTION_TARGET, questions.length);
  const targetProgress = Math.min(game.usedSlots.length, categoryTarget);
  const progress = Math.round((targetProgress / categoryTarget) * 100);

  return (
    <section className="game-screen page wide-page">
      <PageTop onHome={onHome} />
      <ScoreStrip
        players={game.players}
        activePlayer={game.activePlayer}
        onAdjust={onAdjust}
        label={targetProgress + " / " + categoryTarget + " سؤال للانتقال"}
      />

      <div className="progress-track" aria-label={"نسبة الإنجاز " + progress + "%"}>
        <span style={{ width: progress + "%" }} />
      </div>

      <div className="game-layout category-game-layout">
        <section className="category-board">
          <div className="board-heading">
            <div>
              <span className="section-kicker">الفقرة الأولى</span>
              <h1>اختر التصنيف ورقم السؤال</h1>
            </div>
            <div className="category-heading-actions">
              <div className="turn-callout">
                <span>الدور الآن</span>
                <strong>{game.players[game.activePlayer].name}</strong>
              </div>
              {game.usedSlots.length >= categoryTarget && (
                <button className="category-inline-next" onClick={onNext}>
                  الانتقال للأسئلة السريعة
                  <span aria-hidden="true">←</span>
                </button>
              )}
            </div>
          </div>

          <div className="category-columns-grid" aria-label="التصنيفات وأسئلتها">
            {CATEGORIES.map((category) => {
              const completed = Array.from({ length: CATEGORY_SLOT_COUNT }, (_, index) =>
                makeSlotKey(category.name, index + 1),
              ).filter((slot) => game.usedSlots.includes(slot)).length;
              return (
                <section className={cn("category-stack", category.className)} key={category.name}>
                  <header className="category-stack-head">
                    <span className="category-stack-icon"><CategoryIcon type={category.className} /></span>
                    <h2>{category.name}</h2>
                    <small>{completed}/{CATEGORY_SLOT_COUNT}</small>
                  </header>
                  <div className="category-stack-numbers" aria-label={"أسئلة " + category.name}>
                    {Array.from({ length: CATEGORY_SLOT_COUNT }, (_, index) => {
                      const slot = index + 1;
                      const selectedSlot = makeSlotKey(category.name, slot);
                      const used = game.usedSlots.includes(selectedSlot);
                      return (
                        <button
                          className={cn("category-number-button", used && "completed")}
                          key={selectedSlot}
                          disabled={used}
                          onClick={() => onPrepareQuestion(category.name, slot)}
                          aria-label={category.name + " السؤال رقم " + slot}
                        >
                          <strong>{used ? "✓" : slot}</strong>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      </div>
      <AnswersFileLink section="categories" />
    </section>
  );
}

function PreRevealModal({
  pending,
  player,
  questions,
  onAid,
  onReveal,
  onClose,
}: {
  pending: PendingReveal;
  player: Player;
  questions: Question[];
  onAid: (aid: Aid) => void;
  onReveal: () => void;
  onClose: () => void;
}) {
  const category = CATEGORIES.find((item) => item.name === pending.category);
  const selectedQuestion = questions.find((question) => question.id === pending.questionId);
  const revealedType = selectedQuestion ? questionRevealMeta(selectedQuestion) : null;
  const doubleAid = player.aids.find((aid) => aid.key === "double");
  const doubleAvailable = Boolean(doubleAid && !doubleAid.used);
  const stealAid = player.aids.find((aid) => aid.key === "steal");
  const stealAvailable = Boolean(
    stealAid && !stealAid.used && !pending.stealCommitted && !pending.doubleCommitted,
  );

  return (
    <div className="modal-backdrop pre-reveal-backdrop" role="dialog" aria-modal="true">
      <div className="pre-reveal-modal pre-reveal-compact qg-framed-panel">
        {!pending.doubleCommitted && !pending.stealCommitted && (
          <button className="icon-button" onClick={onClose} aria-label="العودة للوحة">×</button>
        )}
        <img className="pre-reveal-logo" src="/qg14-logo.png" alt="" aria-hidden="true" />
        <div className="mystery-pick">
          <span>{category && <CategoryIcon type={category.className} />}</span>
          <div>
            <small>{pending.category}</small>
            <strong>{pending.slot}</strong>
          </div>
        </div>
        {revealedType && (
          <div className={cn("question-type-reveal", "type-" + revealedType.tone)}>
            <span>{revealedType.symbol}</span>
            <div>
              <small>نوع السؤال</small>
              <strong>{revealedType.title}</strong>
              <p>{revealedType.description}</p>
            </div>
          </div>
        )}
        <div className="pre-reveal-actions">
          {pending.doubleCommitted ? (
            <div className="double-committed">
              <AidIcon aid={{ key: "double", symbol: "×2" }} />
              <div>
                <strong>تم تثبيت الدبل</strong>
                <small>النقاط الصحيحة للسؤال ستتضاعف.</small>
              </div>
            </div>
          ) : (
            <div className="pre-reveal-choice">
              {doubleAvailable && doubleAid ? (
                <button className="double-before-button" onClick={() => onAid(doubleAid)}>
                  <AidIcon aid={doubleAid} />
                  <span><strong>استخدم دبل 2×</strong><small>قبل عرض نص السؤال</small></span>
                </button>
              ) : (
                <div className="double-unavailable">
                  <AidIcon aid={{ key: "double", symbol: "×2" }} />
                  <p><strong>الدبل غير متاح</strong><small>تم استبداله أو استخدامه سابقًا.</small></p>
                </div>
              )}
            </div>
          )}

          <div className="pre-reveal-choice">
            {pending.stealCommitted ? (
              <div className="steal-committed">
                <AidIcon aid={{ key: "steal", symbol: "⇄" }} />
                <div><strong>تم نقل السؤال</strong><small>أصبح السؤال الآن مع {player.name}</small></div>
              </div>
            ) : stealAvailable && stealAid ? (
              <button className="steal-before-button" onClick={() => onAid(stealAid)}>
                <AidIcon aid={stealAid} />
                <span><strong>استخدم السرقة</strong><small>نقل السؤال إلى الخصم</small></span>
              </button>
            ) : (
              <div className="steal-unavailable">
                <AidIcon aid={{ key: "steal", symbol: "⇄" }} />
                <p><strong>السرقة غير متاحة</strong><small>تم استبدالها أو استخدامها سابقًا.</small></p>
              </div>
            )}
          </div>

          <button className="button button-primary button-large reveal-question-button" onClick={onReveal}>
            {pending.doubleCommitted && pending.stealCommitted
              ? "عرض سؤال الدبل للخصم"
              : pending.doubleCommitted
                ? "عرض سؤال الدبل"
                : pending.stealCommitted
                  ? "عرض السؤال للخصم"
                  : "عرض السؤال"}
            <span aria-hidden="true">←</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionModal({
  question,
  current,
  players,
  onMode,
  onRespondent,
  onReveal,
  onAid,
  aidAllowed,
  onScore,
  onClose,
}: {
  question: Question;
  current: CurrentQuestion;
  players: [Player, Player];
  onMode: (mode: "normal" | "hard") => void;
  onRespondent: (player: PlayerIndex) => void;
  onReveal: () => void;
  onAid: (player: PlayerIndex, aid: Aid) => void;
  aidAllowed: (player: PlayerIndex, aid: Aid) => boolean;
  onScore: (points: number) => void;
  onClose: () => void;
}) {
  const [doublePartIndex, setDoublePartIndex] = useState(0);
  const [choicesVisible, setChoicesVisible] = useState(false);
  const category = CATEGORIES.find((item) => item.name === question.category);
  const isHard = current.mode === "hard";

  useEffect(() => {
    setDoublePartIndex(0);
    setChoicesVisible(false);
  }, [question.id, current.mode]);
  const shownQuestion = isHard ? question.hardQuestion ?? question.question : question.question;
  const shownAnswer = isHard ? question.hardAnswer ?? question.answer : question.answer;
  const shownHint = isHard ? question.hardHint ?? question.hint : question.hint;
  const score = isHard ? 4 : 2;
  const scoreMultiplier = current.doubleApplied ? 2 : 1;
  const displayedScore = score * scoreMultiplier;

  return (
    <div className="modal-backdrop question-backdrop" role="dialog" aria-modal="true">
      <div className="question-modal">
        <div className="question-modal-top">
          <div className="question-category">
            <span>{category && <CategoryIcon type={category.className} />}</span>
            <div>
              <small>{question.category}</small>
              <strong>{questionMeta(question).label}</strong>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="إغلاق السؤال">×</button>
        </div>

        {question.type === "dual" && current.mode === null ? (
          <div className="mode-choice">
            <span className="section-kicker">سؤال بنمطين</span>
            <h2>اختر مستوى المجازفة</h2>
            <p>النمط العادي مع خيارات، أما الصعب فبلا خيارات وعقوبته −2 عند الخطأ.</p>
            <div className="mode-cards">
              <button className="mode-card normal" onClick={() => onMode("normal")}>
                <span>2</span>
                <strong>النمط العادي</strong>
                <small>خيارات • لا خصم عند الخطأ</small>
              </button>
              <button className="mode-card hard" onClick={() => onMode("hard")}>
                <span>4</span>
                <strong>النمط الصعب</strong>
                <small>بلا خيارات • −2 عند الخطأ</small>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="respondent-selector">
              <span>المجيب الحالي</span>
              {[0, 1].map((index) => (
                <button
                  key={index}
                  className={cn(current.respondent === index && "selected", index === 0 ? "blue" : "red")}
                  onClick={() => onRespondent(index as PlayerIndex)}
                >
                  {players[index as PlayerIndex].name}
                </button>
              ))}
            </div>

            <div className="question-content">
              <div className="question-points">
                <strong>{question.type === "double" ? (current.doubleApplied ? "4+4" : "2+2") : displayedScore}</strong>
                <span>نقطة</span>
              </div>
              {current.doubleApplied && <div className="double-banner">×2 مفعّل — النقاط الصحيحة مضاعفة</div>}

              {question.type === "double" ? (
                <div className="double-questions double-questions-sequential">
                  <span className="section-kicker">
                    سؤالين سهلين • السؤال {doublePartIndex + 1} من {question.parts?.length ?? 2}
                  </span>
                  {question.parts?.[doublePartIndex] && (
                    <article key={question.parts[doublePartIndex].question}>
                      <span>{doublePartIndex + 1}</span>
                      <h2>{question.parts[doublePartIndex].question}</h2>
                      {current.answerShown && <p>{question.parts[doublePartIndex].answer}</p>}
                    </article>
                  )}
                </div>
              ) : (
                <div className="single-question-shell">
                  <span className="section-kicker">{isHard ? "سؤال صعب • بلا خيارات" : "السؤال"}</span>
                  <article className="single-question-card">
                    <span className="single-question-mark">؟</span>
                    <h2 className="question-text">{shownQuestion}</h2>
                    {!isHard && question.choices && (
                      <div className="single-question-choices">
                        <button
                          type="button"
                          className="button button-ghost choices-toggle-button"
                          onClick={() => setChoicesVisible((visible) => !visible)}
                        >
                          {choicesVisible ? "إخفاء الخيارات" : "عرض الخيارات"}
                        </button>
                        {choicesVisible && (
                          <div className="choice-list">
                            {question.choices.map((choice, index) => (
                              <div key={choice}><span>{String.fromCharCode(65 + index)}</span>{choice}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {current.hintVisible && shownHint && (
                      <div className="hint-box"><span>師</span><p><strong>تلميح السينسي</strong>{shownHint}</p></div>
                    )}
                    {current.answerShown && (
                      <div className="answer-box"><small>الإجابة</small><strong>{shownAnswer}</strong></div>
                    )}
                  </article>
                </div>
              )}
            </div>

            <div className="modal-aid-bar">
              <div className="modal-aid-heading">
                <span>وسائل المساعدة</span>
              </div>
              <div className="question-player-aids">
                {players.map((player, playerIndex) => {
                  const index = playerIndex as PlayerIndex;
                  const isRespondent = current.respondent === index;
                  const visibleAids = player.aids.filter(
                    (aid) =>
                      aid.key !== "double" &&
                      (aid.key !== "custom" || isRespondent),
                  );
                  return (
                    <section
                      className={cn(
                        "question-player-aid-card",
                        index === 0 ? "blue" : "red",
                        isRespondent && "is-current",
                      )}
                      key={player.name}
                    >
                      <header>
                        <img className="avatar avatar-image" src={player.avatar} alt={"أفاتار " + player.name} />
                        <div>
                          <small>{isRespondent ? "صاحب السؤال الآن" : "المنافس"}</small>
                          <strong>{player.name}</strong>
                        </div>
                      </header>
                      <div className="question-player-aid-list">
                        {visibleAids.length > 0 ? (
                          visibleAids.map((aid) => {
                            const allowed = aidAllowed(index, aid);
                            const status = aid.used
                              ? "تم استخدامها"
                              : allowed
                                ? "متاحة الآن"
                                : "غير متاحة الآن";
                            return (
                              <button
                                key={playerIndex + "-" + aid.key}
                                onClick={() => onAid(index, aid)}
                                disabled={!allowed}
                                className={cn(
                                  aid.key === "custom" && "audience-aid-button",
                                  aid.used && "is-used",
                                  !allowed && !aid.used && "is-waiting",
                                )}
                                aria-label={aid.name + " — " + status}
                              >
                                <AidIcon aid={aid} compact />
                                <span className="question-aid-label">
                                  <strong>{aid.name}</strong>
                                  <small>{status}</small>
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <p>لا توجد وسيلة متاحة الآن</p>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>

            <div className="host-controls">
              <button className="button button-ghost" onClick={onReveal}>
                {current.answerShown ? "إخفاء الإجابة" : "إظهار الإجابة"}
              </button>
              <div className="result-buttons">
                {question.type === "double" ? (
                  doublePartIndex === 0 ? (
                    <button
                      type="button"
                      className="button button-primary double-next-button"
                      onClick={() => {
                        if (current.answerShown) onReveal();
                        setDoublePartIndex(1);
                      }}
                    >
                      التالي
                    </button>
                  ) : (
                    <>
                      <button className="result wrong" onClick={() => onScore(0)}>0 صحيحة</button>
                      <button className="result partial" onClick={() => onScore(2)}>واحدة صحيحة +{2 * scoreMultiplier}</button>
                      <button className="result correct" onClick={() => onScore(4)}>اثنتان صحيحتان +{4 * scoreMultiplier}</button>
                    </>
                  )
                ) : (
                  <>
                    <button className="result wrong" onClick={() => onScore(isHard ? -2 : 0)}>
                      إجابة خاطئة {isHard ? "−2" : "+0"}
                    </button>
                    <button className="result correct" onClick={() => onScore(score)}>
                      إجابة صحيحة +{displayedScore}
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RapidScreen({
  game,
  questions,
  onClaim,
  onFirstCorrect,
  onFirstWrong,
  onFallbackCorrect,
  onFallbackWrong,
  onReveal,
  onNext,
  onFinish,
  onAdjust,
  onHome,
}: {
  game: GameState;
  questions: RapidQuestion[];
  onClaim: (player: PlayerIndex) => void;
  onFirstCorrect: () => void;
  onFirstWrong: () => void;
  onFallbackCorrect: () => void;
  onFallbackWrong: () => void;
  onReveal: () => void;
  onNext: () => void;
  onFinish: () => void;
  onAdjust: (player: PlayerIndex, amount: number) => void;
  onHome: () => void;
}) {
  const current = questions[game.rapid.index];
  const claimant = game.rapid.claimant;
  const fallback = claimant === null ? null : ((claimant === 0 ? 1 : 0) as PlayerIndex);
  const isLast = game.rapid.index === questions.length - 1;

  return (
    <section className="game-screen rapid-screen rapid-refined page">
      <PageTop onHome={onHome} />
      <ScoreStrip players={game.players} onAdjust={onAdjust} label={"السؤال " + (game.rapid.index + 1) + " / " + questions.length} />

      <div className="rapid-layout">
        <section className="category-board rapid-category-board">
          <div className="board-heading rapid-board-heading">
            <div>
              <span className="section-kicker">الفقرة الثانية</span>
              <h1>الأسئلة السريعة</h1>
            </div>
            <div className="rapid-current-callout">
              <span>السؤال الحالي</span>
              <strong>{game.rapid.index + 1} / {questions.length}</strong>
            </div>
          </div>

          <div className="rapid-question-list" aria-label="قائمة الأسئلة السريعة">
            {questions.map((_, index) => (
              <span
                key={index}
                className={cn(index < game.rapid.index && "done", index === game.rapid.index && "current")}
              >
                {index + 1}
              </span>
            ))}
          </div>

          <article className="rapid-card">
          <div className="rapid-card-head">
            <span className="bolt">ϟ</span>
            <div>
              <small>السؤال السريع</small>
              <strong>الأسبق يكسب نقطتين</strong>
            </div>
            <span className="points-pill">+2</span>
          </div>

          <RapidQuestionStage
            key={game.rapid.index}
            question={current}
            answerShown={game.rapid.answerShown}
            waiting={game.rapid.status === "waiting"}
            players={game.players}
            onClaim={onClaim}
          />

          {game.rapid.status === "claimed" && claimant !== null && (
            <div className="rapid-judgement">
              <p>الإجابة الأولى لـ <strong>{game.players[claimant].name}</strong></p>
              <div>
                <button className="result wrong" onClick={onFirstWrong}>خاطئة • إلى المنافس</button>
                <button className="result correct" onClick={onFirstCorrect}>صحيحة +2</button>
              </div>
            </div>
          )}

          {game.rapid.status === "fallback" && fallback !== null && (
            <div className="rapid-judgement fallback">
              <span className="handover">انتقلت الفرصة</span>
              <p>الآن يجيب <strong>{game.players[fallback].name}</strong> مقابل نقطة واحدة</p>
              <div>
                <button className="result wrong" onClick={onFallbackWrong}>خاطئة +0</button>
                <button className="result correct" onClick={onFallbackCorrect}>صحيحة +1</button>
              </div>
            </div>
          )}

          {game.rapid.status === "resolved" && (
            <div className="rapid-resolved">
              <span>✓</span>
              <strong>{game.rapid.resultText}</strong>
              <button className="button button-primary" onClick={isLast ? onFinish : onNext}>
                {isLast ? "عرض النتيجة النهائية" : "السؤال التالي"}
                <b>←</b>
              </button>
            </div>
          )}

          {game.rapid.status !== "waiting" && game.rapid.status !== "resolved" && (
            <button className="reveal-link" onClick={onReveal}>
              {game.rapid.answerShown ? "إخفاء الإجابة عن الشاشة" : "إظهار الإجابة للهوست"}
            </button>
          )}
          </article>
        </section>
      </div>
      <AnswersFileLink section="rapid" />
    </section>
  );
}

function RapidQuestionStage({
  question,
  answerShown,
  waiting,
  players,
  onClaim,
}: {
  question: RapidQuestion;
  answerShown: boolean;
  waiting: boolean;
  players: [Player, Player];
  onClaim: (player: PlayerIndex) => void;
}) {
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <>
      <div className={cn("rapid-question", !isRevealed && "is-concealed")} aria-live="polite">
        <h1>{question.question}</h1>
        {answerShown && (
          <div className="answer-box"><small>الإجابة</small><strong>{question.answer}</strong></div>
        )}
      </div>

      {waiting && (
        <div className="buzz-grid">
          {[0, 1].map((index) => (
            <button
              key={index}
              className={cn("buzz-button", index === 0 ? "blue" : "red")}
              onClick={() => {
                setIsRevealed(true);
                onClaim(index as PlayerIndex);
              }}
            >
              <strong>{players[index as PlayerIndex].name}</strong>
              <small>اضغط الاسم لإظهار السؤال وحجز الإجابة</small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ResultsScreen({
  players,
  onRematch,
  onHome,
  onLeaderboard,
}: {
  players: [Player, Player];
  onRematch: () => void;
  onHome: () => void;
  onLeaderboard: () => void;
}) {
  const tied = players[0].score === players[1].score;
  const winnerIndex = players[0].score >= players[1].score ? 0 : 1;
  const winner = players[winnerIndex];

  return (
    <section className="results-screen page">
      <header className="results-top"><Brand small /></header>
      <div className="result-confetti" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => <span key={index} />)}
      </div>
      <div className="results-hero">
        <h1>{tied ? "تعادل الأذكياء!" : winner.name}</h1>
        {tied && <p>تساوى المتنافسان في النقاط. الحنكة هذه المرة مشتركة.</p>}
      </div>

      <div className="result-comparison">
        {players.map((player, index) => {
          const isWinner = !tied && index === winnerIndex;
          return (
            <article className={cn("result-player", index === 0 ? "blue" : "red", isWinner && "winner")} key={player.name}>
              {isWinner && <span className="winner-ribbon">الأول</span>}
              <div className="result-player-head">
                <img className="avatar avatar-image" src={player.avatar} alt={"أفاتار " + player.name} />
                <div><small>اللاعب {index + 1}</small><h2>{player.name}</h2></div>
                <strong>{player.score}</strong>
              </div>
              <div className="score-breakdown">
                <p><span>فقرة التصنيفات</span><strong>{player.categoryScore}</strong></p>
                <p><span>الأسئلة السريعة</span><strong>{player.rapidScore}</strong></p>
                <p className="total"><span>المجموع النهائي</span><strong>{player.score}</strong></p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="results-actions">
        <button className="button button-primary button-large" onClick={onRematch}>مباراة جديدة</button>
        <button className="button button-secondary button-large" onClick={onLeaderboard}>عرض المتصدرين</button>
        <button className="text-button" onClick={onHome}>العودة للرئيسية</button>
      </div>
    </section>
  );
}

function LeaderboardModal({
  entries,
  records,
  onClose,
}: {
  entries: LeaderboardEntry[];
  records: PlayerRecord[];
  onClose: () => void;
}) {
  return (
    <section className="records-page leaderboard-records-page page" aria-label="صفحة المتصدرين">
      <PageTop onHome={onClose} />
      <div className="records-page-shell leaderboard-page-shell">
        <div className="leaderboard-head">
          <div>
            <span className="section-kicker">سجل الأبطال</span>
            <h2>لوحة المتصدرين</h2>
            <p>أفضل 10 فائزين حسب نتيجة آخر فوز لكل اسم.</p>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="empty-leaderboard">
            <span>♛</span>
            <h3>المقعد الأول ينتظر بطله</h3>
            <p>أكمل أول مباراة ليظهر الفائز هنا.</p>
          </div>
        ) : (
          <div className="leaderboard-list">
            {entries.map((entry, index) => {
              const record = records.find((item) => item.id === normalizePlayerName(entry.name));
              return (
                <div className={cn("leader-row", index < 3 && "podium", "rank-" + (index + 1))} key={entry.name}>
                  <span className="rank">{index + 1}</span>
                  <strong>{entry.name}</strong>
                  <RecordSummaryStats
                    points={entry.score}
                    correct={record?.correct ?? 0}
                    wrong={record?.wrong ?? 0}
                  />
                  {index < 3 && <span className="medal">{index === 0 ? "♛" : index === 1 ? "◆" : "●"}</span>}
                </div>
              );
            })}
          </div>
        )}
        <div className="leaderboard-note">عند تكرار الاسم تُحدّث نقاطه بنتيجة فوزه الجديدة ويُعاد ترتيبه تلقائيًا.</div>
      </div>
    </section>
  );
}

function RecordSummaryStats({
  points,
  correct,
  wrong,
}: {
  points: number;
  correct: number;
  wrong: number;
}) {
  return (
    <dl className="record-summary-stats" aria-label="إحصاءات اللاعب">
      <div className="record-summary-stat stat-points">
        <dt>النقاط</dt>
        <dd>{points}</dd>
      </div>
      <div className="record-summary-stat stat-correct">
        <dt>الصحيحة</dt>
        <dd>{correct}</dd>
      </div>
      <div className="record-summary-stat stat-wrong">
        <dt>الخاطئة</dt>
        <dd>{wrong}</dd>
      </div>
    </dl>
  );
}

function AdminPanelModal({
  records,
  onSave,
  onClose,
}: {
  records: PlayerRecord[];
  onSave: (records: PlayerRecord[]) => void;
  onClose: () => void;
}) {
  const [draftRecords, setDraftRecords] = useState<PlayerRecord[]>(() => records.map((record) => ({ ...record })));
  const [searchQuery, setSearchQuery] = useState("");
  const [newPlayerName, setNewPlayerName] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: "success" | "error" } | null>(null);

  const rankedRecords = useMemo(
    () =>
      [...draftRecords]
        .sort((a, b) => b.points - a.points || b.updatedAt - a.updatedAt)
        .map((record, index) => ({ record, rank: index + 1 })),
    [draftRecords],
  );
  const normalizedSearch = normalizePlayerName(searchQuery);
  const visibleRecords = rankedRecords.filter(({ record }) =>
    normalizePlayerName(record.name).includes(normalizedSearch),
  );

  const adjustDraftRecord = (id: string, field: RecordField, amount: number) => {
    setDraftRecords((previous) =>
      previous.map((record) => {
        if (record.id !== id) return record;
        const nextValue = record[field] + amount;
        return {
          ...record,
          [field]: field === "points" ? nextValue : Math.max(0, nextValue),
          updatedAt: Date.now(),
        };
      }),
    );
    setIsDirty(true);
    setFeedback(null);
  };

  const addPlayer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newPlayerName.trim();
    const id = normalizePlayerName(name);

    if (!name) {
      setFeedback({ text: "اكتب اسم اللاعب أولًا.", tone: "error" });
      return;
    }
    if (draftRecords.some((record) => record.id === id)) {
      setFeedback({ text: "هذا اللاعب موجود بالفعل في السجل.", tone: "error" });
      return;
    }

    const now = Date.now();
    setDraftRecords((previous) => [
      ...previous,
      {
        id,
        name,
        points: 0,
        correct: 0,
        wrong: 0,
        games: 0,
        wins: 0,
        losses: 0,
        updatedAt: now,
      },
    ]);
    setNewPlayerName("");
    setSearchQuery(name);
    setIsDirty(true);
    setFeedback({ text: "تمت إضافة اللاعب إلى المسودة. اضغط حفظ التغييرات لاعتماده.", tone: "success" });
  };

  const saveChanges = () => {
    onSave(draftRecords);
    setIsDirty(false);
    setFeedback({ text: "تم حفظ جميع التغييرات بنجاح.", tone: "success" });
  };

  return (
    <section className="records-page admin-records-page page" aria-label="صفحة لوحة التحكم">
      <PageTop onHome={onClose} />
      <div className="records-page-shell admin-records-page-shell">
        <div className="records-modal-head">
          <div>
            <span className="section-kicker">سجل جميع المباريات</span>
            <h2>لوحة التحكم</h2>
            <p>راجع نقاط كل لاعب وإجاباته، وعدّل أي رقم مباشرة عند الحاجة.</p>
          </div>
        </div>

        <div className="admin-record-tools">
          <label className="admin-tool-field admin-search-field">
            <span>البحث عن اسم</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="اكتب اسم اللاعب"
              aria-label="البحث عن لاعب بالاسم"
            />
          </label>

          <form className="admin-add-player" onSubmit={addPlayer}>
            <label className="admin-tool-field">
              <span>إضافة لاعب جديد</span>
              <input
                value={newPlayerName}
                onChange={(event) => setNewPlayerName(event.target.value)}
                placeholder="اسم اللاعب الجديد"
                aria-label="اسم اللاعب الجديد"
              />
            </label>
            <button type="submit" className="admin-add-button">إضافة اللاعب</button>
          </form>

          <button
            type="button"
            className="admin-save-button"
            onClick={saveChanges}
            disabled={!isDirty}
          >
            حفظ التغييرات
          </button>

          {feedback && (
            <p className={cn("admin-tool-feedback", feedback.tone === "error" && "is-error")} role="status">
              {feedback.text}
            </p>
          )}
        </div>

        {draftRecords.length === 0 ? (
          <div className="records-empty">
            <span>⚙</span>
            <h3>لا توجد أسماء مسجلة بعد</h3>
            <p>أضف لاعبًا من الخانة بالأعلى أو أكمل أول مباراة ليُضاف تلقائيًا.</p>
          </div>
        ) : visibleRecords.length === 0 ? (
          <div className="records-empty records-search-empty">
            <span>⌕</span>
            <h3>لا يوجد لاعب بهذا الاسم</h3>
            <p>جرّب كتابة اسم آخر أو امسح خانة البحث لعرض الجميع.</p>
          </div>
        ) : (
          <div className="admin-record-list">
            {visibleRecords.map(({ record, rank }) => (
              <article className="admin-record-row" key={record.id}>
                <div className="record-identity">
                  <span className="record-rank">{rank}</span>
                  <div>
                    <strong>{record.name}</strong>
                    <small>{record.games} مباراة • {record.wins} فوز • {record.losses} خسارة</small>
                  </div>
                </div>

                <div className="record-controls">
                  <RecordAdjuster
                    label="النقاط"
                    value={record.points}
                    onDecrease={() => adjustDraftRecord(record.id, "points", -1)}
                    onIncrease={() => adjustDraftRecord(record.id, "points", 1)}
                  />
                  <RecordAdjuster
                    label="إجابات صحيحة"
                    value={record.correct}
                    tone="correct"
                    onDecrease={() => adjustDraftRecord(record.id, "correct", -1)}
                    onIncrease={() => adjustDraftRecord(record.id, "correct", 1)}
                  />
                  <RecordAdjuster
                    label="إجابات خاطئة"
                    value={record.wrong}
                    tone="wrong"
                    onDecrease={() => adjustDraftRecord(record.id, "wrong", -1)}
                    onIncrease={() => adjustDraftRecord(record.id, "wrong", 1)}
                  />
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="records-note">تُحفظ نتائج المباريات تلقائيًا، أما التعديلات اليدوية فتُعتمد بعد الضغط على «حفظ التغييرات».</p>
      </div>
    </section>
  );
}

function RecordAdjuster({
  label,
  value,
  tone,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: number;
  tone?: "correct" | "wrong";
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className={cn("record-adjuster", tone && "record-" + tone)}>
      <span>{label}</span>
      <div>
        <button onClick={onDecrease} aria-label={"تنقيص " + label}>−</button>
        <strong>{value}</strong>
        <button onClick={onIncrease} aria-label={"زيادة " + label}>+</button>
      </div>
    </div>
  );
}

function BottomLeaderboardModal({ records, onClose }: { records: PlayerRecord[]; onClose: () => void }) {
  const losers = [...records]
    .filter((record) => record.losses > 0)
    .sort((a, b) => a.points - b.points || b.losses - a.losses || a.updatedAt - b.updatedAt);

  return (
    <section className="records-page bottom-records-page page" aria-label="صفحة قاع الهامور">
      <PageTop onHome={onClose} />
      <div className="records-page-shell bottom-records-page-shell">
        <div className="records-modal-head">
          <div>
            <span className="section-kicker">منطقة الخاسرين</span>
            <h2>قاع الهامور</h2>
            <p>أقل النقاط بين اللاعبين الذين خسروا مباراة واحدة على الأقل.</p>
          </div>
        </div>

        {losers.length === 0 ? (
          <div className="records-empty bottom-empty">
            <span>↓</span>
            <h3>القاع ما زال فارغًا</h3>
            <p>بعد اكتمال أول مباراة سيظهر اللاعب الخاسر هنا مع مجموع نقاطه.</p>
          </div>
        ) : (
          <div className="bottom-record-list">
            {losers.map((record, index) => (
              <div className="bottom-record-row" key={record.id}>
                <span className="bottom-rank">{index + 1}</span>
                <div>
                  <strong>{record.name}</strong>
                  <small>{record.losses} خسارة • {record.games} مباراة</small>
                </div>
                <RecordSummaryStats
                  points={record.points}
                  correct={record.correct}
                  wrong={record.wrong}
                />
              </div>
            ))}
          </div>
        )}

        <p className="records-note">يُرتب القاع من الأقل نقاطًا إلى الأعلى، ويعرض جميع الخاسرين المسجلين.</p>
      </div>
    </section>
  );
}

function ConfirmAidModal({
  playerName,
  aid,
  onConfirm,
  onClose,
}: {
  playerName: string;
  aid: Aid;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop top-modal" role="dialog" aria-modal="true">
      <div className="confirm-modal">
        <AidIcon aid={aid} />
        <span className="section-kicker">استخدام لمرة واحدة</span>
        <h2>{aid.name}</h2>
        <p><strong>{playerName}</strong> على وشك استخدام هذه الوسيلة. {aid.description}</p>
        <div>
          <button className="button button-ghost" onClick={onClose}>تراجع</button>
          <button className="button button-primary" onClick={onConfirm}>تأكيد الاستخدام</button>
        </div>
      </div>
    </div>
  );
}

function WheelModal({
  playerName,
  onSpin,
  onClose,
}: {
  playerName: string;
  onSpin: (spins: 1 | 2) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop top-modal" role="dialog" aria-modal="true">
      <div className="wheel-modal">
        <button className="icon-button" onClick={onClose} aria-label="إغلاق">×</button>
        <div className="wheel-graphic"><span>↻</span><i /><i /><i /><i /><i /></div>
        <span className="section-kicker">لف الدوامة • {playerName}</span>
        <h2>كم مرة ستدور؟</h2>
        <p>يمكن استخدام الوسيلة مرة واحدة، واختيار لفة أو لفتين الآن.</p>
        <div className="spin-options">
          <button onClick={() => onSpin(1)}><strong>لفة واحدة</strong><small>اختيار عشوائي واحد</small></button>
          <button onClick={() => onSpin(2)}><strong>لفتان</strong><small>اختر بين نتيجتين</small></button>
        </div>
      </div>
    </div>
  );
}

function WheelResultModal({
  ids,
  onChoose,
  onClose,
}: {
  ids: string[];
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="wheel-result-modal">
        <span className="success-icon">↻</span>
        <span className="section-kicker">نتيجة الدوامة</span>
        <h2>{ids.length === 1 ? "هذا هو سؤالك" : "اختر إحدى النتيجتين"}</h2>
        <div className="wheel-result-list">
          {ids.map((id) => {
            const selected = readSlotKey(id);
            const category = CATEGORIES.find((item) => item.name === selected.category);
            return (
              <button key={id} onClick={() => onChoose(id)}>
                <span>{category && <CategoryIcon type={category.className} />}</span>
                <div><strong>{selected.category}</strong><small>السؤال رقم {selected.slot} • المحتوى مخفي</small></div>
                <b>اختيار ←</b>
              </button>
            );
          })}
        </div>
        <button className="text-button" onClick={onClose}>العودة للوحة</button>
      </div>
    </div>
  );
}
