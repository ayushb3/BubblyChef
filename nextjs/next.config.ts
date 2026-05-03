import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Note: Vercel's 4.5MB API route body limit is handled client-side in
  // src/lib/api/scan.ts (compressImage) — not via serverActions.bodySizeLimit,
  // which only applies to Server Actions, not API route handlers.
};

export default nextConfig;
