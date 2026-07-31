'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Pinned strategies — the operator's shortlist, shown in the sidebar.
 * Stored in localStorage: the self-hosted app is single-operator, and pins
 * are workstation preference, not research state.
 */

const STORAGE_KEY = 'midas.pinned-strategies';
const listeners = new Set<() => void>();
let cache: string[] = [];
let cacheRaw: string | null = null;

function read(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(ids: string[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function usePinnedStrategies(): { pinned: string[]; isPinned: (id: string) => boolean; toggle: (id: string) => void } {
  const pinned = useSyncExternalStore(subscribe, read, () => cache);

  const toggle = useCallback((id: string) => {
    const current = read();
    write(current.includes(id) ? current.filter((p) => p !== id) : [...current, id]);
  }, []);

  const isPinned = useCallback((id: string) => pinned.includes(id), [pinned]);

  return { pinned, isPinned, toggle };
}
