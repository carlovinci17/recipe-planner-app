"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database.types";
import {
  createListAction,
  deleteListAction,
  renameListAction,
  setActiveListAction,
} from "./actions";

type List = Tables<"shopping_lists">;

/**
 * Sidebar showing every shopping list in the household, grouped by month
 * for a folder-like browse. Click any list to make it active. The active
 * list is the one rendered in the main column on the right.
 *
 * Lists are grouped by their `created_at` month, oldest months collapsing
 * naturally (newest first). Within a month we sort newest → oldest so a
 * scroll always finds last-made-list at the top.
 */
export function ShoppingListsSidebar({
  householdId,
  lists,
  activeListId,
}: {
  householdId: string;
  lists: List[];
  activeListId: string | null;
}) {
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState<List | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<List | null>(null);

  // Group by month key (YYYY-MM). Sorted month groups descending → newest
  // month at top. Within each group, lists are also newest-first.
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; lists: List[] }>();
    for (const list of lists) {
      const d = new Date(list.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("en-US", { month: "long", year: "numeric" });
      const bucket = map.get(key) ?? { label, lists: [] };
      bucket.lists.push(list);
      map.set(key, bucket);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([, v]) => v);
  }, [lists]);

  function activate(id: string) {
    if (id === activeListId || pending) return;
    start(async () => {
      const result = await setActiveListAction({ listId: id });
      if (!result.ok) toast.error("Couldn't switch list");
    });
  }

  function createNew() {
    start(async () => {
      const result = await createListAction({ householdId });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't create list");
        return;
      }
      toast.success("New list created");
    });
  }

  function commitRename() {
    if (!renaming) return;
    const next = renameValue.trim();
    if (!next || next === renaming.name) {
      setRenaming(null);
      return;
    }
    start(async () => {
      const result = await renameListAction({ listId: renaming.id, name: next });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't rename");
        return;
      }
      toast.success("Renamed");
      setRenaming(null);
    });
  }

  function commitDelete() {
    if (!confirmDelete) return;
    start(async () => {
      const result = await deleteListAction({ listId: confirmDelete.id });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't delete");
        return;
      }
      toast.success("List deleted");
      setConfirmDelete(null);
    });
  }

  return (
    <aside className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Your lists</h2>
          <span className="text-xs text-muted-foreground">({lists.length})</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={createNew}
          disabled={pending}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> New
        </Button>
      </div>

      {lists.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No lists yet — start one with the New button or build from the planner.
        </p>
      ) : (
        <div className="max-h-52 space-y-3 overflow-y-auto md:max-h-none">
          {grouped.map((group) => (
            <div key={group.label} className="space-y-1">
              <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.lists.map((list) => (
                  <li key={list.id}>
                    <ListRow
                      list={list}
                      isActive={list.id === activeListId}
                      onActivate={() => activate(list.id)}
                      onRename={() => {
                        setRenameValue(list.name);
                        setRenaming(list);
                      }}
                      onDelete={() => setConfirmDelete(list)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && !pending && setRenaming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename list</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="List name"
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(null);
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenaming(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={commitRename} disabled={pending || !renameValue.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && !pending && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete list?</DialogTitle>
            <DialogDescription>
              This permanently deletes <span className="font-medium">{confirmDelete?.name}</span>{" "}
              and all of its items. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={commitDelete}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function ListRow({
  list,
  isActive,
  onActivate,
  onRename,
  onDelete,
}: {
  list: List;
  isActive: boolean;
  onActivate: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        className="min-w-0 flex-1 text-left"
        aria-current={isActive ? "true" : undefined}
        title={isActive ? list.name : `Make “${list.name}” the active list`}
      >
        <div className="flex items-center gap-1.5">
          {isActive ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          ) : null}
          <span
            className={cn("truncate", isActive ? "font-medium" : "text-muted-foreground")}
            title={list.name}
          >
            {list.name}
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={onRename}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        aria-label="Rename list"
        title="Rename"
      >
        <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        aria-label="Delete list"
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  );
}
