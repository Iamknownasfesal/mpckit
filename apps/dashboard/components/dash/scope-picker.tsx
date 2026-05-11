"use client";

import { Button } from "@/components/ui/button";
import { SCOPES, type Scope } from "@/lib/scopes";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export function ScopePicker({
  value,
  onChange,
}: {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");

  const selected = SCOPES.filter((s) => value.has(s.id));
  const filtered = useMemo(() => filterScopes(SCOPES, query), [query]);
  const grouped = groupByCategory(filtered);

  function toggle(id: string) {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="space-y-2.5">
      <div className="flex max-h-[120px] flex-wrap items-start content-start gap-1.5 overflow-y-auto rounded-xl border bg-card/40 p-2.5">
        {selected.length === 0 ? (
          <span className="t-mono px-1 py-0.5 text-[11.5px] text-muted-foreground">
            No scopes selected
          </span>
        ) : (
          selected.map((s) => (
            <Chip key={s.id} scope={s} onRemove={() => toggle(s.id)} />
          ))
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          className="ml-auto h-7 shrink-0 gap-1.5 rounded-md px-2 text-xs"
        >
          {open ? "Hide" : selected.length > 0 ? "Edit" : "Pick scopes"}
          {open ? (
            <ChevronUp className="size-3.5 opacity-70" />
          ) : (
            <ChevronDown className="size-3.5 opacity-70" />
          )}
        </Button>
      </div>

      {open ? (
        <div className="overflow-hidden rounded-xl border bg-card/40">
          <div className="flex h-9 items-center gap-2 border-b px-3">
            <Search className="size-3.5 shrink-0 opacity-50" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter capabilities…"
              className="h-9 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
          </div>
          <div
            className="overflow-y-auto p-1.5"
            style={{ maxHeight: "240px", touchAction: "pan-y" }}
          >
            {Object.keys(grouped).length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No matches.
              </div>
            ) : (
              Object.entries(grouped).map(([group, items]) => (
                <div key={group} className="mb-1">
                  <div className="px-2 pb-1 pt-2 t-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {group}
                  </div>
                  <div className="space-y-0.5">
                    {items.map((s) => (
                      <ScopeRow
                        key={s.id}
                        scope={s}
                        active={value.has(s.id)}
                        onToggle={() => toggle(s.id)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between t-mono text-[10.5px] text-muted-foreground">
        <span>
          {selected.length} of {SCOPES.length} capabilities
        </span>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ScopeRow({
  scope,
  active,
  onToggle,
}: {
  scope: Scope;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent",
        active && "bg-primary/10 hover:bg-primary/15",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40",
        )}
      >
        {active ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium">{scope.label}</span>
          <code className="t-mono text-[10px] text-muted-foreground">
            {scope.id}
          </code>
        </div>
        <div className="text-[11px] leading-snug text-muted-foreground">
          {scope.description}
        </div>
      </div>
    </button>
  );
}

function Chip({ scope, onRemove }: { scope: Scope; onRemove: () => void }) {
  return (
    <span className="t-mono inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 py-0.5 pl-2 pr-1 text-[11px] text-primary">
      {scope.id}
      <button
        type="button"
        onClick={onRemove}
        className="grid size-4 place-items-center rounded text-primary/70 transition-colors hover:bg-primary/20 hover:text-primary"
        aria-label={`Remove ${scope.id}`}
      >
        <X className="size-2.5" strokeWidth={2.4} />
      </button>
    </span>
  );
}

function filterScopes(scopes: Scope[], query: string): Scope[] {
  const q = query.trim().toLowerCase();
  if (!q) return scopes;
  return scopes.filter((s) =>
    `${s.id} ${s.label} ${s.description} ${s.group}`.toLowerCase().includes(q),
  );
}

function groupByCategory(scopes: Scope[]): Record<string, Scope[]> {
  const out: Record<string, Scope[]> = {};
  for (const s of scopes) {
    if (!out[s.group]) out[s.group] = [];
    out[s.group].push(s);
  }
  return out;
}
