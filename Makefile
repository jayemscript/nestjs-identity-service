.PHONY: dev lint test test-e2e verify

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
