#!/bin/bash
# Setup script for AI Copilot Wallet
# Works on both Ubuntu VPS and WSL

set -e

echo "🚀 AI Copilot Wallet Setup"
echo "=========================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check current Node version
CURRENT_NODE=$(node -v 2>/dev/null || echo "not installed")
echo -e "${YELLOW}Current Node.js version: $CURRENT_NODE${NC}"

# Function to upgrade Node.js
upgrade_node() {
    echo -e "\n${YELLOW}Upgrading Node.js to v20 LTS...${NC}"
    
    # Remove old Node if installed via apt
    if command -v node &> /dev/null && dpkg -l | grep -q nodejs; then
        echo "Removing old Node.js installed via apt..."
        sudo apt-get remove -y nodejs npm
    fi
    
    # Install Node 20 using NodeSource
    if [ ! -f /etc/apt/sources.list.d/nodesource.list ]; then
        echo "Adding NodeSource repository..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    fi
    
    echo "Installing Node.js 20..."
    sudo apt-get install -y nodejs
    
    # Verify installation
    echo -e "${GREEN}✓ Node.js upgraded to: $(node -v)${NC}"
    echo -e "${GREEN}✓ npm version: $(npm -v)${NC}"
}

# Check if we need to upgrade Node
if [[ "$CURRENT_NODE" == "not installed" ]] || [[ "$CURRENT_NODE" < "v20" ]]; then
    echo -e "${RED}Node.js 20+ is required${NC}"
    read -p "Upgrade Node.js now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        upgrade_node
    else
        echo -e "${RED}Cannot continue without Node.js 20+${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Node.js version is compatible${NC}"
fi

# Install dependencies
echo -e "\n${YELLOW}Installing npm dependencies...${NC}"
npm install

# Create data directory
echo -e "\n${YELLOW}Creating data directory...${NC}"
mkdir -p data
echo -e "${GREEN}✓ Data directory created${NC}"

# Setup .env file if it doesn't exist
if [ ! -f .env ]; then
    echo -e "\n${YELLOW}Creating .env file from template...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ .env file created${NC}"
    echo -e "${YELLOW}⚠️  Please edit .env and add your API keys:${NC}"
    echo "   - TELEGRAM_BOT_TOKEN"
    echo "   - GOOGLE_AI_API_KEY"
else
    echo -e "${GREEN}✓ .env file already exists${NC}"
fi

# Check if running in WSL
if grep -qi microsoft /proc/version 2>/dev/null; then
    echo -e "\n${GREEN}✓ Running in WSL${NC}"
    echo -e "${YELLOW}Note: Database will be stored in ./data/${NC}"
fi

# Test database creation
echo -e "\n${YELLOW}Testing SQLite3...${NC}"
node -e "
const db = require('better-sqlite3')('./data/test.db');
db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)');
db.close();
console.log('${GREEN}✓ SQLite3 is working${NC}');
" 2>/dev/null || echo -e "${RED}✗ SQLite3 test failed - but will continue${NC}"

rm -f ./data/test.db 2>/dev/null

echo -e "\n${GREEN}=========================="
echo "✓ Setup complete!"
echo -e "==========================${NC}"
echo ""
echo "Next steps:"
echo "1. Edit .env and add your API keys"
echo "2. Run: npm run dev"
echo ""
echo "For production deployment, see DOCKER_SETUP.md"
