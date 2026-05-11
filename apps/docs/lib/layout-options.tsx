import { Mark } from "@/components/mark";
import { DASHBOARD_URL, GITHUB_URL } from "@/lib/site";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="inline-flex items-center gap-2">
        <Mark size={20} />
        <span className="font-semibold tracking-tight">MpcKit</span>
      </span>
    ),
  },
  links: [
    { text: "Documentation", url: "/docs" },
    { text: "Console", url: DASHBOARD_URL, external: true },
    { text: "GitHub", url: GITHUB_URL, external: true },
  ],
};
