import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "生活抽签 · 每日新鲜事",
  description: "两个人各抽一张，再一起选一件新鲜事。",
  applicationName: "生活抽签",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "生活抽签" },
  icons: {
    icon: [
      { url: "https://dashboard.example.com/app-icons/life-192-9204ec0dc7aa.png", sizes: "192x192", type: "image/png" },
      { url: "https://dashboard.example.com/app-icons/life-512-2a3c8a6d073a.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "https://dashboard.example.com/app-icons/life-192-9204ec0dc7aa.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "https://dashboard.example.com/app-icons/life-180-2a1f9db15718.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        {/* Self-hosted stylesheet preserves the portable Vinext/Sites font path. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/fonts/life-draw-serif.css" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
