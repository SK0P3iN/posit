---
title: Media library nested folders, bulk delete, and trash purge pattern
date: 2026-08-05
category: architecture-patterns
module: media library
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - Extending Postiz media library with nested folders, bulk delete, or trash views
  - Implementing soft-delete trash with async storage purge via a new Temporal workflow
  - "Deleting media still referenced by posts (Post.image JSON), settings MediaDto, or FK consumers"
  - Designing restore behavior that returns items to the library without reattaching post references
  - Marking posts with mediaMissing after confirmed in-use delete
tags:
  - temporal
  - media-library
  - soft-delete
  - bulk-delete
  - trash-purge
  - nested-folders
  - media-missing
  - warn-and-allow
related_components:
  - background_job
  - database
---

# Media library nested folders, bulk delete, and trash purge pattern

## Context

Postiz is adding media library organization and safe bulk delete on local branch `feat/media-folders-bulk-delete`. As of 2026-08-05 the branch tip matches `main` and the feature exists as uncommitted working-tree changes (not yet committed or opened as a PR). The work spans schema, backend service/repository layers, a new Temporal purge workflow, and frontend library UI versus embeddable picker modes. Product authority lives in `docs/plans/2026-08-04-001-feat-media-folders-bulk-delete-plan.md`.

The data model introduces nested folders and trash semantics. `Media` rows gain optional `folderId` and nullable `deletedAt` for soft-delete (`libraries/nestjs-libraries/src/database/prisma/schema.prisma:217-220`). `MediaFolder` is a self-referential tree via `parentId`, also soft-deleted with `deletedAt` (`schema.prisma:240-256`). `MediaUsageHistory` records attach/delete events per media item (`schema.prisma:258-270`). Posts expose `mediaMissing` so the UI can flag drafts whose media references were stripped during delete (`schema.prisma:456-457`).

Browsing supports two modes in the standalone library UI: **flat** (folder filter chips — all, unfiled, or a specific folder) and **drill-in** (navigate into a folder subtree). Flat with filters is the default. Repository filtering maps `unfiled === true` to `folderId: null`, otherwise scopes to a given `folderId` when provided.

Delete is two-phase: **soft-delete** moves items to trash (sets `deletedAt`, keeps storage objects), and **hard purge** removes storage files then deletes DB rows after a retention window.

## Guidance

### Soft-delete, trash, and restore

- Single and bulk media delete call `softDeleteMediaMany`, which sets `deletedAt` without touching storage.
- Folder delete collects the root plus all descendant folder IDs, soft-deletes contained media, then soft-deletes the folder subtree.
- Trash listing queries rows where `deletedAt` is not null.
- Restore clears `deletedAt` on media and folders. If a media item's folder is still trashed, restore moves it to unfiled (`folderId: null`). Folder restore walks the deleted subtree and bulk-restores trashed media inside restored folders.
- Restore does **not** reattach stripped post references and does **not** clear `Post.mediaMissing`. `stripMediaFromPosts` is the sole writer of `mediaMissing: true` in the delete flow.

### Storage removal only on hard purge

- Soft-delete paths never call `removeFile`.
- Hard purge runs through `MediaService.purgeMedia`: load media, call storage `removeFile` for path and thumbnail, then hard-delete the row (after clearing FK relations such as user pictures / OAuth apps / agencies).
- In the working tree, Cloudflare R2 `removeFile` sends `DeleteObjectCommand` (`libraries/nestjs-libraries/src/upload/cloudflare.storage.ts:161-176`). On `main`, Cloudflare delete is still a no-op; treat reliable storage deletion as pending until this work is committed, merged, and deployed.

### Temporal trash purge workflow (new workflow only)

Per project rule, never edit existing workflow or activity signatures in place. This feature adds a **new** workflow rather than modifying `missingPostWorkflow`.

- `mediaTrashPurgeWorkflow` runs `purgeExpiredMediaTrash` once, then loops with `sleep('1 day')` — mirroring `missingPostWorkflow`'s initial run + sleep loop (`apps/orchestrator/src/workflows/media.trash.purge.workflow.ts:13-18`, `missing.post.workflow.ts:13-18`).
- The activity purges media trashed past the retention window via `MediaService.purgeMedia`, then hard-deletes expired folder rows.
- Export from the orchestrator workflows index, register `MediaActivity` in orchestrator `AppModule`, and start the workflow from `InfiniteWorkflowRegister` when `RUN_CRON` is set.

