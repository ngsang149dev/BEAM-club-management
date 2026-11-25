'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DEFAULT_BOARD_FILTERS,
  buildBoardFilterSearchParams,
  hasActiveBoardFilters,
  isBoardDndPaused,
  parseBoardFiltersFromSearchParams,
  type BoardFiltersState,
} from '../filters';

function buildBoardHref(boardId: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `/boards/${boardId}?${qs}` : `/boards/${boardId}`;
}

function useDebouncedSearchSync({
  boardId,
  searchInput,
  urlQ,
  currentQueryString,
  currentTaskId,
  replace,
}: {
  readonly boardId: string;
  readonly searchInput: string;
  readonly urlQ: string;
  readonly currentQueryString: string;
  readonly currentTaskId: string | null;
  readonly replace: (href: string, opts: { scroll: boolean }) => void;
}) {
  useEffect(() => {
    const trimmedInput = searchInput.trim();
    if (trimmedInput === urlQ.trim()) return undefined;
    const timer = setTimeout(() => {
      const base = parseBoardFiltersFromSearchParams(new URLSearchParams(currentQueryString));
      const nextParams = buildBoardFilterSearchParams({ ...base, q: searchInput }, currentTaskId);
      if (nextParams.toString() !== currentQueryString) {
        replace(buildBoardHref(boardId, nextParams), { scroll: false });
      }
    }, trimmedInput === '' ? 0 : 250);
    return () => clearTimeout(timer);
  }, [boardId, currentQueryString, currentTaskId, replace, searchInput, urlQ]);
}

export function useBoardFilters(boardId: string) {
  const router = useRouter();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const urlFilters = parseBoardFiltersFromSearchParams(searchParams);
  const currentQueryString = searchParams.toString();
  const currentTaskId = searchParams.get('task');

  const [searchInput, setSearchInput] = useState(urlFilters.q);
  const [prevUrlQ, setPrevUrlQ] = useState(urlFilters.q);
  if (urlFilters.q !== prevUrlQ) {
    setPrevUrlQ(urlFilters.q);
    setSearchInput(urlFilters.q);
  }

  useDebouncedSearchSync({
    boardId,
    searchInput,
    urlQ: urlFilters.q,
    currentQueryString,
    currentTaskId,
    replace: router.replace,
  });

  const replaceUrlFilters = (nextFilters: BoardFiltersState) => {
    const nextParams = buildBoardFilterSearchParams(nextFilters, currentTaskId);
    if (nextParams.toString() !== currentQueryString) {
      router.replace(buildBoardHref(boardId, nextParams), { scroll: false });
    }
  };

  const filters: BoardFiltersState = { ...urlFilters, q: searchInput };
  const updateFilters = (patch: Partial<BoardFiltersState>) => {
    if ('q' in patch && Object.keys(patch).length === 1) {
      setSearchInput(patch.q ?? '');
      return;
    }
    const nextState: BoardFiltersState = { ...filters, ...patch };
    if ('q' in patch) setSearchInput(nextState.q);
    replaceUrlFilters(nextState);
  };

  const resetFilters = () => {
    setSearchInput('');
    replaceUrlFilters(DEFAULT_BOARD_FILTERS);
  };

  const clearTaskParam = () => {
    const nextParams = new URLSearchParams(currentQueryString);
    if (!nextParams.has('task')) return;
    nextParams.delete('task');
    router.replace(buildBoardHref(boardId, nextParams), { scroll: false });
  };

  return {
    filters,
    queryFilters: urlFilters,
    hasActiveFilters: hasActiveBoardFilters(filters),
    dndPaused: isBoardDndPaused(filters),
    queryDndPaused: isBoardDndPaused(urlFilters),
    updateFilters,
    resetFilters,
    clearTaskParam,
  };
}
