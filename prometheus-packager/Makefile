ifeq ($(BASIL_DOCKER_TAG),)
  $(error BASIL_DOCKER_TAG is not set)
endif

ifeq ($(ECR_DOCKER_TAG),)
  $(error ECR_DOCKER_TAG is not set)
endif

all: build

build:
	sudo docker build -t $(BASIL_DOCKER_TAG) .
	sudo docker tag $(BASIL_DOCKER_TAG) $(ECR_DOCKER_TAG)
