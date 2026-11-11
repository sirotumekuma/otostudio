import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OtoStudio - ブラウザで作る音MAD",
  description: "無料・アカウント不要。ブラウザだけで音MADが作れるアプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
