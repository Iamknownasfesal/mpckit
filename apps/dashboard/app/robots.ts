import type { MetadataRoute } from "next";

// Console is auth-walled; tell crawlers not to index any of it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
