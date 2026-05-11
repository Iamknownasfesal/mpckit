"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Kicker } from "./kicker";

export function PageHeader({
  kicker,
  title,
  description,
  right,
}: {
  kicker: string;
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="relative mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="space-y-3">
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <Kicker>{kicker}</Kicker>
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: "easeOut" }}
          className="text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[44px]"
        >
          {title}
        </motion.h1>
        {description ? (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12, ease: "easeOut" }}
            className="max-w-prose text-pretty text-[15px] leading-relaxed text-muted-foreground"
          >
            {description}
          </motion.p>
        ) : null}
      </div>
      {right ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: "easeOut" }}
          className="shrink-0"
        >
          {right}
        </motion.div>
      ) : null}
    </header>
  );
}
