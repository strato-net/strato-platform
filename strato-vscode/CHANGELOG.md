# Change Log

All notable changes to the "strato-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [v0.3.0]

### Added

- Ability to log in to a STRATO Mercata account and access a node from the user identity
- Allow user to select active node from `Nodes` view
- Provide sample configuration file to user

### Fixed

- Ability to handle array arguments in constructors and function calls
- All API calls should use the activeNode configuration field
- Improved error handling when switching networks
- Properly prompt function arguments in correct order
- Properly parse enum values for API request
- Fix `Nodes` view in response to recent Apex changes

### Changed

- General UI/UX improvements
- `Contracts` view shows contracts uploaded by extension
- `Contracts` view allows user to manually insert addresses to list
- Uploading a single contract will not prompt dropdown selection menu

### Removed

- Removed the `Project Management` view and functions
- Removed private chain interaction
- Removed `node` level view in `Contracts` view - only lists by `address`

## [v0.2.0] - 2023-26-05

### Added

- `Run UI`, `Run Server`, `Test UI`, and `Test Server` have been added as commands
- Contract state variables, node information, and contract addresses can be copied to clipboard
- The `Project Management` view has a button to open the extension settings page directly
- Settings configuration options have descriptions
- Commands will output informational message popups for user feedback

### Changed

- Updated to the newest BlockApps logo!
- `Create Project` has become `Import Project`, allowing a user to import their STRATO project into the workspace
- `Build Project` prompts the user for their build directories to install package dependencies

### Deprecated

- Deprecating private chain use, no longer possible from the `Contracts` view
