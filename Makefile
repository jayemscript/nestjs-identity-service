.PHONY: dev lint test test-e2e verify generate_migration empty_migration run_migration show_migration revert_migration

ifeq ($(OS),Windows_NT)
PNPM := cmd.exe /d /c pnpm.cmd
else
PNPM := pnpm
endif

dev:
	$(PNPM) start:dev

build:
	$(PNPM) build

lint:
	$(PNPM) lint

test:
	$(PNPM) test --runInBand

test-e2e:
	$(PNPM) test:e2e --runInBand

verify: lint test test-e2e


MIGRATION_CLI := node --loader ts-node/esm ./src/database/migration-cli.ts

generate_migration:
	$(MIGRATION_CLI) generate

empty_migration:
	$(MIGRATION_CLI) create

run_migration:
	$(MIGRATION_CLI) run

show_migration:
	$(MIGRATION_CLI) show

revert_migration:
	$(MIGRATION_CLI) revert
