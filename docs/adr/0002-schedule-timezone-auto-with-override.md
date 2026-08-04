# Schedule timezone: auto-detected with manual override, follows the machine

The working-hours schedule is evaluated in the machine's current timezone
(`Intl.DateTimeFormat().resolvedOptions().timeZone`), with an optional manual
override stored in settings that wins while set.

**Why:** Auto-detect alone silently misbehaves when the laptop's zone doesn't
match the user's work schedule; an explicit picker alone forces every user
through a dropdown for no benefit. The follow-the-machine behavior means travel
and DST shift the schedule with the user — the least surprising default — while
the override covers the "machine zone ≠ work zone" case. Each tick re-reads the
zone, so changes apply immediately without rescheduling logic.

Status: accepted
