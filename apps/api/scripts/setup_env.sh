#!/bin/bash
set -e

echo "Setting up environment variables from SSM Parameter Store..."

# Environment name (can be overridden)
ENV_NAME=${ENVIRONMENT:-prod}
APP_NAME=${APP_NAME:-ec2-codepipeline-build-deploy}

# Target .env file location
ENV_FILE="/var/app/current/apps/api/.env"

# Create directory if it doesn't exist
mkdir -p "$(dirname "$ENV_FILE")"

# Clear existing .env file
>"$ENV_FILE"

echo "Fetching parameters from SSM Parameter Store..."
echo "Prefix: /$APP_NAME/$ENV_NAME/"

# Fetch parameters from SSM and write to .env file
aws ssm get-parameters-by-path \
	--path "/$APP_NAME/$ENV_NAME/" \
	--with-decryption \
	--recursive \
	--query 'Parameters[*].[Name,Value]' \
	--output text | while read -r name value; do
	# Extract the parameter name (remove the path prefix)
	param_name="${name##*/}"
	# Write to .env file
	echo "${param_name}=${value}" >>"$ENV_FILE"
	echo "  ✓ Loaded parameter: ${param_name}"
done

# Check if any parameters were loaded
if [ ! -s "$ENV_FILE" ]; then
	echo "WARNING: No parameters found in SSM at path /$APP_NAME/$ENV_NAME/"
	echo "Creating .env with default values..."

	# Fallback: Create basic .env with required variables
	cat >"$ENV_FILE" <<'EOF'
NODE_ENV=production
PORT=3000
EOF

	echo "  ✓ Created default .env file"
else
	echo "Successfully loaded $(wc -l <"$ENV_FILE") parameters from SSM"
fi

# Set proper permissions (644 so Docker running as root can read it)
chmod 644 "$ENV_FILE"
chown root:root "$ENV_FILE" || true

echo "Environment setup completed successfully"
echo "Environment file location: $ENV_FILE"
