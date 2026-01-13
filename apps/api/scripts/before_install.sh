#!/bin/bash
set -e

echo "Running before install tasks..."

# Create application directories if they don't exist
mkdir -p /var/app/current
mkdir -p /var/app/previous

# Backup previous deployment
if [ -d "/var/app/current" ] && [ "$(ls -A /var/app/current)" ]; then
	echo "Backing up previous deployment..."
	rm -rf /var/app/previous/*
	cp -r /var/app/current/* /var/app/previous/ || true
fi

# Clean current directory for new deployment
echo "Cleaning current deployment directory..."
rm -rf /var/app/current/*

echo "Before install completed successfully"
