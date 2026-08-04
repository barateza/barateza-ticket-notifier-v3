# Off-hours hard pause with baseline reset, evaluated per tick

Outside configured working hours the extension does not poll endpoints, fire
notifications, or allow manual refreshes — and when the schedule resumes, the
first poll silently re-baselines each endpoint's count instead of notifying
about everything that accumulated while paused.

**Why:** The user set working hours precisely because they want zero awareness of
tickets outside that window (colleagues can pick them up). A silent-polling
model was rejected because it still churns the API and invites a notification
storm on resume; a catch-up notification was rejected because the user wants a
fresh baseline, not a recap of what they already missed.

**Mechanics:** one periodic `ticketCheck` alarm remains the sole driver; each
tick evaluates "is now inside a window" and skips all work when not. The
off→on transition is detected at the tick and triggers the baseline reset.
Dedicated boundary alarms (schedule one at 09:00, one at 18:00) were considered
and rejected: they require rescheduling on every settings/timezone/DST change,
multi-day gap handling, and alarm-count limits — the per-tick evaluation costs
nothing measurable and has no scheduling failure surface.

Status: accepted
