import React from "react";
import { X } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export interface TabDescriptor {
  id: number;
  label: string;
}

/**
 * Top strip of open resource views — each tab is a (cluster, resource-kind)
 * pair, like browser tabs. Left-click switches, the ✕ closes, and right-click
 * opens a context menu (close / close others / close to the right / close all).
 */
export function ResourceTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
}: {
  tabs: TabDescriptor[];
  activeId: number | null;
  onActivate: (id: number) => void;
  onClose: (id: number) => void;
  onCloseOthers: (id: number) => void;
  onCloseToRight: (id: number) => void;
  onCloseAll: () => void;
}) {
  return (
    <div
      role="tablist"
      className="fl-ctabs"
    >
      {tabs.map((t, i) => {
        const active = t.id === activeId;
        const isLast = i === tabs.length - 1;
        return (
          <ContextMenu key={t.id}>
            <ContextMenuTrigger asChild>
              <div
                role="tab"
                aria-selected={active}
                onClick={() => onActivate(t.id)}
                className={cn(
                  "fl-ctab",
                  active ? "fl-ctab--active" : "fl-ctab--inactive",
                )}
              >
                <span>{t.label}</span>
                <button
                  aria-label={`Close ${t.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.id);
                  }}
                  className="fl-ctab__close"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onClose(t.id)}>Close</ContextMenuItem>
              <ContextMenuItem disabled={tabs.length <= 1} onSelect={() => onCloseOthers(t.id)}>
                Close Others
              </ContextMenuItem>
              <ContextMenuItem disabled={isLast} onSelect={() => onCloseToRight(t.id)}>
                Close to the Right
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={onCloseAll}>Close All</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}
