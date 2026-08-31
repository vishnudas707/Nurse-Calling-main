"use client";

import { useCallback, useEffect, useState } from "react";
import { getOrganisationId } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://20.163.9.187:5001";

/**
 * One organisation, several devices. A hospital runs one login but wants the
 * ward on 2408202601 and the ward on 2408202603 looked at separately, so every
 * page is narrowed by a "scope": either a hardware ID or a floor number.
 *
 * `value: ""` means the whole organisation, which is what an organisation with
 * a single device sees and never has to think about.
 */
export type ScopeBasis = "hid" | "floor";
export type Scope = { basis: ScopeBasis; value: string };

export const ALL_SCOPE: Scope = { basis: "hid", value: "" };

/**
 * Scopes are per organisation and per slot. Slot "primary" is the one the
 * Dashboard's top pane, Reports and Settings share, so picking a device in one
 * place carries to the others. Slot "secondary" belongs to the Dashboard's
 * bottom pane alone - it is a comparison view, not the app-wide scope.
 */
export type ScopeSlot = "primary" | "secondary";

const SCOPE_EVENT = "nursecall:scope";

function storageKey(slot: ScopeSlot, orgId: string) {
  return `scope:${slot}:${orgId}`;
}

function readScope(slot: ScopeSlot): Scope {
  if (typeof window === "undefined") return ALL_SCOPE;
  const orgId = getOrganisationId();
  if (!orgId) return ALL_SCOPE;
  try {
    const raw = window.localStorage.getItem(storageKey(slot, orgId));
    if (!raw) return ALL_SCOPE;
    const parsed = JSON.parse(raw) as Scope;
    if (parsed?.basis !== "hid" && parsed?.basis !== "floor") return ALL_SCOPE;
    return { basis: parsed.basis, value: String(parsed.value ?? "") };
  } catch {
    return ALL_SCOPE;
  }
}

function writeScope(slot: ScopeSlot, scope: Scope) {
  if (typeof window === "undefined") return;
  const orgId = getOrganisationId();
  if (!orgId) return;
  try {
    window.localStorage.setItem(storageKey(slot, orgId), JSON.stringify(scope));
  } catch {
    // A blocked localStorage only costs the selection between visits.
  }
  // `storage` fires in other tabs but never in this one, so the pages mounted
  // here are told directly.
  window.dispatchEvent(new CustomEvent(SCOPE_EVENT, { detail: { slot, scope } }));
}

