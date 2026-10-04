import type { Hex } from "viem";

/** The invite key stays in the client's browser so they can find the link again. */
export function saveInvite(id: bigint, key: Hex) {
  try {
    localStorage.setItem(`till.invite.${id}`, key);
  } catch {}
}
export function loadInvite(id: bigint): Hex | null {
  try {
    return localStorage.getItem(`till.invite.${id}`) as Hex | null;
  } catch {
    return null;
  }
}
/** The key travels after the # so it never reaches a server log. */
export const inviteLink = (id: bigint, key: Hex) => `${window.location.origin}/join/${id}#k=${key.slice(2)}`;

