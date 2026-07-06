# Changelog

## [0.10.0](https://github.com/KeyValueSoftwareSystems/agent-opfor/compare/v0.9.0...v0.10.0) (2026-07-06)


### ⚠ BREAKING CHANGES

* **sdk:** switch to apikey values; update sdk e2e tests and examples ([#168](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/168))

### Features

* expand env references in agent target headers ([#169](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/169)) ([605a9b5](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/605a9b5e032d52ffa11da3ce0b372c3c74f037fc))
* stream run lifecycle events as ndjson via a run-listener ([#159](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/159)) ([ccc99dc](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/ccc99dc161121f40ecdaf56182c5bd4c91b99dc1))
* support listing mcp suites from the sdk ([#144](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/144)) ([6b68b42](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/6b68b4292d5f8f9b1a86df1b40dba8c6f02a0769))
* support server-owned session IDs with body/header config ([#167](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/167)) ([121edfd](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/121edfdc1a29d553acad160487feacd794faffb1))


### Bug Fixes

* broken gitleaks ci for fork ([#158](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/158)) ([e0be561](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/e0be561283febd7a237db7677059bb4124f638bb))
* bump zod to ^4.0.0 to satisfy claude-agent-sdk peer dependency ([#148](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/148)) ([bcd970e](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/bcd970e4e53a805386e3a84c439d8d6f96b12264))
* conditional reasoning instruction and stricter section() parsing ([15b598f](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/15b598f64739cae5cf3df529ba3ceb11832ebd9c))
* declare mcp dep, add createRequire banner, fix atlas-data resolution for bundled runners ([#134](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/134)) ([b8ff91f](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/b8ff91fa2032d7cd09b6a9af9f1cf0b65ec61143))
* harden mcp baseline scanner against false negatives and crashes ([#155](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/155)) ([cd36f85](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/cd36f8567fa655217ffe245f9f4c574e6adefc89))
* make agent judge reason before stating its verdict ([3b551c6](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/3b551c68144e0426d86e52b5dc4678eb8ecda259))
* make agent judge reason before stating its verdict ([60dacc8](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/60dacc89a9ee12a3459fd0a7a8dd506007499647))
* make hunt work from a published install ([#157](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/157)) ([ac468ea](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/ac468ea824c4bd6ec63a8e5a9daeff7e54825393))
* rename 'Risk Score' to 'Safety Score' in extension popup ([#133](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/133)) ([4c955a0](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/4c955a0cf202e553a20d57a9f4906d0930cef7b0))
* revert gitleaks trigger from pull_request_target to pull_request ([#161](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/161)) ([ea7315e](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/ea7315e8609b212e98b01b04bd3d00d9342edbd0))
* run gitleaks binary in ci to unblock fork pull requests ([#162](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/162)) ([be307b2](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/be307b27b7fd4880211ab08f20e47b81ecf3f01e))
* use simple tag format for release-please ([9e7a8e6](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/9e7a8e6ede254af8c3ef59e56cdd9942bd20362c))
* validate mcp tool inputs with zod and return actionable errors ([#143](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/143)) ([ad749bc](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/ad749bc917303db92ae1076a6bf97036427c8fa5))


### Refactors

* **sdk:** switch to apikey values; update sdk e2e tests and examples ([#168](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues/168)) ([ed40cea](https://github.com/KeyValueSoftwareSystems/agent-opfor/commit/ed40cea15fcce5837bd172f6d4c2ad89e46c7432))
