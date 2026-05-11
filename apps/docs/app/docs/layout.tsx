import { baseOptions } from "@/lib/layout-options";
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      {...baseOptions}
      tree={source.pageTree}
      sidebar={{
        tabs: {
          transform(option, node) {
            if (!node.icon) return option;
            return {
              ...option,
              icon: (
                <div className="size-full rounded-lg p-1 [&_svg]:size-full text-fd-primary max-md:bg-fd-primary/10 max-md:border max-md:p-1.5">
                  {node.icon}
                </div>
              ),
            };
          },
        },
      }}
    >
      {children}
    </DocsLayout>
  );
}
