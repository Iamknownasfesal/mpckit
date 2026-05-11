import { SITE_URL } from "@/lib/site";
import { source } from "@/lib/source";
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  // Marketing landing.
  const root: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  // Every Fumadocs page.
  const docs: MetadataRoute.Sitemap = source.getPages().map((page) => ({
    url: `${SITE_URL}${page.url}`,
    lastModified,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...root, ...docs];
}
