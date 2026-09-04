# Nodots Backgammon Project Rules

This directory contains the organized rules and guidelines for the Nodots Backgammon project.

## Rule Categories

### [Backgammon Game Rules](./backgammon-game-rules.md)

- Backgammon board position system
- Unified presentation layer
- Play/move game flow
- Game creation requirements

### [Development Workflow](./development-workflow.md)

- Status updates and communication
- Testing and quality assurance
- Environment management
- API server information

### [Coding Standards](./coding-standards.md)

- Architecture and separation of concerns
- Type safety and dependencies
- Programming style guidelines

## Quick Reference

**CRITICAL CONCEPTS:**

- Dual position numbering system (clockwise/counterclockwise)
- Unified presentation layer for all players
- Game logic separation (core vs API)
- Official types package usage
- Functional programming over imperative

**WORKFLOW:**

- Always kill API server before starting
- Verify directory before running commands
- All tests must pass before completion
- Use exact bug status terminology

**API USAGE:**

- Use `api.*` methods, never raw fetch()
- Use `api.games.start(player1Id, player2Id)` for game creation
- API routes: `<hostname>:<port>/api/v1/<route>`
