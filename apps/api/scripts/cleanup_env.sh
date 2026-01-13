#!/bin/bash
set -e

echo "Cleaning up environment files..."

# Environment file location
ENV_FILE="/var/app/current/.env"

# Remove .env file if it exists
if [ -f "$ENV_FILE" ]; then
	echo "Removing environment file: $ENV_FILE"
	rm -f "$ENV_FILE"
	echo "  ✓ Environment file removed"
else
	echo "  ℹ No environment file to clean up"
fi

# Also clean up any backup .env files
if [ -f "/var/app/previous/.env" ]; then
	echo "Removing previous environment file..."
	rm -f "/var/app/previous/.env"
	echo "  ✓ Previous environment file removed"
fi

echo "Environment cleanup completed successfully"
