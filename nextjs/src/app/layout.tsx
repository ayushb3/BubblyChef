import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/Providers";
import BottomNav from "@/components/layout/BottomNav";
import PageTransition from "@/components/ui/PageTransition";
import "./globals.css";

// Self-hosted (not next/font/google) so production builds never fetch from
// Google Fonts at build time — see issue #633. Variable woff2, latin subset,
// downloaded from the fonts.gstatic.com URLs the fonts.googleapis.com/css2
// API serves for these families; OFL license text (from google/fonts) is
// alongside each file in ./fonts/<family>/OFL.txt.
const nunito = localFont({
  src: "./fonts/nunito/Nunito-Variable.woff2",
  variable: "--font-nunito",
  weight: "200 1000",
  display: "swap",
});

const quicksand = localFont({
  src: "./fonts/quicksand/Quicksand-Variable.woff2",
  variable: "--font-heading",
  weight: "300 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BubblyChef",
  description: "AI-powered pantry & recipe assistant",
};

export const viewport: Viewport = {
  themeColor: "#ffb5c5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${nunito.variable} ${quicksand.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Flash-prevention: apply saved theme before first paint to avoid palette flicker */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('bubbly-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[var(--color-bg)]" style={{ fontFamily: 'Nunito, sans-serif' }}>
        <Providers>
          <main className="pb-20"><PageTransition>{children}</PageTransition></main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
