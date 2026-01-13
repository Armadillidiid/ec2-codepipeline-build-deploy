#!/bin/bash
set -e

echo "Stopping application..."

# Navigate to application directory
cd /var/app/current || exit 0

# Stop docker-compose services if they exist
if [ -f docker-compose.prod.yml ]; then
	echo "Stopping Docker Compose services..."
	docker-compose -f docker-compose.prod.yml down || true
else
	echo "No docker-compose.prod.yml found, skipping..."
fi

echo "Application stopped successfully"
