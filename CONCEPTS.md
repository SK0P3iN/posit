# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Media library

### Media
An uploaded file (image, video, or similar) owned by an Organization and selectable when composing posts or setting profile/branding pictures.

### Media Folder
A named container for Media within an Organization. Folders may nest under other folders. Media not placed in a folder are unfiled and still appear in the All view.

### Media Trash
Soft-deleted Media and Media Folders that have left the live library but remain restorable until purge. Soft-delete does not remove objects from storage.

### Media Purge
Hard removal of trashed Media after the retention window: delete storage objects, then delete database rows (and expired folder rows). Scheduled by a dedicated Temporal workflow — existing workflows are never mutated in place to add this behavior.

### In-Use Media
Media still referenced by editable posts (via post image JSON or settings JSON MediaDto-shaped objects) or by live foreign-key consumers (user pictures, OAuth app pictures, agency logos). Deleting in-use media is warn-and-allow: the product lists consumers, then proceeds only on confirm.

### Media Missing
A post flag set when confirmed delete of in-use media strips that media from the post's image/settings references. Restore of the media into the library does not clear the flag or reattach the media; the flag clears when the user attaches media to the post again.

### Media Usage History
A record that Media was attached to a post or deleted from the library. Powers filters such as unused versus previously used but not currently attached.

## Public review playback

### Public Review Link
The unauthenticated shareable preview of a scheduled post, used by external reviewers to evaluate the post before (or without) publishing through Postiz's authenticated app.

### Shared Video Player
The controlled video surface for reviewable playback: muted autoplay when the browser allows it, plus unmute, play/pause, scrub, and volume. Distinct from muted-loop compose embeds that have no review chrome.

### Muted Autoplay Helper
A compact image-or-video embed that autoplays muted and loops without playback chrome. Used in provider compose previews and similar fixed layouts; not sufficient when a reviewer must hear or scrub the video.
*Avoid:* treating this helper as the public-review player

## Publish reliability

### Auth Hold
A scheduled-post outcome used when the destination channel needs reconnect: the post stays in QUEUE (not ERROR) with reconnect guidance, typically signaled by `integration.refreshNeeded` and an optional `AUTH_HOLD:` error prefix for tooltips.

### Unconfirmed Publish
A post outcome used when Postiz sent work to a channel but could not confirm the remote publish finished. Stored as ERROR with an `UNCONFIRMED:` error prefix. Manual republish is blocked until the user confirms already-live or the system reconciles; blind Retry risks duplicates.

### Capability-Based Refresh
Proactive access-token refresh runs only for integrations whose provider can actually refresh; channels without a refresh API stay reconnect-led.

### In-Flight Publish Marker
Transient resume state for a publish that has started an irreversible remote step but has not yet been confirmed as PUBLISHED. Used so a retry resumes the same remote attempt instead of creating a duplicate. Markers expire and are cleared on terminal ERROR or successful publish.

### Workflow Versioning
The rule that Temporal workflows already shipped on main are left unchanged; new behavior ships as a new versioned workflow (and new activity signatures when parameters change), with callers updated to start the new version.

## Social inbox

### Social Inbox
The unified in-app surface for reading and replying to engagement (comments, DMs, mentions) across connected accounts that expose those APIs.

### Inbox Item
A normalized engagement record in the Social Inbox: channel, type, author, body, timestamps, read state, optional link to a Postiz post, and whether reply is allowed.

## Instagram publishing

### Story Companion Post
A separate, independently tracked post created when a Feed post's "also share to Story" option is enabled. Republishes the same media as a Story; it is not Instagram's native reshare-to-Story sticker, and it links back to its originating Feed post through a dedicated relation kept separate from thread parent/child links. Its lifecycle cascades from the parent Feed post: an edit regenerates it, a delete or untoggle cancels it while it is still pending, and it is left alone once published or already in flight with the provider. It counts against the organization's post quota like any other scheduled post.

## Relationships

- An Organization owns many Media and Media Folders.
- A Media Folder may contain Media and child Media Folders.
- Live library → Media Trash (soft-delete) → Media Purge (hard delete + storage).
- In-Use Media delete on confirm can set Media Missing on affected posts; library restore does not heal those posts.
- Auth Hold and Unconfirmed Publish are publish outcomes distinct from ordinary ERROR; Capability-Based Refresh governs which channels refresh quietly.
- In-Flight Publish Marker bridges irreversible provider steps until confirmation; Workflow Versioning protects running Temporal executions when publish behavior changes.
- An Organization’s Social Inbox contains Inbox Items sourced from connected channels.
- A Story Companion Post links to its originating Feed post via a dedicated relation, not the thread parent/child link.
