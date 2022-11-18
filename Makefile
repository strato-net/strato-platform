REPO_URL ?= EMPTY
ifeq ($(REPO),local)
  REPO_URL=
endif
ifeq ($(REPO),private)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps/
endif
ifeq ($(REPO),public)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps-repo/
endif
ifeq ($(REPO_URL),EMPTY)
  $(error REPO not provided or unknown value. Please provide one of the types for REPO var: [local, private, public]. Or custom REPO_URL)
endif
$(info REPO_URL is "${REPO_URL}" (${REPO}))

STACK_RESOLVER=$(shell cat strato/stack.yaml | grep "resolver:" | awk '{print $$2}')
FAKEROOT=$(shell pwd)/.docker-work
STRATODIR=${FAKEROOT}/strato
VAULTDIR=${FAKEROOT}/vault-wrapper

ifndef VERSION
  ifeq ($(REPO),public)
    VERSION = `cat VERSION`
    $(info Using version tag from VERSION file)
  else
    VERSION = `cat VERSION`-`git rev-parse --short HEAD`
  endif
else
  $(info VERSION is "${VERSION}" (overriden with env var))
endif

$(info )

all: build_all docker-compose

build_all: strato apex nginx postgrest prometheus smd vault-wrapper

.PHONY: strato apex nginx postgrest prometheus smd vault-wrapper get_solcs build_buildbase build_common build_common_profiled

apex:
	@echo Now building apex...
	BASIL_DOCKER_TAG=${REPO_URL}apex:${VERSION} STRATO_VERSION=${VERSION} make --directory=apex/

nginx:
	@echo Now building nginx...
	BASIL_DOCKER_TAG=${REPO_URL}nginx:${VERSION} make --directory=nginx-packager/

postgrest:
	@echo Now building postgrest...
	BASIL_DOCKER_TAG=$(REPO_URL)postgrest:${VERSION} make --directory=postgrest-packager/

prometheus:
	@echo Now building prometheus...
	BASIL_DOCKER_TAG=$(REPO_URL)prometheus:${VERSION} make --directory=prometheus-packager/

smd:
	@echo building smd...
	BASIL_DOCKER_TAG=${REPO_URL}smd:${VERSION} STRATO_VERSION=${VERSION} make --directory=smd-ui/

get_solcs:
	@echo checking solcs and pulling them if required...
	@if [ ! -f "${FAKEROOT}/usr/local/bin/solc" ]; then\
		bash -c "\
			mkdir -p ${FAKEROOT}/usr/local/bin ;\
			strato/pull_solc.sh 0.4.25 ${FAKEROOT}/usr/local/bin/solc-0.4 ${FAKEROOT}/license-solc-0.4 ;\
			strato/pull_solc.sh 0.5.2 ${FAKEROOT}/usr/local/bin/solc-0.5 ${FAKEROOT}/license-solc-0.5 ;\
			ln -f ${FAKEROOT}/usr/local/bin/solc-0.4 ${FAKEROOT}/usr/local/bin/solc \
		" ;\
	fi

build_buildbase:
	@echo building buildbase...
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=strato-buildbase:${STACK_RESOLVER} - < Dockerfile.buildbase

build_common: get_solcs build_buildbase
	@echo building haskell libraries and creating directories
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	cd strato && stack build \
		--test --no-run-tests \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

build_common_profiled: get_solcs build_buildbase
	@echo building haskell libraries and creating directories
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	cd strato && stack build \
		--profile --work-dir .stack-work-profile \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

strato: build_common
	@echo Now building core-strato...
	cp -fr strato/licenses ${STRATODIR}
	cp strato/doit.sh ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}

vault-wrapper: build_common
	@echo Now building vault-wrapper...
	cp strato/vault/doit.sh ${VAULTDIR}
	docker build --target vault-wrapper --tag ${REPO_URL}vault-wrapper:${VERSION} --file Dockerfile.multi ${FAKEROOT}

# vault-proxy: build_common
# 	@echo Now building vault-proxy...
# 	cp strato/vault-proxy/doit.sh ${VAULTDIR}
# 	docker build --target vault-proxy --tag ${REPO_URL}vault-proxy:${VERSION} --file Dockerfile.multi ${FAKEROOT}

docker-compose:
	@echo Now generating docker-compose yml files...
	@echo Creating the image-push-ready docker-compose.push.yml...
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.tpl.yml > docker-compose.push.yml
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.vault.tpl.yml > docker-compose.vault.push.yml
	@echo Creating the final docker-compose.yml...
	awk '/build: ./{getline} 1' docker-compose.push.yml > docker-compose.yml
	awk '/build: ./{getline} 1' docker-compose.vault.push.yml > docker-compose.vault.yml

docker-build:
	cp -fr strato/licenses ${STRATODIR}
	cp strato/doit.sh ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}

test:
	@echo ${VERSION}

docker-clean:
	rm -rf ${FAKEROOT}
