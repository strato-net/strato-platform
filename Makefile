.PHONY: test

test:
	echo "checking for ethereum test suite"
	if [ -d "test-suite/tests" ]; then \
	    echo ".. tests already exists"; \
	else \
	    git clone https://github.com/ethereum/tests.git test-suite/tests; \
	fi
	stack test test-suite/


multinode:
	echo "testing multinode tests"
	if [ -d "multinode-test" ]; then \
	  echo "... multinode already checked out"; \
	else \
	  git clone https://github.com/blockapps/multinode-test -b kristoffer multinode-test; \
	fi
	cd multinode-test/
	npm install
	./node_modules/mocha/bin/mocha test/

