#!/bin/bash
set -e

echo "Running after install tasks..."

# Navigate to application directory
cd /var/app/current

# Ensure scripts are executable
chmod +x scripts/*.sh

# Load infrastructure environment variables (AWS_REGION, ECR_REPOSITORY)
if [ -f .env.infra ]; then
	echo "Loading infrastructure environment variables..."
	set -a # automatically export all variables
	source .env.infra
	set +a
else
	echo "ERROR: .env.infra file not found"
	exit 1
fi

# Login to ECR to pull the Docker image
if [ -n "$AWS_REGION" ] && [ -n "$ECR_REPOSITORY" ]; then
	echo "Logging in to Amazon ECR..."
	echo "Region: ${AWS_REGION}"
	echo "Repository: ${ECR_REPOSITORY}"
	aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REPOSITORY%:*}
else
	echo "ERROR: AWS_REGION or ECR_REPOSITORY not set in .env file"
	exit 1
fi

# Pull the latest Docker image
if [ -f docker-compose.prod.yml ]; then
	echo "Pulling Docker images..."
	docker-compose -f docker-compose.prod.yml pull
fi

# Clean up dangling images
echo "Cleaning up dangling Docker images..."
docker image prune -f || true

echo "After install completed successfully"
