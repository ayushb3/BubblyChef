import type { Metadata } from "next";
import { Nunito, Quicksand } from "next/font/google";
import { Providers } from "@/components/Providers";
import BottomNav from "@/components/layout/BottomNav";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const quicksand = Quicksand({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "BubblyChef",
  description: "AI-powered pantry & recipe assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${nunito.variable} ${quicksand.variable} h-full antialiased`}>
      <body className="min-h-screen bg-[var(--color-bg)]" style={{ fontFamily: 'Nunito, sans-serif' }}>
        <Providers>
          <main className="pb-20">{children}</main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
