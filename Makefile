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
REPO_AWS_ECR_URL=406773134706.dkr.ecr.us-east-1.amazonaws.com/strato/
$(info REPO_AWS_ECR_URL is "${REPO_AWS_ECR_URL}")

STACK_RESOLVER=$(shell cat strato/stack.yaml | grep "resolver:" | awk '{print $$2}')
FAKEROOT=$(shell pwd)/.docker-work
STRATODIR=${FAKEROOT}/strato
VAULTDIR=${FAKEROOT}/vault-wrapper
IDENTITYDIR=${FAKEROOT}/identity-provider

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

all: build_all docker-compose eks

build_all: strato apex nginx postgrest prometheus smd marketplace-backend marketplace-ui vault-wrapper vault-nginx identity-provider identity-nginx

.PHONY: strato apex nginx postgrest prometheus smd marketplace-backend marketplace-ui vault-wrapper vault-nginx identity-provider identity-nginx build_buildbase build_common build_common_profiled eks

apex:
	@echo Now building apex...
	BASIL_DOCKER_TAG=${REPO_URL}apex:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}apex:${VERSION} STRATO_VERSION=${VERSION} make --directory=apex/

nginx:
	@echo Now building nginx...
	BASIL_DOCKER_TAG=${REPO_URL}nginx:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}nginx:${VERSION} make --directory=nginx-packager/

postgrest:
	@echo Now building postgrest...
	BASIL_DOCKER_TAG=$(REPO_URL)postgrest:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}postgrest:${VERSION} make --directory=postgrest-packager/

prometheus:
	@echo Now building prometheus...
	BASIL_DOCKER_TAG=$(REPO_URL)prometheus:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}prometheus:${VERSION} make --directory=prometheus-packager/

smd:
	@echo building smd...
	BASIL_DOCKER_TAG=${REPO_URL}smd:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}smd:${VERSION} STRATO_VERSION=${VERSION} make --directory=smd-ui/

marketplace-backend:
	@echo Now building marketplace-backend...
	BASIL_DOCKER_TAG=${REPO_URL}marketplace-backend:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}marketplace-backend:${VERSION} make --directory=marketplace/backend/

marketplace-ui:
	@echo Now building marketplace-ui...
	BASIL_DOCKER_TAG=${REPO_URL}marketplace-ui:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}marketplace-ui:${VERSION} make --directory=marketplace/ui/

eks:
	@echo Now generating eks manifest files
	cd devops/eks/strato && sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' strato-platform-manifest.tpl.yaml > strato-platform-manifest.yaml
	cd devops/eks/vault && sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' eks-vault-deployment.tpl.yaml > eks-vault-deployment.yaml
	#TODO: create eks manifest for identity server
    #cd devops/eks/identity && sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' eks-identity-deployment.tpl.yaml > eks-identity-deployment.yaml

build_buildbase:
	@echo building buildbase...
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=strato-buildbase:${STACK_RESOLVER} - < Dockerfile.buildbase

build_common: build_buildbase
	@echo building haskell libraries and creating directories
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	mkdir -p ${IDENTITYDIR}
	cd strato && stack build \
		--test --no-run-tests \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

build_common_profiled: build_buildbase
	@echo building haskell libraries and creating directories
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	mkdir -p ${IDENTITYDIR}
	cd strato && stack build \
		--profile --work-dir .stack-work-profile \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

pretty: build_buildbase
	@echo formatting STRATO Haskell code...
	cd strato && \
		gen-hie > hie.yaml && \
		ormolu --mode inplace `git ls-files '*.hs'`

hoogle: build_buildbase
	@echo generating and serving STRATO documentation...
	cd strato && \
		stack build --haddock --no-haddock-internal --no-haddock-deps && \
		stack hoogle generate -- --local=${shell cd strato && stack path --local-doc-root} && \
		stack hoogle -- server --local

strato: build_common
	@echo Now building core-strato...
	cp -fr strato/licenses ${STRATODIR}
	cp strato/doit.sh ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}strato:${VERSION} ${REPO_AWS_ECR_URL}strato:${VERSION}

vault-wrapper: build_common
	@echo Now building vault-wrapper...
	cp strato/vault/doit.sh ${VAULTDIR}
	docker build --target vault-wrapper --tag ${REPO_URL}vault-wrapper:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}vault-wrapper:${VERSION} ${REPO_AWS_ECR_URL}vault-wrapper:${VERSION}

vault-nginx:
	@echo Now building vault-nginx...
	BASIL_DOCKER_TAG=${REPO_URL}vault-nginx:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}vault-nginx:${VERSION} make --directory=vault-nginx/

identity-provider: build_common
	@echo Now building Identity Server...
	cp strato/identity-provider/doit.sh ${IDENTITYDIR}
	docker build --target identity-provider --tag ${REPO_URL}identity-provider:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}identity-provider:${VERSION} ${REPO_AWS_ECR_URL}identity-provider:${VERSION}

identity-nginx:
	@echo Now building identity-nginx...
	BASIL_DOCKER_TAG=${REPO_URL}identity-nginx:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}identity-nginx:${VERSION} make --directory=identity-nginx/

docker-compose:
	@echo Now generating docker-compose yml files...
	@echo Creating the image-push-ready docker-compose.push.yml...
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.tpl.yml > docker-compose.push.yml
	sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.tpl.yml > docker-compose.push.ecr.yml
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.vault.tpl.yml > docker-compose.vault.push.yml
	sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.vault.tpl.yml > docker-compose.vault.push.ecr.yml
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.identity.tpl.yml > docker-compose.identity.push.yml
	sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.identity.tpl.yml > docker-compose.identity.push.ecr.yml

	@echo Creating the final docker-compose.yml...
	awk '/build: ./{getline} 1' docker-compose.push.yml > docker-compose.yml
	awk '/build: ./{getline} 1' docker-compose.push.ecr.yml > docker-compose.ecr.yml
	awk '/build: ./{getline} 1' docker-compose.vault.push.yml > docker-compose.vault.yml
	awk '/build: ./{getline} 1' docker-compose.vault.push.ecr.yml > docker-compose.vault.ecr.yml
	awk '/build: ./{getline} 1' docker-compose.identity.push.yml > docker-compose.identity.yml
	awk '/build: ./{getline} 1' docker-compose.identity.push.ecr.yml > docker-compose.identity.ecr.yml

docker-build:
	cp -fr strato/licenses ${STRATODIR}
	cp strato/doit.sh ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}

test:
	@echo ${VERSION}

docker-clean:
	rm -rf ${FAKEROOT}