/** The scope for one slot, kept in step across pages, tabs and components. */
export function useScope(slot: ScopeSlot = "primary"): [Scope, (next: Scope) => void] {
  // Starts at ALL_SCOPE on both server and first client render; the stored
  // value is adopted in the effect below so hydration cannot mismatch.
  const [scope, setScopeState] = useState<Scope>(ALL_SCOPE);

  useEffect(() => {
    setScopeState(readScope(slot));

    const onScopeEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail as { slot: ScopeSlot; scope: Scope } | undefined;
      if (detail?.slot === slot) setScopeState(detail.scope);
    };
    const onStorage = () => setScopeState(readScope(slot));

    window.addEventListener(SCOPE_EVENT, onScopeEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SCOPE_EVENT, onScopeEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, [slot]);

  const setScope = useCallback(
    (next: Scope) => {
      setScopeState(next);
      writeScope(slot, next);
    },
    [slot]
  );

  return [scope, setScope];
}

/** `&hid=...` / `&floor=...` for the calls endpoints; empty for "All". */
export function scopeQuery(scope: Scope): string {
  if (!scope.value) return "";
  return scope.basis === "hid"
    ? `&hid=${encodeURIComponent(scope.value)}`
    : `&floor=${encodeURIComponent(scope.value)}`;
}

/** Client-side counterpart of scopeQuery, for lists already in memory. */
export function matchesScope(
  item: { hid?: string | number | null; floor?: string | number | null },
  scope: Scope
): boolean {
  if (!scope.value) return true;
  if (scope.basis === "hid") return String(item?.hid ?? "") === scope.value;
  return String(item?.floor ?? "") === scope.value;
}

export function describeScope(scope: Scope): string {
  if (!scope.value) return "All devices";
  return scope.basis === "hid" ? `HID ${scope.value}` : `Floor ${scope.value}`;
}

/**
 * The nav bar shows devices and floors in one dropdown rather than a basis
 * toggle plus a value, so a scope has to survive a round trip through a single
 * option value. "" is the whole organisation.
 */
export function scopeToOptionValue(scope: Scope): string {
  return scope.value ? `${scope.basis}:${scope.value}` : "";
}

export function scopeFromOptionValue(value: string): Scope {
  if (!value) return ALL_SCOPE;
  const separator = value.indexOf(":");
  if (separator < 0) return ALL_SCOPE;
  const basis = value.slice(0, separator);
  if (basis !== "hid" && basis !== "floor") return ALL_SCOPE;
  return { basis, value: value.slice(separator + 1) };
}

export type ScopeOptions = { hids: string[]; floors: string[]; isLoading: boolean };

// The nav bar asks for these on every page, and the Dashboard asks again for
// its second pane. Cache per organisation so that costs one pair of requests,
// not one per mounted component.
type OptionsCache = { orgId: string; options: ScopeOptions; ts: number };
let optionsCache: OptionsCache | null = null;
let optionsInFlight: { orgId: string; promise: Promise<ScopeOptions> } | null = null;
const OPTIONS_CACHE_MS = 5 * 60 * 1000;

/** Drops the cache so the next mount refetches - call after editing rooms. */
export function invalidateScopeOptions() {
  optionsCache = null;
  optionsInFlight = null;
}

/**
 * The devices and floors this organisation actually has. HIDs come from the
 * organisation's registered list so a device with no rooms yet is still
 * selectable; floors can only come from the rooms.
 */
async function loadScopeOptions(orgId: string): Promise<ScopeOptions> {
  const org = encodeURIComponent(orgId);
  const [orgResp, roomsResp] = await Promise.all([
    fetch(`${API_BASE}/api/organisations/${org}`),
    fetch(`${API_BASE}/api/rooms?organisationId=${org}`),
  ]);
  const orgData = await orgResp.json().catch(() => null);
  const roomsData = await roomsResp.json().catch(() => null);

  const registered: string[] = Array.isArray(orgData?.data?.hids)
    ? orgData.data.hids.map(String)
    : orgData?.data?.hid != null
      ? [String(orgData.data.hid)]
      : [];
  const rooms: { hid?: unknown; floor?: unknown }[] = Array.isArray(roomsData?.data)
    ? roomsData.data
    : [];

  const hids = Array.from(
    new Set([
      ...registered,
      // A room may carry a HID the organisation list has since dropped;
      // without it that room's calls would be unreachable in every view.
      ...rooms.map((room) => String(room?.hid ?? "")),
    ])
  )
    .filter(Boolean)
    .sort();
  const floors = Array.from(new Set(rooms.map((room) => String(room?.floor ?? ""))))
    .filter((floor) => floor !== "" && floor !== "0")
    .sort((a, b) => Number(a) - Number(b));

  return { hids, floors, isLoading: false };
}

export function useScopeOptions(): ScopeOptions {
  const [options, setOptions] = useState<ScopeOptions>({ hids: [], floors: [], isLoading: true });

  useEffect(() => {
    let alive = true;
    const orgId = getOrganisationId();
    if (!orgId) {
      setOptions({ hids: [], floors: [], isLoading: false });
      return;
    }

    if (optionsCache && optionsCache.orgId === orgId && Date.now() - optionsCache.ts < OPTIONS_CACHE_MS) {
      setOptions(optionsCache.options);
      return;
    }

    // Components mounting together share one request rather than racing.
    if (!optionsInFlight || optionsInFlight.orgId !== orgId) {
      optionsInFlight = { orgId, promise: loadScopeOptions(orgId) };
    }
    optionsInFlight.promise
      .then((loaded) => {
        optionsCache = { orgId, options: loaded, ts: Date.now() };
        optionsInFlight = null;
        if (alive) setOptions(loaded);
      })
      .catch((err) => {
        optionsInFlight = null;
        console.error("Failed to load scope options", err);
        if (alive) setOptions({ hids: [], floors: [], isLoading: false });
      });

    return () => {
      alive = false;
    };
  }, []);

  return options;
}
