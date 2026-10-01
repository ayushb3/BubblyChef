import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/Providers";
import BottomNav from "@/components/layout/BottomNav";
import PageTransition from "@/components/ui/PageTransition";
import { pwaColors } from "@/lib/design-tokens";
import "./globals.css";

// Self-hosted (not next/font/google) so production builds never fetch from
// Google Fonts at build time — see issue #633. Both files are the exact
// "latin" @font-face block that fonts.googleapis.com/css2 serves for a
// Chrome-class User-Agent (variable woff2, not the static TTF a plainer UA
// gets served). Re-download and verify with `nextjs/scripts/fetch-fonts.sh`
// — it pins these same URLs and hashes. OFL license text (from
// github.com/google/fonts) sits alongside each file in
// ./fonts/<family>/OFL.txt.
//
// Nunito-Variable.woff2 (fvar weight axis 200-1000; latin glyph coverage
// confirmed via fontTools cmap — see PR #634's "Verified" section):
//   css2 request: https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,200..1000;1,200..1000&display=swap
//   gstatic file: https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaB.woff2
//   sha256:       ba344451eab25b217a165363b1982048a5e5830a0daf36577973955a04cac793
const nunito = localFont({
  src: "./fonts/nunito/Nunito-Variable.woff2",
  variable: "--font-nunito",
  weight: "200 1000",
  display: "swap",
});

// Quicksand-Variable.woff2 (fvar weight axis 300-700; latin glyph coverage
// confirmed via fontTools cmap — see PR #634's "Verified" section):
//   css2 request: https://fonts.googleapis.com/css2?family=Quicksand:wght@300..700&display=swap
//   gstatic file: https://fonts.gstatic.com/s/quicksand/v37/6xKtdSZaM9iE8KbpRA_hK1QN.woff2
//   sha256:       2add7d60b1cd2ab84c9967e23d5ec08eb3fc9635c46855b17d59404dec6b410e
const quicksand = localFont({
  src: "./fonts/quicksand/Quicksand-Variable.woff2",
  variable: "--font-heading",
  weight: "300 700",
  display: "swap",
});

// --- issue #741: pixel lettering (world-only text) ---------------------------
// Pixelify Sans-Variable.woff2 (fvar weight axis 400-700; latin subset), the
// same self-hosting rule as the two faces above (no Google Fonts fetch in
// production). Exposed as the `font-pixel` utility (see globals.css). Re-verify
// with `nextjs/scripts/fetch-fonts.sh`. OFL text in ./fonts/pixelify-sans/OFL.txt.
//   css2 request: https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400..700&display=swap
//   gstatic file: https://fonts.gstatic.com/s/pixelifysans/v3/CHylV-3HFUT7aC4iv1TxGDR9Jn0Eiw.woff2
//   sha256:       4a5633a0c9c1b73abd133a56d3716c2d8df2ed03cb987346f72194aeb224f382
const pixelify = localFont({
  src: "./fonts/pixelify-sans/PixelifySans-Variable.woff2",
  variable: "--font-pixelify",
  weight: "400 700",
  display: "swap",
});
// --- end issue #741 -----------------------------------------------------------

export const metadata: Metadata = {
  title: "BubblyChef",
  description: "AI-powered pantry & recipe assistant",
};

export const viewport: Viewport = {
  themeColor: pwaColors.themeColor,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${nunito.variable} ${quicksand.variable} ${pixelify.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Flash-prevention: apply saved theme before first paint to avoid palette flicker */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('bubbly-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[var(--color-bg)]">
        <Providers>
          <main className="pb-20"><PageTransition>{children}</PageTransition></main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
