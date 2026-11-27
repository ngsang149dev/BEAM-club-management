'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/features/shared/api/client';
import { TASKS_QUERY_KEYS, useTaskDepartmentsQuery } from '@/features/tasks/hooks/useTasks';
import {
  getTodayVnIso,
  getYearIsoBounds,
  type CalendarDeadlineFilter,
} from '../calendar-math';

const VALID_DEADLINE_FILTERS = new Set<CalendarDeadlineFilter>([
  'all',
  'overdue',
  'urgent',
  'soon',
  'safe',
  'done',
]);

export interface CalendarUrlState {
  readonly year: number;
  readonly deadlineFilter: CalendarDeadlineFilter;
  readonly departmentId: string;
  readonly q: string;
  readonly selectedTaskId: string | null;
}

export function parseCalendarYear(raw: string | null, fallbackYear: number): number {
  if (!raw) return fallbackYear;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : fallbackYear;
}

export function parseCalendarDeadlineFilter(raw: string | null): CalendarDeadlineFilter {
  if (raw && VALID_DEADLINE_FILTERS.has(raw as CalendarDeadlineFilter)) {
    return raw as CalendarDeadlineFilter;
  }
  return 'all';
}

export function parseCalendarUrlState(
  searchParams: Pick<URLSearchParams, 'get'>,
  defaultYear: number
): CalendarUrlState {
  const rawTask = searchParams.get('task')?.trim() ?? '';
  return {
    year: parseCalendarYear(searchParams.get('year'), defaultYear),
    deadlineFilter: parseCalendarDeadlineFilter(searchParams.get('deadline')),
    departmentId: searchParams.get('dept')?.trim() ?? '',
    q: searchParams.get('q') ?? '',
    selectedTaskId: rawTask.length > 0 ? rawTask : null,
  };
}

export function buildCalendarSearchParams(
  state: CalendarUrlState,
  defaultYear: number
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.year !== defaultYear) params.set('year', String(state.year));
  if (state.deadlineFilter !== 'all') params.set('deadline', state.deadlineFilter);
  if (state.departmentId) params.set('dept', state.departmentId);
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.selectedTaskId) params.set('task', state.selectedTaskId);
  return params;
}

function buildCalendarHref(params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : '/tasks';
}

export function buildCalendarTasksQueryParams(
  year: number,
  departmentId: string,
  q: string
) {
  const { fromIso, toIso } = getYearIsoBounds(year);
  const trimmedQ = q.trim();
  return {
    from: fromIso,
    to: toIso,
    ...(departmentId ? { departmentId } : {}),
    ...(trimmedQ ? { q: trimmedQ } : {}),
    sortBy: 'dueAt' as const,
    sortOrder: 'asc' as const,
    limit: 200,
  };
}

function useDebouncedCalendarQuerySync(params: {
  readonly searchInput: string;
  readonly urlQ: string;
  readonly currentQueryString: string;
  readonly defaultYear: number;
  readonly replace: (href: string, opts: { scroll: boolean }) => void;
}) {
  const { searchInput, urlQ, currentQueryString, defaultYear, replace } = params;
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === urlQ.trim()) return undefined;
    const timer = setTimeout(() => {
      const current = parseCalendarUrlState(new URLSearchParams(currentQueryString), defaultYear);
      const next = buildCalendarSearchParams({ ...current, q: searchInput }, defaultYear);
      if (next.toString() !== currentQueryString) {
        replace(buildCalendarHref(next), { scroll: false });
      }
    }, trimmed === '' ? 0 : 250);
    return () => clearTimeout(timer);
  }, [searchInput, urlQ, currentQueryString, defaultYear, replace]);
}

export function useCalendarTasks() {
  const router = useRouter();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const todayIso = getTodayVnIso();
  const currentVnYear = Number.parseInt(todayIso.slice(0, 4), 10);
  const urlState = parseCalendarUrlState(searchParams, currentVnYear);
  const currentQueryString = searchParams.toString();

  const [searchInput, setSearchInput] = useState(urlState.q);
  const [prevUrlQ, setPrevUrlQ] = useState(urlState.q);
  if (urlState.q !== prevUrlQ) {
    setPrevUrlQ(urlState.q);
    setSearchInput(urlState.q);
  }

  useDebouncedCalendarQuerySync({
    searchInput,
    urlQ: urlState.q,
    currentQueryString,
    defaultYear: currentVnYear,
    replace: router.replace,
  });

  const updateUrl = (patch: Partial<CalendarUrlState>) => {
    const nextState: CalendarUrlState = { ...urlState, ...patch };
    const nextParams = buildCalendarSearchParams(nextState, currentVnYear);
    if (nextParams.toString() !== currentQueryString) {
      router.replace(buildCalendarHref(nextParams), { scroll: false });
    }
  };

  const trimmedQ = urlState.q.trim();
  const tasksQuery = useQuery({
    queryKey: [
      ...TASKS_QUERY_KEYS.calendarRoot,
      { year: urlState.year, departmentId: urlState.departmentId, q: trimmedQ },
    ],
    queryFn: ({ signal }) =>
      apiFetch('/tasks', {
        query: buildCalendarTasksQueryParams(urlState.year, urlState.departmentId, trimmedQ),
        signal,
      }),
  });
  const departmentsQuery = useTaskDepartmentsQuery(true);

  return {
    todayIso,
    currentVnYear,
    state: { ...urlState, q: searchInput },
    tasksQuery,
    departments: departmentsQuery.data?.items ?? [],
    setYear: (year: number) => updateUrl({ year }),
    setDeadlineFilter: (deadlineFilter: CalendarDeadlineFilter) => updateUrl({ deadlineFilter }),
    setDepartmentId: (departmentId: string) => updateUrl({ departmentId }),
    setSearchQuery: (q: string) => setSearchInput(q),
    openTaskModal: (selectedTaskId: string) => updateUrl({ selectedTaskId }),
    closeTaskModal: () => updateUrl({ selectedTaskId: null }),
    resetFilters: () => {
      setSearchInput('');
      updateUrl({ deadlineFilter: 'all', departmentId: '', q: '' });
    },
  };
}
