#!/bin/bash

PORT="15432"
NAME="postgres"

# Start a MySQL container on port 13306 with empty password
echo -n "🛢️  Starting Database Container ... "
docker run -p "$PORT":5432 -e POSTGRES_HOST_AUTH_METHOD="trust" --rm --name="$NAME" -d postgres:latest

# Wait for MySQL to start (\use IP as host to prevent socket file)
# echo -n "😴 Waiting for container to be ready ... "
# until docker exec -it "$NAME" mysqladmin ping -h 127.0.0.1 --silent; do sleep 1; done
sleep 3

# Create DB and user
echo "🛠️️  Setting up DB and user(s) ..."
docker exec -it "$NAME" psql postgres postgres -q -c "CREATE DATABASE dbx;"
SQL="
  CREATE USER dbx WITH PASSWORD 'xdb';
  GRANT ALL ON SCHEMA public TO dbx;
"
docker exec -it "$NAME" psql dbx postgres -q -c "$SQL"

# Run MySQL tests
echo "🧪 Running Tests ..."
echo "------------------------------------------------------------------------------"
TEST_PROVIDER=postgres TEST_PORT="$PORT" deno test -A --unstable
echo "------------------------------------------------------------------------------"

# Stop and delete the container
echo -n "🛑 Stopping container ... "
docker stop "$NAME"
