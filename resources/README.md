# Bootstrapping DBs

Reminders of how to bootstrap DBs before being able to perform tests on top of them.


## Bootstrap MySQL

Below is a pseudo-script that you can copy/paste to the command line to get started on
creating the database to develop locally.

```bash
# Install MySQL
brew install mysql
brew services start mysql

# Create 'dbx'
mysql -u root -e "CREATE DATABASE dbx DEFAULT CHARACTER SET utf8mb4"

# Create main user (password should change for production)
mysql -u root -e "CREATE USER IF NOT EXISTS 'dbx'@'localhost'"
mysql -u root -e "CREATE USER IF NOT EXISTS 'dbx'@'%'"

# Grant on the main schema
mysql -u root -e "GRANT ALL ON dbx.* TO 'dbx'@'localhost', 'dbx'@'%'"
```


## Bootstrap Postgres

Below is a pseudo-script that you can copy/paste to the command line to get started on
creating the database to develop locally.

```bash
# Install MySQL
brew install postresql
brew services start postresql

# Set default database to 'postgres'
export PGDATABASE=postgres

export DB="dbx"

# Create 'dbx'
psql -c "CREATE DATABASE dbx"

# Create main user (password should change for production)
psql -c "CREATE USER dbx"

# Grant on the main schema
psql -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO dbx"
```
