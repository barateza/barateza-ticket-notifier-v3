# Ticket Monitor

A Chrome extension that polls ticket queues on Zendesk and Jira (JSM) sites and notifies the user via sound and browser notifications when new tickets arrive. The user is a support agent who wants to be interrupted *only* during times they choose.

## Language

### Monitoring

**Ticket**:
A customer request tracked by a provider — a Zendesk ticket or a Jira issue/request. The umbrella term used across all UI and notifications.
_Avoid_: issue, request, item, case

**Monitor**:
A configured URL whose matching-ticket count is polled on a schedule; the product's unit of configuration. Each monitor has its own stored ticket count used to detect new tickets.
_Avoid_: endpoint, watcher, subscription

**Provider**:
A ticket system the extension can monitor — `zendesk` or `jira` — identified by the `provider` field on each monitor.
_Avoid_: source, platform, backend

**Site**:
A single provider instance: a Zendesk subdomain (`foo.zendesk.com`) or a Jira Cloud site (`bar.atlassian.net`). Credentials are held per site.
_Avoid_: instance, tenant, account

**Query**:
The search expression a monitor watches — a Zendesk search query or a Jira JQL query — embedded in the monitor's URL.
_Avoid_: filter, saved search

**Jira / JSM**:
Jira Cloud, the provider behind service-desk sites; "JSM" (Jira Service Management) is its service-desk tier name, kept for marketing copy. The provider id is `jira`, never `jsm`.
_Avoid_: JSM (as a provider id)

**Ticket Notification**:
A browser notification for a detected count increase on a monitor. Shows a `list` of up to 3 newest tickets plus the total count. Clicking a ticket notification opens the newest listed ticket's page (in Zendesk; for Jira, the ticket's page on the Jira site), not the search results URL. The popup notification queue stores the same ticket list.

Each list row renders the fields the user selected in settings from: ID, Subject, Priority, Status — in fixed order, default ID + Subject. `requester` is deliberately excluded because the Zendesk search results only carry `requester_id`, not the name (fetching names would cost an extra API call per ticket).

The 3 shown tickets are the search results sorted by `created_at` descending — an approximation of "the new ones", since the count delta cannot be attributed to specific tickets without full history diffing. The poller appends `per_page=5` to the Zendesk endpoint URL (if absent) to keep the payload small; it only needs the top few results.

Click behavior: clicking the Chrome notification opens the newest listed ticket's page (Chrome click events are per-notification, so a single target is chosen). Clicking an item in the popup's notification queue opens *that* item's ticket, since the popup queue is our own UI and stores the full ticket list per entry.

When the search response reports a count increase but returns no usable `results`, the notification falls back to the legacy count-only format (and click falls back to the search URL) — the count is the primary signal, ticket names are enrichment and degrade gracefully rather than swallowing the event.

The number of listed tickets is fixed at 3 (an OS notification-height limit, not a preference); the popup queue is the unbounded escape hatch. Sound plays once per notification regardless of how many tickets arrived — the sound signals "something happened", the notification body carries what.
_Avoid_: count notification, alert

### Schedule

**Working Hours**:
A user-defined schedule: a set of days of the week (any subset), each with one or more time windows (start + end, wall-clock in the user's timezone), during which the extension polls and notifies. Outside these windows the extension is paused.
_Avoid_: business hours, office hours, schedule

**Window**:
One contiguous on-interval within a working day, defined by a start and end time.
End may be *before* start, meaning the window crosses midnight and ends the
following day at that time (e.g. 22:00–06:00 = Tuesday 22:00 → Wednesday 06:00).
The data model stores windows per day as a list so multiple windows (e.g. a lunch
break) can be added later without restructuring. The UI currently exposes one
window per day.
_Avoid_: time slot, range

**Hard Pause**:
The behavior outside working hours: the extension does not poll endpoints and
does not fire notifications. Counts and badge remain as they were when the pause
began.
_Avoid_: snooze (snooze is a separate, manual, duration-based pause)

**Baseline Reset**:
When the schedule transitions from off-hours to on-hours, the stored ticket count
for each monitor is treated as unset: the first poll of the new working period
only records the current count, without comparing to the pre-pause count and
without notifying. Only tickets arriving after that first poll trigger
notifications.
_Avoid_: catch-up, backfill, missed tickets

**Snooze**:
A manual, user-initiated pause of notifications for a fixed duration (or
indefinitely). Independent of working hours: snooze suppresses notifications even
inside working hours, and a finite snooze automatically clears when it expires
(quietly, even if it expires during off-hours). Working hours never clear a
snooze — a snooze set deliberately is the user's explicit choice.
_Avoid_: pause, mute

**Schedule Timezone**:
The timezone the working-hours schedule is evaluated in. Auto-detected from the
machine (`Intl.DateTimeFormat().resolvedOptions().timeZone`) with a manual
override stored in settings. While an override is set it wins; clearing it
returns to follow-the-machine. When the machine's timezone changes (travel, DST),
the schedule follows the machine — evaluated freshly at every tick.
_Avoid_: timezone setting

**Off-hours Manual Refresh**:
Manual "refresh now" requests are suppressed while outside working hours; the
popup explains why instead. Off-hours polling happens only via the automatic
tick, which skips all work until the schedule resumes.
_Avoid_: manual refresh exemption

**Schedule Status Banner**:
A read-only status line in the popup header showing the schedule state at a
glance: "Working hours: 09:00–18:00 Mon–Fri · active" when on-hours, or
"Outside working hours — resumes Mon 09:00" when off-hours. When both the
schedule and a snooze are quiet, the banner lists both reasons. Read-only: the
enable/disable toggle lives in the settings section, not the banner.
_Avoid_: schedule indicator, working-hours banner

**Working Hours Toggle**:
The settings switch that enables or disables the working-hours schedule
(opt-in, off by default). When off, the extension behaves exactly as before —
always polls and notifies within any active snooze. When on but with no days
configured (an empty schedule), it behaves as always off-hours — the banner
explains why and settings hints "Select at least one day to activate".
_Avoid_: enable switch, schedule toggle
