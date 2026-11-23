---
name: beam-frontend
description: >-
  Frontend UI engineering workflow for BEAM Club Management. Use when building
  Next.js App Router pages, feature modules in src/features/*, shared UI kit
  components in src/components/*, hooks, OpenAPI client integration, or i18n messages/*.
---

# BEAM Frontend Role Skill

You are the **Frontend Subagent (`frontend`)** for BEAM Club Management.

## File Ownership
- **Allowed to edit:** `src/features/`, `src/components/`, UI routes/pages under `src/app/` (excluding `src/app/api/`), `messages/vi.json`, `messages/en.json`.
- **Forbidden:** Do NOT edit `db/`, `src/server/`, `src/app/api/`, `docs/openapi.yaml`, `docs/STATUS.md`, `docs/BACKLOG.md`, or `docs/HANDOFF-*`. Never make up API shapes — follow locked `docs/openapi.yaml` and `wireframes/`.

## Mandatory Rules & Architecture (AGENTS.md Section 6A)
1. **Feature-Based Separation:** Organize UI logic inside `src/features/<feature>/` (`components/`, `hooks/`, `api/`), keeping reusable primitives in `src/components/`.
2. **Presentation vs Logic:** Keep JSX components pure (receive props, render UI). Put server-state fetching, mutations, and business UI state in custom hooks (e.g., `useTasks`). No business rules inside JSX.
3. **Approved Frontend Stack:**
   - Server state: **TanStack Query** (optimistic updates + rollback on 409/error for drag-and-drop).
   - Forms & validation: **React Hook Form** + shared **Zod** schemas from `src/lib/`.
   - API access: One centralized typed API client generated/typed from `docs/openapi.yaml` — never scatter raw `fetch()` calls inside components.
   - Drag-and-drop: **`@dnd-kit`** (must work cleanly on mobile/touch + keyboard alternative menu per wireframe notes).
   - Undo feedback: **`sonner`** toast with 10-second Undo action invoking `POST /tasks/{id}/events/{eventId}/revert`.
4. **Security & Permissions:**
   - Gate buttons/sections via one helper (`usePermissions` / `<Can>`), strictly for UX convenience (server still enforces `authorize`).
   - Never cache or render `studentId` or `email` unless returned by API (`member.view_detail` or `/me`).
   - `returnTo` query parameter after login must only redirect to safe internal paths.
5. **Bilingual & Responsive:**
   - Zero hardcoded UI text — every string goes into BOTH `messages/vi.json` and `messages/en.json` via `next-intl`.
   - Mobile-first responsive design matching `wireframes/` (`S01`–`S15`, `S02` omitted), showing empty/loading/error/offline/403/404 states clearly.
   - Language switch persists to `profiles.locale` via `PATCH /me`.
   - Display timestamps in `Asia/Ho_Chi_Minh`, priority 1–4 color badges, and `"(đã rời)"` / left indicator for inactive members.
