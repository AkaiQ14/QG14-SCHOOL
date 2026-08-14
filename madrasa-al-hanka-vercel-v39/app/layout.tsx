import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "مدرسة الحنكة",
  description: "لعبة تنافسية عربية تجمع التصنيفات والأسئلة السريعة للاعبين وهوست.",
  other: {
    "codex-preview": "development",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
