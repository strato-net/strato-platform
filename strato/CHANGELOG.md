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
- `/eth/v1.2/identity` endpoint that will call identity server
- UserRegistry and User Contract on the genesis block
- Connection to Cirrus Certificate table added in the API
- Abstract contracts generate Cirrus tables
- Derived contracts are inserted as rows in abstract tables
- Support for imports from addresses in SolidVM
- More lenient P2P disable times to prevent non-validators from being "locked out"
- Proper behavior of virtual, override, and visibility modifiers
- Introduction of `es6` and `strict` pragmas, which enable braced and qualified import syntax, and proper visibility modifier behavior, respectively.
- `address.derive(salt, args)` function which allows SolidVM to derive salted contracts without creating them
- SolidVM built-in `create` and `create2` functions which allows for the explicit creation of contracts within SolidVM contracts

### Changed
- `/compile` and `/transaction` endpoints use SolidVM compiler
- POST `/transaction` calls redirected to the corresponding User contract
### Fixed
- Error handle duplicate key violations in `code_ref` table
### Removed
- `bloc22` database removed

## [10.0.0] - TBD
