"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { shoppingService } from "@/lib/services/shopping-service";
import { getActiveHousehold } from "@/lib/services/active-household";
import { publishToHousehold } from "@/lib/realtime/publish";

/**
 * Signal a shopping change over realtime (Module 8 / ADR-0009). Best-effort,
 * no-op unless REALTIME_PROVIDER=azure. `listId` is an optional hint — the
 * client refetches on any shopping.changed regardless.
 */
async function notifyShopping(listId?: string) {
  const { id } = await getActiveHousehold();
  await publishToHousehold(id, { type: "shopping.changed", listId });
}

const AddSchema = z.object({
  listId: z.string().uuid(),
  ingredient: z.string().min(1).max(200),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
});

export async function addItemAction(input: z.infer<typeof AddSchema>) {
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  await shoppingService.addItem(parsed.data);
  revalidatePath("/shopping");
  await notifyShopping(parsed.data.listId);
  return { ok: true as const };
}

export async function toggleCheckedAction(itemId: string, checked: boolean) {
  await shoppingService.toggleChecked(itemId, checked);
  revalidatePath("/shopping");
  await notifyShopping();
}

export async function removeItemAction(itemId: string) {
  await shoppingService.removeItem(itemId);
  revalidatePath("/shopping");
  await notifyShopping();
}

const ListIdSchema = z.object({ listId: z.string().uuid() });
const ListCheckedSchema = ListIdSchema.extend({ checked: z.boolean() });

export async function setAllCheckedAction(input: z.infer<typeof ListCheckedSchema>) {
  const parsed = ListCheckedSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const updated = await shoppingService.setAllChecked(parsed.data.listId, parsed.data.checked);
  revalidatePath("/shopping");
  await notifyShopping(parsed.data.listId);
  return { ok: true as const, updated };
}

export async function clearListAction(input: z.infer<typeof ListIdSchema>) {
  const parsed = ListIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const deleted = await shoppingService.clearList(parsed.data.listId);
  revalidatePath("/shopping");
  await notifyShopping(parsed.data.listId);
  return { ok: true as const, deleted };
}

export async function setActiveListAction(input: z.infer<typeof ListIdSchema>) {
  const parsed = ListIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  await shoppingService.setActive(parsed.data.listId);
  revalidatePath("/shopping");
  return { ok: true as const };
}

const RenameListSchema = ListIdSchema.extend({ name: z.string().min(1).max(100) });

export async function renameListAction(input: z.infer<typeof RenameListSchema>) {
  const parsed = RenameListSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  await shoppingService.renameList(parsed.data.listId, parsed.data.name);
  revalidatePath("/shopping");
  return { ok: true as const };
}

export async function deleteListAction(input: z.infer<typeof ListIdSchema>) {
  const parsed = ListIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  await shoppingService.deleteList(parsed.data.listId);
  revalidatePath("/shopping");
  return { ok: true as const };
}

const CreateListSchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
});

export async function createListAction(input: z.infer<typeof CreateListSchema>) {
  const parsed = CreateListSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const id = await shoppingService.createList(parsed.data);
  revalidatePath("/shopping");
  return { ok: true as const, listId: id };
}
