# Vendored anti-slop Oxlint plugin

Source repository: `dmmulroy/anti-slop`.

Source commit: unknown. The installed skill bundle is identified by the existing `skills-lock.json` hash `4031728fbe75bdcad6ee3208fd52b5d66e167b056fefee1fa9758e9a6cb9c0c8`.

Installed entry point: `oxlint/anti-slop/index.ts`.

The plugin is registered as `anti-slop` in the repository's `.oxlintrc.json`. Only the requested anti-slop rules are enabled, all at `error`. Oxlint categories and built-in plugins are disabled. The optional Effect plugin was removed because this repository does not use Effect-TS. Native Oxlint rules are intentionally not enabled.
