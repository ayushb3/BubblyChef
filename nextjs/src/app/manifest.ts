import type { MetadataRoute } from "next";
import { pwaColors } from "@/lib/design-tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BubblyChef",
    short_name: "BubblyChef",
    description: "Your kawaii pantry & recipe assistant",
    start_url: "/",
    display: "standalone",
    background_color: pwaColors.backgroundColor,
    theme_color: pwaColors.themeColor,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
