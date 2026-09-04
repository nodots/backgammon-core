# Development Workflow Rules

## Communication

### Stuck Detection

If I spend more than 2 minutes on infrastructure issues, debugging environment problems, or repeatedly failing at the same task without making progress toward the user's actual goal, I MUST notify the user immediately with:

- "⚠️ **I'M STUCK**: [brief description of what I'm stuck on]"
- "🎯 **SUGGESTED APPROACH**: [alternative approach]"
- "❓ **USER INPUT NEEDED**: [what decision or help I need]"

This prevents wasting time on tangential issues and keeps focus on the main objective.

## Testing and Quality Assurance

### Write the Failing Test First

The test is written before the fix and must fail against the pre-change tree, then pass after. A test written against already-fixed code proves the code runs, not that the bug is gone. Every bug fix ships a regression fixture built from the real failing input — the production position ID or payload, not an approximation of one.

Never gate a test behind an environment flag nothing sets: a suite that has never executed is not a gate. Read the skip count as a finding — this package's suites differ by machine (the CI runner passes the native addon suites and skips the gnubg-binary suites; the Linux box is the reverse), so neither environment runs everything and no single run justifies a coverage claim.

TypeScript compilation errors in tests are test failures. Fix them, never exclude them.

### Declared Dependency Ranges

Code using a new `@nodots/backgammon-types` symbol needs the declared **range** bumped, not just a lockfile refresh. A range that still satisfies the old locked version means npm never moves, `npm ci` obeys the lock, and CI dies in `tsc` while developer machines pass on a hand-refreshed tree. This package's `development` branch was red for three days in July 2026 for exactly this reason. `npm install --package-lock-only` cannot fix it — change the range.

### Test Requirements

All tests must pass before reporting that a task is completed. If any tests fail after implementing changes, iterate on the solution until all tests pass. Run the test suite and fix any failures before considering the task done.

### Bug Status Clarity

When reporting on bugs, be explicitly clear about the current status using these exact terms:

- "🔍 **BUG DISCOVERED**" - when a bug has been found and documented but not yet fixed
- "🔧 **BUG FIXED**" - when a bug has been resolved and verified through testing
- "🧪 **BUG INVESTIGATION**" - when actively debugging but root cause not yet identified
- "✅ **BUG VERIFIED RESOLVED**" - when fix has been tested and confirmed working

Never use ambiguous language that could confuse discovery with resolution.

## Environment Management

### API Server Management

ALWAYS kill existing API server processes before starting the server. Multiple running instances cause port conflicts and unpredictable behavior. Before starting the API server:

1. Navigate to `api` directory
2. Run `npm run kill-port` to kill processes on port 3000 (uses the package.json script)
3. Check for any remaining ts-node/nodemon processes with `ps aux | grep -E "(ts-node|nodemon)" | grep -v grep`
4. Kill any remaining processes if found
5. Start the server with `npm start` (not npm run dev - that script doesn't exist)

This prevents port conflicts, ensures clean server state, and avoids multiple concurrent API instances that can cause simulation hangs.

### Directory Verification

ALWAYS verify the current directory before running terminal commands. Use `pwd` or check the last terminal cwd to ensure you're in the correct directory (e.g., api for API commands, core for core commands). If in the wrong directory, navigate to the correct one before executing commands. This prevents file not found errors and ensures commands run in the intended context.

## API Server Information

The API server routes are `<hostname>:<port>/api/v1/<route>`
