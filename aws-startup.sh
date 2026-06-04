#!/bin/bash
set -e

# AWS EC2 Startup Script for CS-130-Capstone-Project
# Ubuntu instance, Node v20, port 3000

echo "=== Starting AWS EC2 Setup ==="

# Update system packages
echo "Updating system packages..."
sudo apt update
DEBIAN_FRONTEND=noninteractive sudo apt upgrade -y
sudo apt install -y curl git

# Install Node v20 via nvm
echo " "
echo "Installing Node.js v20..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Load nvm directly (source ~/.bashrc won't work in non-interactive scripts)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

nvm install 20
nvm use 20
nvm alias default 20

# Verify Node installation
node --version
npm --version

# Clone the GitHub repository
echo "Cloning GitHub repository..."
cd $HOME
git clone git@github.com:brandonngu64/CS-130-Capstone-Project.git

# Navigate to project and install dependencies
echo "Installing project dependencies..."
cd CS-130-Capstone-Project
npm install

echo "=== Setup Complete ==="
echo "Project cloned to: $HOME/CS-130-Capstone-Project"
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo ""
echo "Next steps:"
echo "1. Ensure SSH key is configured for GitHub access"
echo "2. Run 'npm start' or 'npm run dev' to start the application"
echo "3. Access via: http://<your-public-dns>:5173"