### In-use detection and warn-and-allow delete

Before soft-delete, `MediaService.getMediaUsage` builds a consumer list:

1. **Posts** — editable posts (`DRAFT`, `QUEUE`, `ERROR`) whose `image` or `settings` JSON may reference the media IDs. Parse `Post.image` as a JSON array of `{ id, path }` objects; recursively collect MediaDto-shaped objects from `settings`.
2. **FK holders** — `User`, `OAuthApp`, and `SocialMediaAgency` picture relations on each media row.

If any consumer exists and `confirm` is false, bulk or folder delete returns `{ requiresConfirm: true, ...usage }` without deleting. On confirm, `PostsRepository.stripMediaFromPosts` removes matching IDs from `image`/`settings` and sets `mediaMissing: true`, then soft-delete proceeds.

### Layering and dependency direction

Follow DTO → Controller → Service → Repository. `MediaService` uses `MediaRepository` for media/folder persistence and `PostsRepository` directly for `stripMediaFromPosts` — avoiding a `MediaService ↔ PostsService` circular dependency (`media.service.ts:17`, `25`, `239`).

### Usage filters and frontend conventions

- **unused** — media not currently attached (post JSON + FK consumers).
- **detached** — present in `MediaUsageHistory` but not currently attached.
- Each SWR data source is its own hook (`useMediaList`, `useMediaFolders`, `useMediaTrash`, …).
- Picker embed (`standalone={false}`) hides trash, usage filters, bulk delete, and folder cascade delete; standalone library shows the full chrome.

## Why This Matters

Production users share a media library across scheduled posts, profile pictures, OAuth branding, and agency assets. Soft-delete with restore gives a safety net; warn-and-allow with consumer listing makes in-use deletes conscious. Separating soft-delete from storage purge keeps objects restorable until the Temporal retention job runs. The new-workflow-only Temporal rule protects in-flight executions across deploys.

## When to Apply

1. Adding deletable shared assets referenced from JSON blobs or polymorphic FKs — scan all surfaces, warn when in use, strip refs on confirm.
2. Introducing hierarchical organization to a flat list — optional `folderId`, dual browse, cascade subtree delete/restore.
3. Trash with delayed purge — soft-delete column + restore API + hard-purge path that calls storage `removeFile`.
4. Retention cleanup — **new** Temporal workflow with sleep loop; do not mutate existing workflow signatures.
5. Splitting full management UI from embed pickers — gate destructive ops behind `standalone` (or equivalent).
6. Avoiding service cycles — inject `PostsRepository` into `MediaService` rather than `PostsService` when media delete must mutate posts.

Do **not** call storage `removeFile` on soft-delete. Do **not** edit `missingPostWorkflow` (or other existing workflow/activity signatures) to add purge logic.

## Examples

### Bulk delete with in-use warning

Frontend POSTs `{ ids: [...] }` to `/media/bulk`. Service finds a `QUEUE` post referencing a settings MediaDto → `{ requiresConfirm: true, consumers: [...] }`. On `confirm: true`, strip refs, set `mediaMissing: true`, soft-delete media (`media.service.ts:229-253`).

### Cascade folder delete and restore

Deleting folder `A` with child `B` soft-deletes the descendant folder set and contained media. Restoring `A` restores the subtree and trashed media in those folders. Posts stripped during delete stay `mediaMissing: true`.

### Automatic purge after retention

With `RUN_CRON`, `mediaTrashPurgeWorkflow` starts (`infinite.workflow.register.ts`). Daily activity purges expired trash via `purgeMedia` (storage + DB), then hard-deletes expired folders.

### Picker vs library page

Composer picker: attach-only, no trash/bulk/cascade. Library route: `standalone={true}` with full trash, bulk delete, folder delete, and usage filters.

## Related

- Plan: [Media Folders and Bulk Delete](../../plans/2026-08-04-001-feat-media-folders-bulk-delete-plan.md)
- Local branch / working tree (as of 2026-08-05, uncommitted relative to `main`): `feat/media-folders-bulk-delete`
