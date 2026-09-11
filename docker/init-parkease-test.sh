#!/bin/bash
set -euo pipefail

# ADR-022: create parkease_test for the coding agent.
# POSTGRES_DB already created parkease_dev; this script adds the second database.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE parkease_test OWNER parkease;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "parkease_test" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
EOSQL
