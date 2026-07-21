import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "AI Office | 시뮬레이션 개발 준비실";
const description =
  "SSD·UFS 성능 시뮬레이터 개발 조직을 위한 AI 에이전트 오퍼레이션 대시보드";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = getRequestOrigin(requestHeaders);
  const socialImage = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description: "조사부터 견적, 테스트 설계, Git 이슈화까지 한눈에 지휘하세요.",
      type: "website",
      locale: "ko_KR",
      images: [{ url: socialImage, width: 1731, height: 909, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: "SSD·UFS 시뮬레이션 개발 준비를 지휘하는 AI 오피스",
      images: [socialImage],
    },
  };
}

function getRequestOrigin(requestHeaders: Headers): string {
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" ? "http" : "https";

  if (host && /^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    return `${protocol}://${host}`;
  }

  return "https://ai-office.local";
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
