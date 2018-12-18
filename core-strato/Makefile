BASILWORK=$(shell pwd)/.basil-work
STACKWORK=$(BASILWORK)/stack
FAKEROOT=$(BASILWORK)/fakeroot
STRATOHOME=$(FAKEROOT)/var/lib/strato
LIBHOME=$(FAKEROOT)/var/lib
LICENSE_DIR=$(FAKEROOT)/licenses
LICENSE_SOURCE_DIR=$(LICENSE_DIR)/sources
DOCKER_DUMMY=/tmp/$(shell whoami)/docker-dummy-core

all: build_docker clean

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(FAKEROOT)/usr/lib
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(STRATOHOME)
	mkdir -p $(LICENSE_SOURCE_DIR)
	mkdir -p $(DOCKER_DUMMY)

build_haskell: prebuild
	stack setup
	stack install --local-bin-path=$(FAKEROOT)/usr/bin
	stack test --no-run-tests test-suite

build_haskell_profiled: prebuild build_buildbase
	stack setup
	stack install --profile --work-dir .stack-work-profile --local-bin-path=$(FAKEROOT)/usr/bin
	stack test    --profile --work-dir .stack-work-profile --no-run-tests test-suite

build_deploybase: prebuild
	cp -f Dockerfile.deploybase $(DOCKER_DUMMY)
	cp -fr licenses/* ${LICENSE_DIR}
	docker build -t strato-deploybase:latest -f $(DOCKER_DUMMY)/Dockerfile.deploybase $(DOCKER_DUMMY)
	rm -f $(DOCKER_DUMMY)/Dockerfile.deploybase

build_docker: build_deploybase build_haskell
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(LIBHOME)
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
	rm -rf $(DOCKER_DUMMY)
