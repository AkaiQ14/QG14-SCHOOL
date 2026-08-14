"use client";

import { useEffect, useMemo, useState } from "react";

type QuestionType = "easy" | "normal" | "hard" | "dual" | "double";

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

type QuestionBank = {
  categories: Question[];
  rapid: { id: string; question: string; answer: string }[];
};

type Section = "categories" | "rapid";

const CATEGORY_ORDER = ["كرة قدم", "أنمي", "معلومات عامة", "أفلام ومسلسلات", "ألعاب"];

const TYPE_LABELS: Record<QuestionType, string> = {
  easy: "سهل",
  normal: "عادي",
  hard: "صعب",
  dual: "عادي أو صعب",
  double: "سؤالين سهلين",
};

export default function AnswersPage() {
  const [bank, setBank] = useState<QuestionBank | null>(null);
  const [section, setSection] = useState<Section>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("section") === "rapid"
      ? "rapid"
      : "categories",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/data/questions.json", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("request-failed");
        const data = (await response.json()) as QuestionBank;
        if (!Array.isArray(data.categories) || !data.categories.length || !Array.isArray(data.rapid) || !data.rapid.length) {
          throw new Error("invalid-data");
        }
        setBank(data);
      } catch {
        if (!controller.signal.aborted) setError("تعذر تحميل ملف الإجابات. أعد فتح الصفحة وحاول مرة أخرى.");
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const groupedQuestions = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        questions: bank?.categories.filter((question) => question.category === category) ?? [],
      })),
    [bank],
  );

  return (
    <main className="answers-page">
      <header className="answers-page-header">
        <div className="answers-brand">
          <img src="/qg14-logo.png" alt="" aria-hidden="true" />
          <div><small>مدرسة الحنكة</small><h1>ملف الإجابات</h1></div>
        </div>
        <button className="answers-close" onClick={() => window.close()} aria-label="إغلاق ملف الإجابات">×</button>
      </header>

      <nav className="answers-tabs" aria-label="أقسام ملف الإجابات">
        <button className={section === "categories" ? "active" : ""} onClick={() => setSection("categories")}>
          فقرة التصنيفات
          <small>{bank?.categories.length ?? 0} سؤالًا</small>
        </button>
        <button className={section === "rapid" ? "active" : ""} onClick={() => setSection("rapid")}>
          الأسئلة السريعة
          <small>{bank?.rapid.length ?? 0} سؤالًا</small>
        </button>
      </nav>

      {!bank && !error && (
        <div className="answers-loading"><span />جارٍ تحميل الإجابات…</div>
      )}

      {error && <div className="answers-error">{error}</div>}

      {bank && section === "categories" && (
        <div className="answers-category-groups">
          {groupedQuestions.map((group) => (
            <section className="answers-category-section" key={group.category}>
              <header><h2>{group.category}</h2><span>{group.questions.length} أسئلة</span></header>
              <div className="answers-card-grid">
                {group.questions.map((question, index) => (
                  <article className={"answer-card answer-type-" + question.type} key={question.id}>
                    <div className="answer-card-meta">
                      <span className="answer-number">{index + 1}</span>
                      <span className="answer-type">{TYPE_LABELS[question.type]}</span>
                    </div>

                    {question.type === "double" ? (
                      <div className="answer-parts">
                        {question.parts?.map((part, partIndex) => (
                          <div key={part.question}>
                            <h3><span>{partIndex + 1}</span>{part.question}</h3>
                            <p className="official-answer"><small>الإجابة</small>{part.answer}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        <h3>{question.question}</h3>
                        {question.choices && (
                          <ol className="answer-choices">
                            {question.choices.map((choice, choiceIndex) => (
                              <li className={choice === question.answer ? "correct-choice" : ""} key={choice}>
                                <span>{String.fromCharCode(65 + choiceIndex)}</span>{choice}
                              </li>
                            ))}
                          </ol>
                        )}
                        <p className="official-answer"><small>الإجابة</small>{question.answer}</p>
                        {question.hint && <p className="answer-hint"><small>التلميح</small>{question.hint}</p>}

                        {question.type === "dual" && question.hardQuestion && (
                          <div className="hard-answer-block">
                            <span>النمط الصعب</span>
                            <h3>{question.hardQuestion}</h3>
                            <p className="official-answer"><small>الإجابة</small>{question.hardAnswer}</p>
                            {question.hardHint && <p className="answer-hint"><small>التلميح</small>{question.hardHint}</p>}
                          </div>
                        )}
                      </>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {bank && section === "rapid" && (
        <section className="rapid-answers-list">
          {bank.rapid.map((question, index) => (
            <article key={question.question}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><h2>{question.question}</h2><p><small>الإجابة</small>{question.answer}</p></div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
