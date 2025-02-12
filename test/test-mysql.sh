#!/bin/bash

PORT="13306"
NAME="mysql"

# Is docker running?
(docker info --format json | jq -e '.ServerVersion != null and .ServerVersion != ""') || { echo "❌ Docker is not running! Make sure it is up."; exit 1; }

# Start a MySQL container on port 13306 with empty password
echo -n "🛢️  Starting Database Container ... "
docker run -p "$PORT":3306 -e MYSQL_ALLOW_EMPTY_PASSWORD=1 --rm --name="$NAME" -d mysql:latest

# Wait for MySQL to start (\use IP as host to prevent socket file)
echo -n "😴 Waiting for container to be ready ... "
until docker exec -it "$NAME" mysqladmin ping -h 127.0.0.1 --silent; do sleep 1; done

# Create DB and user
echo "🛠️️  Setting up DB and user(s) ..."
SQL="
  CREATE DATABASE dbx DEFAULT CHARACTER SET utf8mb4;
  CREATE USER IF NOT EXISTS 'dbx'@'%';
  GRANT ALL ON dbx.* TO 'dbx'@'%';
  FLUSH PRIVILEGES;
"
docker exec -it "$NAME" mysql -u root -e "$SQL"

# Run MySQL tests
echo "🧪 Running Tests ..."
echo "------------------------------------------------------------------------------"
TEST_PROVIDER="$NAME" TEST_PORT="$PORT" deno test -A --unstable-kv --unstable-temporal
echo "------------------------------------------------------------------------------"

# Stop and delete the container
echo -n "🛑 Stopping container ... "
docker stop "$NAME"
