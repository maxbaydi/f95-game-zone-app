# ADR 0007: Safe Cloud Library Delete Queue

## context

The additive cloud library catalog introduced cross-device continuity, but delete semantics stayed under-specified:

- deleting a game locally did not reliably remove it from the account-level cloud library
- deleting while signed out or offline could not guarantee later cloud cleanup
- broad matching during cloud cleanup risked deleting the wrong entry when identity was weak
- a plain catalog read had already shown how dangerous hidden cloud-side mutations can be

The product requirement is no longer additive-only for delete. A user who explicitly removes a game from the library expects that entry to be removed from the account catalog too.

## decision

Introduce a persistent main-process delete queue for cloud library removal and restrict remote deletion to safe identifiers only.

The design now has three rules:

1. Local delete queues cloud delete intent first
   - before destructive local removal, the app stores a pending cloud-library delete request in SQLite
   - if local removal fails, the queued request is rolled back
   - if local removal succeeds, the queued request is processed immediately when authenticated, or later on startup/sign-in

2. Cloud delete matches by exact aliases and strong identity only
   - exact derived identity aliases are allowed: `atlas:*`, `f95:*`, `site:*`, and exact `title:*|creator:*` aliases
   - strong field matches are allowed: `atlasId`, `f95Id`, `siteUrl`
   - broad fallback deletion by normalized `title + creator` comparison is not allowed

3. Pending deletes are processed before catalog sync
   - startup/sign-in/manual cloud sync flush pending deletes first
   - catalog sync then runs against the cleaned remote manifest

## alternatives

1. Fire cloud delete directly and skip persistence.
   Rejected because sign-out, offline, or transient network failures would silently leave orphaned cloud entries.

2. Delete by fuzzy `title + creator` matching.
   Rejected because delete is destructive and must not remove sibling entries on weak similarity.

3. Keep additive behavior and never delete remotely.
   Rejected because it violates explicit user intent for full library removal.

## consequences

Positive:

- explicit library deletion now has an account-level path instead of being local-only
- delete survives offline/sign-out scenarios without losing intent
- destructive cloud cleanup is safer because weak fuzzy matching is gone

Tradeoffs:

- one more SQLite table exists for pending cloud-library deletes
- delete flow is now queue-driven instead of a single immediate remote call
- very old ambiguous title-only cloud aliases may require manual cleanup if they cannot be tied to a stable identity safely
