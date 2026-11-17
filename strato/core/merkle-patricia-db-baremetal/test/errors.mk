.PHONY: test diff-stack
test: diff-stack
	@set -eu; binary=$$(mktemp /tmp/mp-errors.XXXXXX); trap 'rm -f "$$binary"' EXIT; \
	$(CC) -std=c11 -O2 -Wall -Wextra -Werror $(CFLAGS) \
	strato/core/merkle-patricia-db-baremetal/test/Errors.c -lleveldb -lpthread $(LDFLAGS) -o "$$binary"; \
	"$$binary"

diff-stack:
	@set -eu; binary=$$(mktemp /tmp/mp-diff-stack.XXXXXX); trap 'rm -f "$$binary"' EXIT; \
	$(CC) -std=c11 -O2 -Wall -Wextra -Werror $(CFLAGS) \
	strato/core/merkle-patricia-db-baremetal/test/DiffStack.c -lleveldb -lpthread $(LDFLAGS) -o "$$binary"; \
	"$$binary"
