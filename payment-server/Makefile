ifeq ($(BASIL_DOCKER_TAG),)
  $(error BASIL_DOCKER_TAG is not set)
endif

ifeq ($(ECR_DOCKER_TAG),)
  $(error ECR_DOCKER_TAG is not set)
endif

all: build

build:
	mkdir -p dapp/mercata-base-contracts dapp/items
	cp -r ../marketplace/backend/dapp/mercata-base-contracts/Templates dapp/mercata-base-contracts/
	cp -r ../marketplace/backend/dapp/items/contracts dapp/items/
	docker build -t $(BASIL_DOCKER_TAG) .
	docker tag $(BASIL_DOCKER_TAG) $(ECR_DOCKER_TAG)
	rm -rf dapp