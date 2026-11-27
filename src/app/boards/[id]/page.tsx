import { redirect } from 'next/navigation';

export default async function BoardDetailRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  const resolvedSearch = await searchParams;
  const rawTask = Array.isArray(resolvedSearch.task)
    ? resolvedSearch.task[0]
    : resolvedSearch.task;
  const taskId = typeof rawTask === 'string' && rawTask.trim().length > 0 ? rawTask.trim() : null;
  redirect(taskId ? `/tasks?task=${encodeURIComponent(taskId)}` : '/tasks');
}
