#!/bin/bash
set -e

echo "Validating service..."

# Navigate to application directory
cd /var/app/current/apps/api

COMPOSE_FILE=docker-compose.prod.yml

# Check if compose file exists
if [ ! -f "$COMPOSE_FILE" ]; then
	echo "ERROR: $COMPOSE_FILE not found"
	exit 1
fi

# Get all running containers from docker-compose
CONTAINERS=$(docker-compose -f "$COMPOSE_FILE" ps -q)

if [ -z "$CONTAINERS" ]; then
	echo "ERROR: No containers running"
	exit 1
fi

echo "Validating containers..."

# Check each container
for CID in $CONTAINERS; do
	NAME=$(docker inspect --format='{{.Name}}' "$CID" | sed 's|/||')
	RUNNING=$(docker inspect --format='{{.State.Running}}' "$CID")
	HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CID")

	echo "Checking container: $NAME"

	if [ "$RUNNING" != "true" ]; then
		echo "ERROR: $NAME is not running"
		exit 1
	fi

	# If container has healthcheck, it must be healthy
	if [ "$HEALTH" == "unhealthy" ]; then
		echo "ERROR: $NAME is unhealthy"
		exit 1
	fi

	# If healthcheck is still starting, wait for it
	if [ "$HEALTH" == "starting" ]; then
		echo "Waiting for $NAME health check to complete..."
		MAX_WAIT=60
		WAITED=0
		while [ $WAITED -lt $MAX_WAIT ]; do
			sleep 2
			WAITED=$((WAITED + 2))
			HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CID")

			if [ "$HEALTH" == "healthy" ]; then
				echo "OK: $NAME is now healthy"
				break
			elif [ "$HEALTH" == "unhealthy" ]; then
				echo "ERROR: $NAME became unhealthy"
				exit 1
			fi

			echo "Still waiting... ($WAITED/${MAX_WAIT}s, health=$HEALTH)"
		done

		# Final check after waiting
		if [ "$HEALTH" != "healthy" ] && [ "$HEALTH" != "none" ]; then
			echo "ERROR: $NAME did not become healthy in time (health=$HEALTH)"
			exit 1
		fi
	fi

	echo "✓ OK: $NAME (running=$RUNNING, health=$HEALTH)"
done

echo ""
echo "Service validation completed successfully - All services are running and healthy"
exit 0
