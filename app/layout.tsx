import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { OFFICE_COPY } from "./features/office/copy";
import "./globals.css";
import "./office-studio.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const { title, description } = OFFICE_COPY.metadata;
const DEFAULT_PUBLIC_ORIGIN = "https://ai-office-sim-prep.chil9199.chatgpt.site";

export function generateMetadata(): Metadata {
  const origin = getPublicOrigin(process.env.AI_OFFICE_PUBLIC_ORIGIN);
  const socialImage = new URL("/og-ai-office.png", origin).toString();

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
      description: OFFICE_COPY.metadata.openGraphDescription,
      type: "website",
      locale: "ko_KR",
      images: [{ url: socialImage, width: 1672, height: 941, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: OFFICE_COPY.metadata.twitterDescription,
      images: [socialImage],
    },
  };
}

function getPublicOrigin(configuredOrigin: string | undefined): string {
  if (!configuredOrigin) return DEFAULT_PUBLIC_ORIGIN;
  try {
    const url = new URL(configuredOrigin);
    const isLoopback = url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    const protocolAllowed = url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopback);
    const isBareOrigin = url.pathname === "/" && !url.search && !url.hash &&
      !url.username && !url.password;
    return protocolAllowed && isBareOrigin ? url.origin : DEFAULT_PUBLIC_ORIGIN;
  } catch {
    return DEFAULT_PUBLIC_ORIGIN;
  }
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
