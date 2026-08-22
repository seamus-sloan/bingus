# End of session: keep the docs true

Before finishing any piece of work (and always before committing), check whether the change made any documentation stale, and fix it in the same commit:

- **README.md** — stack, scripts table, layout, getting-started steps.
- **CLAUDE.md** — commands, layout, conventions.
- **docs/architecture.md** — this is the contract for how the frontend talks to the backend. Any change to routes, socket events, the shared protocol, ports, package layout, tooling (lint/test/build), or CI **must** be reflected here.
- **docs/** generally — design docs describing behavior that no longer exists get updated or deleted, not left to rot.

The bar: a new contributor (human or agent) reading only the docs should not be misled about anything the session changed. If the docs were already accurate, this rule costs nothing — do not pad docs with filler to look thorough.
