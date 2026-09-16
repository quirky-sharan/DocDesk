# shared/

One source of truth for anything both the server and the browser must agree on.

`brand.json` holds the product and assistant names. **Import it; never write the
names as string literals in JSX or prompts.** The assistant was called "DocDesk
AI" until Phase 7; the product is still DocDesk, only the assistant was renamed.

- server: `require('../../shared/brand.json')`
- client: `import brand from '@shared/brand.json'` (alias in `vite.config.js`)

`actor` is what the receptionist records against every change in the audit
trail. `legacyActor` is what it used to record: rows written before the rename
still say `assistant` and are left alone, because rewriting them would falsify
history. Anything displaying an actor reads through both.
