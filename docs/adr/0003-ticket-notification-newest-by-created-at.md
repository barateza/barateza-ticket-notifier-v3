# Ticket notifications show newest-by-created_at, not an exact delta

A ticket notification lists up to 3 tickets: the search results sorted by
`created_at` descending, rendered with the user's selected fields (default
ID + subject). Clicking opens the newest listed ticket.

**Why:** The poller only knows the count increased by N — the Zendesk search API
does not identify *which* N tickets are new. Exact attribution would require
tracking ticket IDs across every check and diffing (a full history-tracking
feature). Sorting by `created_at` is correct in the overwhelmingly common case
(tickets *created* since last check) and approximately right otherwise. We
accepted the approximation rather than build delta tracking, which is far more
machinery than the feature warrants.

**Consequences:** a ticket that enters the query by status *change* (not
creation) may be listed instead of the genuinely newest arrival, since the delta
can't be pinned precisely. This is rare for the supported queries (`status:new`,
`assignee:none`) and the notification still shows a real matching ticket.

Status: accepted
