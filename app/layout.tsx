import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "مدرسة الحنكة",
  description: "لعبة تنافسية عربية تجمع التصنيفات والأسئلة السريعة للاعبين وهوست.",
  icons: {
    icon: "/images/QG144.png",
    shortcut: "/images/QG144.png",
    apple: "/images/QG144.png",
  },
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
