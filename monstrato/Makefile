ifeq ($(BASIL_DOCKER_TAG),)
  $(error BASIL_DOCKER_TAG is not set)
endif

ifneq ($(USE_DOCKER_BUILD_ENV),)
ifeq ($(BASIL_HOME),)
  $(error USE_DOCKER_BUILD_ENV is set, but BASIL_HOME is not)
endif
endif

BASILWORK=.basil-work
BASILWORK_ABS=$(shell pwd)/$(BASILWORK)
STACKWORK=$(BASILWORK)/stack
NPMWORK=$(BASILWORK)/npm
FAKEROOT=$(BASILWORK)/fakeroot
STRATOHOME=$(FAKEROOT)/var/lib/strato
LIBHOME=$(FAKEROOT)/var/lib
BUILDER_HOME=$(BASIL_HOME)/blockapps/builder_home
DOCKER_FAKEROOT=/workspace/.basil-work/fakeroot
DOCKER_SHELL=docker run -i --rm --ulimit nofile=65535 -v $(shell pwd):/workspace -v $(BUILDER_HOME):/root strato-buildbase:latest bash -c

EXTRADEPS=doit.sh mkCoinbase
ifeq ($(USE_DOCKER_BUILD_ENV),)
STACKFLAGS=
else
STACKFLAGS=--allow-different-user
endif
BUILD_HASKELL=stack setup $(STACKFLAGS) && stack install $(STACKFLAGS) --local-bin-path=$(FAKEROOT)/usr/bin && stack test --no-run-tests test-suite \
    # --profile --ghc-options="-fprof-auto -rtsopts"
all: build_docker

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(NPMWORK)
	mkdir -p $(FAKEROOT)/usr/lib
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(STRATOHOME)
	mkdir -p /tmp/docker-dummy

build_haskell: build_buildbase prebuild
ifeq ($(USE_DOCKER_BUILD_ENV),)
	$(BUILD_HASKELL)
else
	$(DOCKER_SHELL) "$(BUILD_HASKELL)"
endif

build_deploybase: prebuild
	cp -f Dockerfile.deploybase /tmp/docker-dummy
	docker build -t strato-deploybase:latest -f /tmp/docker-dummy/Dockerfile.deploybase /tmp/docker-dummy
	rm -f /tmp/docker-dummy/Dockerfile.deploybase

build_buildbase: build_deploybase prebuild
ifeq ($(USE_DOCKER_BUILD_ENV),)
	echo "USE_DOCKER_BUILD_ENV not set, not building buildbase" ;
else
	cp -f Dockerfile.buildbase stack.yaml /tmp/docker-dummy
	docker build -t strato-buildbase:latest -f /tmp/docker-dummy/Dockerfile.buildbase /tmp/docker-dummy
	rm -f /tmp/docker-dummy/Dockerfile.buildbase /tmp/docker-dummy/stack.yaml
	mkdir -p $(BUILDER_HOME)
	$(DOCKER_SHELL) "chown root:root /root" || true
endif

pull_blockapps_js: prebuild
	( \
		cd $(NPMWORK)                        && \
		mkdir -p node_modules                && \
		npm install blockapps-js yaml-parser    \
	)

build_docker: build_deploybase build_haskell pull_blockapps_js
	cp -f Dockerfile $(FAKEROOT)
	cp -f $(EXTRADEPS) $(LIBHOME)
	rm -rf $(STRATOHOME/node_modules) && cp -R $(NPMWORK)/node_modules $(LIBHOME)/node_modules
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)
