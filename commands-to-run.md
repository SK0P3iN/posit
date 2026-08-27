# Build Local Image
docker build -t postiz-app:local -f Dockerfile.dev .


# Stop everything
docker compose down -v

# This removes ALL volumes, including postgres data
# Start fresh - postgres will now initialize properly
docker compose up -d

# Wait 15 seconds for postgres to initialize
sleep 15

# Check the status
docker compose ps
