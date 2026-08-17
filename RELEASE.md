# Release checklist (dsh-factory)

1. **Write** — done: package.json (dsh.bundle + cordis.patch.yml + lib/index.js + lib/{catalog,scorer,format}.js).
2. **Verify** — `node --check` on lib/*.js; `node test/scorer.test.mjs` + `node test/format.test.mjs` (main-module mode, no --test).
3. **Publish npm** — `pwsh scripts/publish-npm.ps1` (reads token from $DSH_HOME/secrets/npm-token.txt).
4. **Topic** — add `dsh-plugin` (+ `deepseek-harness`, `cordis`) to the GitHub repo topics.
5. **awesome PR** — data/plugins/<owner>__<repo>.yml (category: market/dev) + generate-readme.mjs; meet 1-day / 10-commit bar; re-run CI after 24h if needed.
