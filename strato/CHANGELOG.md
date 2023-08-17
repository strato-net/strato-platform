# Changelog

![BlockAppsLogos-DarkBG-Horizontal](https://github.com/blockapps/strato-platform/assets/35979292/9d599918-5b53-4655-9d38-439faea97c60)


All notable changes to STRATO will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


BlockApps engineers - for more context, see [here](https://blockappsdev.slack.com/docs/T0884V9NC/F05HWCRMVJR).

All changes merged to `develop` should be documented in "Unreleased" until the version is finalized
so that they could be properly moved to their respective version's subsection.

## [Unreleased]

### Added
- Abstract contract functionality for SolidVM
- Salted contract creations allow for deterministic addresses
- `/transaction/unsigned` endpoint for generating raw transaction inputs
- Bi-directional sync functionality
- Mappings in SolidVM receive their own table in Cirrus
- More lenient P2P disable times to prevent non-validators from being "locked out"
- `make pretty` triggers Ormolu code formatting on STRATO and `gen-hie` for HLS support
### Changed
- `/compile` and `/transaction` endpoints use SolidVM compiler
### Fixed
- Error handle duplicate key violations in `code_ref` table
### Removed
- `bloc22` database removed

## [10.0.0] - TBD
