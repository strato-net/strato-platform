.PHONY: test

test:
	git clone https://github.com/ethereum/tests.git test-suite/tests
	stack test test-suite/
