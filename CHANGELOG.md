# Changelog

All notable changes to this extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project follows Semantic Versioning.

---

## [0.15.0] - 2026-09-24

### Changed

- Improved Previous/Next navigation controls with reliable Codicon rendering.
- Preserved navigation state and correct enable/disable behavior for project occurrences.
- Added additional spacing to the project filter area for improved visual consistency.

---

## [0.14.0] - 2026-09-24

### Added

- Added Previous and Next navigation between occurrences of the selected project in the dependency tree.
- Added automatic expansion of collapsed branches when navigating to a hidden occurrence.
- Added automatic scrolling to center the navigated project occurrence.
- Added non-circular navigation behavior with disabled controls at the beginning and end of the occurrence list.

### Changed

- Added navigation controls next to the Expand/Collapse controls.
- Navigation state resets when a different project is selected.

---

## [0.13.0] - 2026-09-24

### Fixed

- Fixed upstream root projects not being rendered as bold when they depend on the selected project.
- Improved project list width calculation.
- Full project paths are now available without truncation.
- Added spacing after long project names and paths to prevent content from touching the panel edge.

### Changed

- Project list horizontal scrolling now accounts for the longest project name or full project path.

---

## [0.12.0] - 2026-09-23

### Changed

- Reworked the dependency tree layout into independent header and scrollable content panels.
- The tree now has its own scrolling area without overlapping the header.
- Separated the project filter area from the scrollable project list.
- Improved the overall layout consistency and spacing.
- Updated the extension icon.

---

## [0.11.0] - 2026-09-23

### Added

- Added standard VS Code Codicons for extension actions.
- Added a dedicated dependency-tree icon using the `symbol-class` Codicon.
- Added a fixed dependency tree header containing the solution information and actions.

### Changed

- Improved the dependency tree header layout.
- Improved action button sizing and alignment.
- Upstream root projects are now highlighted consistently with their dependency chain.

---

## [0.10.0] - 2026-09-23

### Changed

- Simplified the Selected Project Relations panel.
- Full project path is now displayed only for the selected project.
- Added word wrapping for long project names and paths.
- Improved Direct and Indirect dependency visual distinction.
- Replaced text-based action controls with compact UI controls.
- Improved filter and clear-selection layout.

---

## [0.9.0] - 2026-09-23

### Added

- Added Expand All and Collapse All functionality.
- Added collapsible dependency tree branches.
- Added standard VS Code-style tree navigation behavior.

### Changed

- Updated the extension icon to better represent the dependency tree.
- Improved the project relations panel.
- Improved Direct and Indirect dependency presentation.
- Updated extension metadata for the `CleanEngineering` publisher.

---

## [0.8.0] - 2026-09-23

### Added

- Added dedicated Direct and Indirect dependency styling.
- Direct dependencies are displayed using bold typography.
- Indirect dependencies use regular typography.
- Added clearer dependency relationship statistics.

### Changed

- Added Marketplace-oriented project documentation.
- Added extension support documentation.
- Added changelog and license information.
- Added extension icon metadata.

---

## [0.7.0] - 2026-09-23

### Added

- Added Selected Project Relations panel.
- Added projects that directly or indirectly depend on the selected project.
- Added projects that the selected project directly or indirectly depends on.
- Added Direct and Indirect dependency statistics.
- Added navigation from related projects to their corresponding tree selection.

---

## [0.6.0] - 2026-09-23

### Fixed

- Improved `.slnx` project discovery.
- Projects are now retained even when their project files cannot be resolved immediately.
- Improved support for projects located inside nested Solution folders.
- Improved support for different project types, including SQL Server projects.

### Changed

- Solution project entries are now treated as the authoritative project list.

---

## [0.5.0] - 2026-09-23

### Added

- Added upstream dependency highlighting.
- Projects that depend directly or indirectly on the selected project are now displayed in bold.

### Changed

- The selected project keeps its highlighted background.
- Upstream projects use bold text without the selected-project background.
- Root project styling was refined to distinguish it from the selected project.

---

## [0.4.0] - 2026-09-23

### Added

- Improved `.slnx` parsing for projects located inside nested Solution folders.
- Added support for multiple project types, including `.csproj` and `.sqlproj`.
- Improved project discovery across complex Solution structures.

### Fixed

- Fixed missing projects caused by nested `<Folder>` elements in `.slnx` files.

---

## [0.3.0] - 2026-09-23

### Changed

- Removed project selection from the workflow.
- The extension now requires only a Solution (`.sln` or `.slnx`).
- The complete Solution dependency structure is generated automatically.
- Top-level projects are detected automatically and used as tree roots.

### Added

- Added complete Solution project list.
- Added project filtering.
- Added project selection and highlighting across all tree occurrences.
- Added TXT export with a Save dialog.
- Added recursive dependency visualization.
- Added cycle detection to prevent infinite recursion.

---

## [0.2.0] - 2026-09-23

### Added

- Added Solution and Project selection workflow.
- Added support for `.sln` and `.slnx`.
- Added recursive ProjectReference dependency visualization.
- Added project list and tree-based dependency navigation.

### Fixed

- Improved project path resolution.
- Improved handling of relative project references.

---

## [0.1.2] - 2026-09-23

### Added

- Added explicit Solution selection.
- Added explicit Project selection.
- Added recursive ProjectReference dependency tree.
- Added initial support for `.sln` and `.slnx`.

---

## [0.1.1] - 2026-09-23

### Fixed

- Improved project path canonicalization.
- Improved handling of relative project paths.
- Improved project file resolution.
- Added safer handling of missing project files.

---

## [0.1.0] - 2026-09-23

### Added

- Initial release.
- Added recursive project dependency tree visualization.
- Added Solution project list.
- Added project highlighting.
- Added support for ProjectReference-based dependencies.
- Added initial `.sln` and `.slnx` support.

---

## [Unreleased]

### Planned

- Further usability and visualization improvements based on user feedback.