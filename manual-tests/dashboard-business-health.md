# Dashboard Business Health manual QA

- Demo desktop: confirm the score and status render, concise Pro-level signals appear, no billing advert appears, and the stored Demo billing state is unchanged.
- Starter desktop: confirm the score/status and only high-level Starter snapshot signals appear; no forecast values, score breakdown, trends, recommendations, methodology, or upgrade advert appear.
- Pro desktop: confirm no more than three signals appear, including authoritative forecast/obligation values only when available.
- Empty Starter: confirm “Not enough data yet” and the shared add-record explanation appear without a fake score or broken values.
- Mobile/narrow layout: confirm the panel, score/status, signals, and 44px-tall link stack without horizontal overflow.
- Score reconciliation: with identical records and date, confirm Dashboard score/status exactly match Business Insights.
- Business Insights link: activate it with keyboard and pointer and confirm it opens `/business-insights.html`.
- Report regression: confirm Trial Balance and Balance Sheet are absent only from Dashboard cards and remain in Accounting navigation with their existing Pro gating and calculations.
- Failure states: block one insights collection, then all insights sources/access; confirm partial messaging or the non-blocking unavailable state while other Dashboard KPIs/charts continue.
- Browser diagnostics: confirm no unexpected console errors, failed AI/OpenAI requests, accounting writes, or journal/Firestore mutations.

