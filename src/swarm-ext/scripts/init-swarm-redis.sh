#!/bin/bash
# XClaw Swarm Redis Initialization Script
# Starts Redis with swarm-optimized configuration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REDIS_CONF="$PROJECT_DIR/docker/redis.conf"
REDIS_DATA_DIR="$PROJECT_DIR/data/redis"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}[swarm-redis]${NC} Initializing Redis for XClaw Swarm..."

# Check if Redis is installed
if ! command -v redis-server &> /dev/null; then
    echo -e "${RED}[swarm-redis]${NC} redis-server not found. Installing..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y redis-server
    elif command -v brew &> /dev/null; then
        brew install redis
    elif command -v apk &> /dev/null; then
        apk add redis
    else
        echo -e "${RED}[swarm-redis]${NC} Could not install Redis automatically. Please install manually."
        exit 1
    fi
fi

# Create data directory
mkdir -p "$REDIS_DATA_DIR"

# Check if Redis is already running
if redis-cli ping &> /dev/null; then
    echo -e "${YELLOW}[swarm-redis]${NC} Redis is already running."
    redis-cli INFO server | grep redis_version
    exit 0
fi

# Start Redis with custom config
echo -e "${GREEN}[swarm-redis]${NC} Starting Redis with swarm config..."
if [ -f "$REDIS_CONF" ]; then
    redis-server "$REDIS_CONF" --daemonize yes --dir "$REDIS_DATA_DIR"
else
    echo -e "${YELLOW}[swarm-redis]${NC} Config not found, starting with defaults..."
    redis-server --daemonize yes --dir "$REDIS_DATA_DIR" --maxmemory 512mb --maxmemory-policy allkeys-lru
fi

# Wait for Redis to be ready
for i in {1..10}; do
    if redis-cli ping &> /dev/null; then
        echo -e "${GREEN}[swarm-redis]${NC} Redis is ready!"
        redis-cli INFO server | grep redis_version
        exit 0
    fi
    sleep 0.5
done

echo -e "${RED}[swarm-redis]${NC} Redis failed to start. Check logs."
exit 1
