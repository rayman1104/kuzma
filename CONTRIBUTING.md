# Contributing to Kuzma

Thanks for your interest in contributing!

## Development Setup

1. Install [Bun](https://bun.sh)
2. Clone the repo and install dependencies:

```bash
git clone https://github.com/xmalakhov/kuzma.git
cd kuzma
bun install
```

3. Copy `.env.example` to `.env` and fill in your values
4. Run in dev mode:

```bash
bun run dev
```

## Code Style

We use [Biome](https://biomejs.dev/) for linting. Run before committing:

```bash
bun run lint
bun run lint:fix  # auto-fix
```

## Testing

```bash
bun test
```

All tests must pass before submitting a PR.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure lint and tests pass
4. Submit a PR with a clear description of what you changed and why
