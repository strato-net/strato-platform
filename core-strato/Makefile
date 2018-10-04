BASILWORK=$(shell pwd)/.basil-work
STACKWORK=$(BASILWORK)/stack
NPMWORK=$(BASILWORK)/npm
FAKEROOT=$(BASILWORK)/fakeroot
STRATOHOME=$(FAKEROOT)/var/lib/strato
LIBHOME=$(FAKEROOT)/var/lib
LICENSE_DIR=$(FAKEROOT)/licenses
LICENSE_SOURCE_DIR=$(LICENSE_DIR)/sources

all: build_docker clean

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(NPMWORK)
	mkdir -p $(FAKEROOT)/usr/lib
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(STRATOHOME)
	mkdir -p $(LICENSE_SOURCE_DIR)
	mkdir -p /tmp/docker-dummy-core

build_haskell: prebuild
	stack setup
	# installing happy-1.19.8 explicitly to avoid the error while building 3rd party lib "language-javascript-0.6.0.11" - remove when migrated to compiler ghc-8.2.2 in stack.yaml
	stack install --local-bin-path=$(FAKEROOT)/usr/bin happy-1.19.8
	stack install --local-bin-path=$(FAKEROOT)/usr/bin
	stack test --no-run-tests test-suite \
        # --profile --ghc-options="-fprof-auto -rtsopts"

build_deploybase: prebuild
	cp -f Dockerfile.deploybase /tmp/docker-dummy-core
	cp -fr licenses/* ${LICENSE_DIR}
	docker build -t strato-deploybase:latest -f /tmp/docker-dummy-core/Dockerfile.deploybase /tmp/docker-dummy-core
	rm -f /tmp/docker-dummy-core/Dockerfile.deploybase

pull_blockapps_js: prebuild
	( \
		cd $(NPMWORK)                        && \
		mkdir -p node_modules                && \
		npm install blockapps-js yaml-parser    \
	)

build_docker: build_deploybase build_haskell pull_blockapps_js
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(LIBHOME)
	rm -rf $(STRATOHOME/node_modules) && cp -R $(NPMWORK)/node_modules $(LIBHOME)/node_modules
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
	rm -rf /tmp/docker-dummy-core
