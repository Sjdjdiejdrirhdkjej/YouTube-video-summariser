# AGENTS.md

## Build, Lint, and Test Commands

- **Build**: Run `npm run build` to compile the project.
- **Lint**: Run `npm run lint` to check for code style issues.
- **Test**: Run `npm run test` to execute the test suite.
- **Single Test**: Run `npm run test <test-file-path>` to execute a specific test file.

## Changelog

- **Always update `CHANGELOG.md`** when making user-facing changes, new features, bug fixes, or breaking changes.
- Follow [Keep a Changelog](https://keepachangelog.com/) format with `Added`, `Changed`, `Fixed`, `Removed` sections under date/version headers.
- Group entries under `[Unreleased]` until a version is cut.
- The changelog is publicly visible at the `/changelog` route in the app (served via `GET /api/changelog`), so keep entries clear and user-friendly.

## Code Style Guidelines

### Imports
- Use absolute imports for external dependencies.
- Use relative imports for local files.
- Group imports into categories: external dependencies, internal modules, and local files.

### Formatting
- Use Prettier for code formatting.
- Configure Prettier to use single quotes, trailing commas, and semicolons.

### Types
- Use TypeScript for type checking.
- Enable strict null checks and strict function types.

### Naming Conventions
- Use camelCase for variables and functions.
- Use PascalCase for classes and interfaces.
- Use kebab-case for file names.

### Error Handling
- Use try/catch blocks for error handling.
- Throw specific error types with meaningful messages.

## Cursor and Copilot Rules

- **Cursor Rules**: Not available.
- **Copilot Rules**: Not available.