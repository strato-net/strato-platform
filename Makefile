.PHONY: test

test:
	echo "checking for ethereum test suite"
	if [ -d "test-suite/tests" ]; then \
	    echo ".. tests already exists"; \
	else \
	    git clone https://github.com/ethereum/tests.git test-suite/tests; \
	fi
	stack test test-suite/
