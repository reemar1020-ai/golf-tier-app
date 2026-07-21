import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ゴルフ Tier 表",
  description: "友人の年間ゴルフスコアを集計し、Tier と 2 チーム分けを表示するWebアプリ",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="nan-logo-safe min-h-full flex flex-col">
        <div className="nan-logo-fixed" aria-hidden="true">
          <img src="/logo-nan.png" alt="南ロゴ" className="nan-logo-image" />
        </div>
        {children}
      </body>
    </html>
  );
}
