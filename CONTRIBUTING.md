# Contributing

## Develop

```bash
npm test
node scripts/bump-version.mjs --check
claude plugin validate .
```

Tests use `tests/fake-grok.mjs` so CI does not need a live Grok install.

## Version bump

```bash
npm run bump-version -- 1.0.1
npm test
```

This updates `package.json`, `package-lock.json`, `plugins/grok/.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.

## Release checklist

1. All tests green: `npm test`
2. Manifests consistent: `node scripts/bump-version.mjs --check <version>`
3. Marketplace validates: `claude plugin validate .`
4. Tag: `git tag v1.0.0 && git push origin v1.0.0`
5. GitHub Release notes (install commands + highlights)
6. Optional manual smoke (real Grok):

```
/plugin marketplace add dylan-buck/grokbuild-plugin-cc
/plugin install grok@grokbuild
/reload-plugins
/grok:setup
/grok:review
/grok:rescue --read summarize package.json in one sentence
```

## Layout

Matches [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc):

```
.claude-plugin/marketplace.json
plugins/grok/   # plugin source
scripts/        # repo tooling
tests/
```
