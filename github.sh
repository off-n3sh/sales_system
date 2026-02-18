#!/bin/bash

# GitHub Environment Manager v1.0
# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Global variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$HOME/.ssh/backups"
LOG_FILE="$SCRIPT_DIR/logs/setup_$(date +%Y%m%d_%H%M%S).log"
CONFIG_FILE="$SCRIPT_DIR/config/settings.conf"

# Create necessary directories
mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/config" "$BACKUP_DIR"

# Logging function
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Print section header
print_header() {
    echo -e "\n${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}\n"
}

# Print status
print_status() {
    local status=$1
    local message=$2
    if [ "$status" = "ok" ]; then
        echo -e "${GREEN}✓${NC} $message"
    elif [ "$status" = "warn" ]; then
        echo -e "${YELLOW}⚠${NC} $message"
    elif [ "$status" = "error" ]; then
        echo -e "${RED}✗${NC} $message"
    else
        echo -e "${BLUE}ℹ${NC} $message"
    fi
}

# Ask yes/no question
ask_yes_no() {
    local prompt=$1
    local response
    while true; do
        read -p "$(echo -e ${YELLOW}$prompt [y/n]: ${NC})" response
        case $response in
            [Yy]* ) return 0;;
            [Nn]* ) return 1;;
            * ) echo "Please answer y or n.";;
        esac
    done
}

# Press any key to continue
press_any_key() {
    echo -e "\n${CYAN}Press any key to continue...${NC}"
    read -n 1 -s
}

# ============================================
# STEP 1: System Detection
# ============================================
step_system_detection() {
    print_header "STEP 1: System Detection"
    
    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="Linux"
        print_status "ok" "Operating System: Linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macOS"
        print_status "ok" "Operating System: macOS"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        OS="Windows (WSL/Git Bash)"
        print_status "ok" "Operating System: Windows (WSL/Git Bash)"
    else
        OS="Unknown"
        print_status "warn" "Operating System: Unknown ($OSTYPE)"
    fi
    
    # Detect package manager
    if command -v apt-get &> /dev/null; then
        PKG_MANAGER="apt-get"
        print_status "ok" "Package Manager: apt-get"
    elif command -v yum &> /dev/null; then
        PKG_MANAGER="yum"
        print_status "ok" "Package Manager: yum"
    elif command -v dnf &> /dev/null; then
        PKG_MANAGER="dnf"
        print_status "ok" "Package Manager: dnf"
    elif command -v brew &> /dev/null; then
        PKG_MANAGER="brew"
        print_status "ok" "Package Manager: Homebrew"
    elif command -v pacman &> /dev/null; then
        PKG_MANAGER="pacman"
        print_status "ok" "Package Manager: pacman"
    else
        PKG_MANAGER="none"
        print_status "warn" "Package Manager: Not detected"
    fi
    
    # Detect download tool
    if command -v curl &> /dev/null; then
        DOWNLOAD_TOOL="curl"
        print_status "ok" "Download Tool: curl"
    elif command -v wget &> /dev/null; then
        DOWNLOAD_TOOL="wget"
        print_status "ok" "Download Tool: wget"
    else
        DOWNLOAD_TOOL="none"
        print_status "warn" "Download Tool: Not found"
    fi
    
    log "System detection completed: OS=$OS, PKG=$PKG_MANAGER, DL=$DOWNLOAD_TOOL"
    press_any_key
}

# ============================================
# STEP 2: Git Installation Check
# ============================================
step_git_check() {
    print_header "STEP 2: Git Installation Check"
    
    if command -v git &> /dev/null; then
        GIT_VERSION=$(git --version)
        print_status "ok" "Git is installed: $GIT_VERSION"
        log "Git installed: $GIT_VERSION"
    else
        print_status "error" "Git is NOT installed"
        
        if ask_yes_no "Would you like to install Git?"; then
            install_git
        else
            print_status "info" "Skipping Git installation"
            log "User skipped Git installation"
        fi
    fi
    
    press_any_key
}

install_git() {
    print_status "info" "Installing Git..."

    # Auto-detect package manager if not already set (e.g. when running step standalone)
    if [ -z "$PKG_MANAGER" ] || [ "$PKG_MANAGER" = "none" ]; then
        if command -v apt-get &> /dev/null;   then PKG_MANAGER="apt-get"
        elif command -v dnf &> /dev/null;     then PKG_MANAGER="dnf"
        elif command -v yum &> /dev/null;     then PKG_MANAGER="yum"
        elif command -v brew &> /dev/null;    then PKG_MANAGER="brew"
        elif command -v pacman &> /dev/null;  then PKG_MANAGER="pacman"
        else PKG_MANAGER="none"
        fi
        print_status "info" "Detected package manager: $PKG_MANAGER"
    fi

    case $PKG_MANAGER in
        apt-get)
            sudo apt-get update -qq && sudo apt-get install -y git
            ;;
        yum|dnf)
            sudo $PKG_MANAGER install -y git
            ;;
        brew)
            brew install git
            ;;
        pacman)
            sudo pacman -S --noconfirm git
            ;;
        *)
            print_status "error" "No supported package manager found. Trying snap..."
            if command -v snap &> /dev/null; then
                sudo snap install git --classic
            else
                print_status "error" "Cannot auto-install Git. Please install it manually:"
                echo "  Ubuntu/Debian : sudo apt-get install git"
                echo "  Fedora/RHEL   : sudo dnf install git"
                echo "  macOS         : brew install git  (or xcode-select --install)"
                echo "  Arch          : sudo pacman -S git"
                return 1
            fi
            ;;
    esac

    if command -v git &> /dev/null; then
        print_status "ok" "Git installed successfully: $(git --version)"
        log "Git installed successfully"
    else
        print_status "error" "Git installation failed. Check the output above for errors."
        log "Git installation failed"
    fi
}

# ============================================
# STEP 3: GitHub CLI Check
# ============================================
step_gh_cli_check() {
    print_header "STEP 3: GitHub CLI Check"
    
    if command -v gh &> /dev/null; then
        GH_VERSION=$(gh --version | head -n 1)
        print_status "ok" "GitHub CLI is installed: $GH_VERSION"
        log "GitHub CLI installed: $GH_VERSION"
    else
        print_status "error" "GitHub CLI is NOT installed"
        
        if ask_yes_no "Would you like to install GitHub CLI?"; then
            install_gh_cli
        else
            print_status "info" "Skipping GitHub CLI installation"
            log "User skipped GitHub CLI installation"
        fi
    fi
    
    press_any_key
}

install_gh_cli() {
    print_status "info" "Installing GitHub CLI..."

    # Auto-detect package manager if not already set (e.g. when running step standalone)
    if [ -z "$PKG_MANAGER" ] || [ "$PKG_MANAGER" = "none" ]; then
        if command -v apt-get &> /dev/null;   then PKG_MANAGER="apt-get"
        elif command -v dnf &> /dev/null;     then PKG_MANAGER="dnf"
        elif command -v yum &> /dev/null;     then PKG_MANAGER="yum"
        elif command -v brew &> /dev/null;    then PKG_MANAGER="brew"
        elif command -v pacman &> /dev/null;  then PKG_MANAGER="pacman"
        else PKG_MANAGER="none"
        fi
        print_status "info" "Detected package manager: $PKG_MANAGER"
    fi

    # Also detect download tool if not set
    if [ -z "$DOWNLOAD_TOOL" ] || [ "$DOWNLOAD_TOOL" = "none" ]; then
        if command -v curl &> /dev/null;    then DOWNLOAD_TOOL="curl"
        elif command -v wget &> /dev/null;  then DOWNLOAD_TOOL="wget"
        else DOWNLOAD_TOOL="none"
        fi
    fi

    case $PKG_MANAGER in
        apt-get)
            if [ "$DOWNLOAD_TOOL" = "curl" ]; then
                curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
                    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
            else
                wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
                    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
            fi
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
                | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
            sudo apt-get update -qq && sudo apt-get install -y gh
            ;;
        yum)
            sudo yum install -y 'dnf-command(config-manager)' 2>/dev/null || true
            sudo yum config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
            sudo yum install -y gh
            ;;
        dnf)
            sudo dnf install -y 'dnf-command(config-manager)' 2>/dev/null || true
            sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
            sudo dnf install -y gh
            ;;
        brew)
            brew install gh
            ;;
        pacman)
            sudo pacman -S --noconfirm github-cli
            ;;
        *)
            # Last-resort: try snap
            if command -v snap &> /dev/null; then
                print_status "info" "Trying snap install..."
                sudo snap install gh
            else
                print_status "error" "Cannot auto-install GitHub CLI. Please install it manually:"
                echo "  Ubuntu/Debian : See https://github.com/cli/cli#installation"
                echo "  Fedora/RHEL   : sudo dnf install gh"
                echo "  macOS         : brew install gh"
                echo "  Arch          : sudo pacman -S github-cli"
                return 1
            fi
            ;;
    esac

    if command -v gh &> /dev/null; then
        print_status "ok" "GitHub CLI installed successfully: $(gh --version | head -n 1)"
        log "GitHub CLI installed successfully"
    else
        print_status "error" "GitHub CLI installation failed. Check the output above for errors."
        log "GitHub CLI installation failed"
    fi
}

# ============================================
# STEP 4: Git Configuration Check
# ============================================
step_git_config() {
    print_header "STEP 4: Git Configuration Check"
    
    GIT_NAME=$(git config --global user.name 2>/dev/null)
    GIT_EMAIL=$(git config --global user.email 2>/dev/null)
    
    if [ -n "$GIT_NAME" ]; then
        print_status "ok" "Git user.name: $GIT_NAME"
    else
        print_status "warn" "Git user.name: Not set"
    fi
    
    if [ -n "$GIT_EMAIL" ]; then
        print_status "ok" "Git user.email: $GIT_EMAIL"
    else
        print_status "warn" "Git user.email: Not set"
    fi
    
    if [ -z "$GIT_NAME" ] || [ -z "$GIT_EMAIL" ]; then
        if ask_yes_no "Would you like to configure Git identity?"; then
            configure_git_identity
        else
            print_status "info" "Skipping Git configuration"
            log "User skipped Git configuration"
        fi
    fi
    
    press_any_key
}

configure_git_identity() {
    echo -e "\n${CYAN}Enter your Git configuration:${NC}"
    
    if [ -z "$GIT_NAME" ]; then
        read -p "Git user.name (Your Full Name): " input_name
        if [ -n "$input_name" ]; then
            git config --global user.name "$input_name"
            print_status "ok" "Set user.name to: $input_name"
            log "Set git user.name: $input_name"
        fi
    fi
    
    if [ -z "$GIT_EMAIL" ]; then
        read -p "Git user.email (your.email@example.com): " input_email
        if [ -n "$input_email" ]; then
            git config --global user.email "$input_email"
            print_status "ok" "Set user.email to: $input_email"
            log "Set git user.email: $input_email"
        fi
    fi
}

# ============================================
# STEP 5: SSH Key Management
# ============================================
step_ssh_management() {
    print_header "STEP 5: SSH Key Management"
    
    SSH_DIR="$HOME/.ssh"
    SSH_KEY_RSA="$SSH_DIR/id_rsa"
    SSH_KEY_ED25519="$SSH_DIR/id_ed25519"
    
    # Check for existing keys
    EXISTING_KEYS=()
    if [ -f "$SSH_KEY_RSA" ]; then
        EXISTING_KEYS+=("id_rsa (RSA)")
        print_status "ok" "Found SSH key: $SSH_KEY_RSA"
    fi
    if [ -f "$SSH_KEY_ED25519" ]; then
        EXISTING_KEYS+=("id_ed25519 (Ed25519)")
        print_status "ok" "Found SSH key: $SSH_KEY_ED25519"
    fi
    
    if [ ${#EXISTING_KEYS[@]} -eq 0 ]; then
        print_status "warn" "No SSH keys found"
        
        if ask_yes_no "Would you like to generate a new SSH key?"; then
            generate_ssh_key
        else
            print_status "info" "Skipping SSH key generation"
            press_any_key
            return
        fi
    else
        echo -e "\n${GREEN}Existing SSH keys found:${NC}"
        for key in "${EXISTING_KEYS[@]}"; do
            echo "  - $key"
        done
        
        if ask_yes_no "Would you like to generate a new SSH key? (old keys will be backed up)"; then
            backup_ssh_keys
            generate_ssh_key
        fi
    fi
    
    # Start SSH agent and add key
    manage_ssh_agent
    
    # Display public key
    display_public_key
    
    # Add to GitHub
    if command -v gh &> /dev/null; then
        if ask_yes_no "Would you like to add this SSH key to GitHub automatically?"; then
            add_ssh_to_github
        else
            echo -e "\n${YELLOW}To add manually, copy the public key above and:${NC}"
            echo "  1. Go to: https://github.com/settings/keys"
            echo "  2. Click 'New SSH key'"
            echo "  3. Paste the key and save"
        fi
    fi
    
    # Test SSH connection
    test_github_ssh
    
    press_any_key
}

backup_ssh_keys() {
    BACKUP_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_PATH="$BACKUP_DIR/backup_$BACKUP_TIMESTAMP"
    
    mkdir -p "$BACKUP_PATH"
    
    print_status "info" "Backing up existing SSH keys..."
    
    if [ -f "$SSH_KEY_RSA" ]; then
        cp "$SSH_KEY_RSA" "$BACKUP_PATH/"
        cp "$SSH_KEY_RSA.pub" "$BACKUP_PATH/" 2>/dev/null
        print_status "ok" "Backed up: id_rsa"
    fi
    
    if [ -f "$SSH_KEY_ED25519" ]; then
        cp "$SSH_KEY_ED25519" "$BACKUP_PATH/"
        cp "$SSH_KEY_ED25519.pub" "$BACKUP_PATH/" 2>/dev/null
        print_status "ok" "Backed up: id_ed25519"
    fi
    
    print_status "ok" "Backup saved to: $BACKUP_PATH"
    log "SSH keys backed up to: $BACKUP_PATH"
}

generate_ssh_key() {
    echo -e "\n${CYAN}Choose SSH key type:${NC}"
    echo "  1) Ed25519 (recommended, modern)"
    echo "  2) RSA 4096 (compatible, traditional)"
    read -p "Enter choice [1-2]: " key_choice
    
    read -p "Enter your email for SSH key: " ssh_email
    
    case $key_choice in
        1)
            ssh-keygen -t ed25519 -C "$ssh_email" -f "$SSH_KEY_ED25519"
            GENERATED_KEY="$SSH_KEY_ED25519"
            print_status "ok" "Generated Ed25519 SSH key"
            ;;
        2|*)
            ssh-keygen -t rsa -b 4096 -C "$ssh_email" -f "$SSH_KEY_RSA"
            GENERATED_KEY="$SSH_KEY_RSA"
            print_status "ok" "Generated RSA 4096 SSH key"
            ;;
    esac
    
    log "Generated SSH key: $GENERATED_KEY"
}

manage_ssh_agent() {
    print_status "info" "Managing SSH agent..."
    
    # Check if ssh-agent is running
    if [ -z "$SSH_AUTH_SOCK" ]; then
        eval "$(ssh-agent -s)"
        SSH_AGENT_PID=$SSH_AGENT_PID
        print_status "ok" "Started ssh-agent (PID: $SSH_AGENT_PID)"
        log "Started ssh-agent with PID: $SSH_AGENT_PID"
    else
        SSH_AGENT_PID=$(pgrep ssh-agent)
        print_status "ok" "ssh-agent already running (PID: $SSH_AGENT_PID)"
    fi
    
    # Add key to agent
    if [ -f "$SSH_KEY_ED25519" ]; then
        ssh-add "$SSH_KEY_ED25519" 2>/dev/null
        print_status "ok" "Added id_ed25519 to ssh-agent"
    fi
    
    if [ -f "$SSH_KEY_RSA" ]; then
        ssh-add "$SSH_KEY_RSA" 2>/dev/null
        print_status "ok" "Added id_rsa to ssh-agent"
    fi
    
    # List loaded keys
    echo -e "\n${CYAN}Keys loaded in ssh-agent:${NC}"
    ssh-add -l
}

display_public_key() {
    echo -e "\n${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}Your SSH Public Key:${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    
    if [ -f "$SSH_KEY_ED25519.pub" ]; then
        cat "$SSH_KEY_ED25519.pub"
        CURRENT_PUB_KEY="$SSH_KEY_ED25519.pub"
    elif [ -f "$SSH_KEY_RSA.pub" ]; then
        cat "$SSH_KEY_RSA.pub"
        CURRENT_PUB_KEY="$SSH_KEY_RSA.pub"
    fi
    
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}\n"
}

add_ssh_to_github() {
    print_status "info" "Adding SSH key to GitHub..."
    
    if [ -f "$CURRENT_PUB_KEY" ]; then
        KEY_TITLE="$(hostname)-$(date +%Y%m%d)"
        gh ssh-key add "$CURRENT_PUB_KEY" --title "$KEY_TITLE" 2>&1
        
        if [ $? -eq 0 ]; then
            print_status "ok" "SSH key added to GitHub successfully"
            log "SSH key added to GitHub: $KEY_TITLE"
        else
            print_status "error" "Failed to add SSH key to GitHub (may need to authenticate first)"
        fi
    fi
}

test_github_ssh() {
    print_status "info" "Testing SSH connection to GitHub..."
    
    SSH_TEST=$(ssh -T git@github.com 2>&1)
    
    if echo "$SSH_TEST" | grep -q "successfully authenticated"; then
        print_status "ok" "SSH connection to GitHub: SUCCESS"
        log "GitHub SSH test: SUCCESS"
    else
        print_status "warn" "SSH connection to GitHub: Not authenticated yet"
        echo "$SSH_TEST"
    fi
}

# ============================================
# STEP 6: GitHub Authentication
# ============================================
step_github_auth() {
    print_header "STEP 6: GitHub Authentication"
    
    if ! command -v gh &> /dev/null; then
        print_status "error" "GitHub CLI not installed. Install it first (Step 3)"
        press_any_key
        return
    fi
    
    # Check auth status
    AUTH_STATUS=$(gh auth status 2>&1)
    
    if echo "$AUTH_STATUS" | grep -q "Logged in to github.com"; then
        print_status "ok" "Already authenticated with GitHub"
        echo "$AUTH_STATUS"
        log "GitHub authentication: Already logged in"
    else
        print_status "warn" "Not authenticated with GitHub"
        
        if ask_yes_no "Would you like to authenticate with GitHub now?"; then
            gh_login
        else
            print_status "info" "Skipping GitHub authentication"
            log "User skipped GitHub authentication"
        fi
    fi
    
    press_any_key
}

gh_login() {
    echo -e "\n${CYAN}Choose authentication method:${NC}"
    echo "  1) Web browser (recommended)"
    echo "  2) Personal access token"
    read -p "Enter choice [1-2]: " auth_choice
    
    case $auth_choice in
        1)
            gh auth login
            ;;
        2)
            gh auth login --with-token
            ;;
        *)
            gh auth login
            ;;
    esac
    
    if gh auth status &> /dev/null; then
        print_status "ok" "GitHub authentication successful"
        log "GitHub authentication successful"
    else
        print_status "error" "GitHub authentication failed"
        log "GitHub authentication failed"
    fi
}

# ============================================
# STEP 7: Repository Connection Check
# ============================================
step_repo_connection() {
    print_header "STEP 7: Repository Connection Check"
    
    # Check if in a git repo
    if ! git rev-parse --git-dir &> /dev/null; then
        print_status "warn" "Not in a Git repository"
        
        if ask_yes_no "Would you like to initialize a Git repository here?"; then
            git init
            print_status "ok" "Initialized Git repository"
            log "Initialized Git repository in $(pwd)"
        else
            print_status "info" "Skipping repository initialization"
            press_any_key
            return
        fi
    else
        print_status "ok" "In a Git repository"
    fi
    
    # Check remote
    REMOTE_URL=$(git config --get remote.origin.url 2>/dev/null)
    
    if [ -n "$REMOTE_URL" ]; then
        print_status "ok" "Remote origin: $REMOTE_URL"
    else
        print_status "warn" "No remote origin configured"
        
        if ask_yes_no "Would you like to add a remote origin?"; then
            read -p "Enter remote repository URL: " remote_url
            git remote add origin "$remote_url"
            print_status "ok" "Added remote origin: $remote_url"
            log "Added remote origin: $remote_url"
        fi
    fi
    
    # Check default branch
    if git rev-parse --git-dir &> /dev/null; then
        DEFAULT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
        if [ -n "$DEFAULT_BRANCH" ]; then
            print_status "ok" "Current branch: $DEFAULT_BRANCH"
        else
            print_status "info" "No commits yet (branch will be created on first commit)"
        fi
    fi
    
    # Test connection
    if [ -n "$REMOTE_URL" ]; then
        print_status "info" "Testing connection to remote..."
        
        if git ls-remote origin &> /dev/null; then
            print_status "ok" "Connection to remote: SUCCESS"
            log "Remote connection test: SUCCESS"
        else
            print_status "error" "Connection to remote: FAILED"
            echo "  This could mean:"
            echo "  - SSH key not added to GitHub"
            echo "  - Repository doesn't exist"
            echo "  - Network issue"
            log "Remote connection test: FAILED"
        fi
    fi
    
    press_any_key
}

# ============================================
# STEP 8: Summary Report
# ============================================
step_summary_report() {
    print_header "STEP 8: Summary Report"
    
    echo -e "${CYAN}System Information:${NC}"
    echo "  OS: $OS"
    echo "  Package Manager: $PKG_MANAGER"
    echo "  Download Tool: $DOWNLOAD_TOOL"
    echo ""
    
    echo -e "${CYAN}Git Status:${NC}"
    if command -v git &> /dev/null; then
        echo "  ✓ Git: $(git --version)"
        echo "  ✓ user.name: $(git config --global user.name)"
        echo "  ✓ user.email: $(git config --global user.email)"
    else
        echo "  ✗ Git: Not installed"
    fi
    echo ""
    
    echo -e "${CYAN}GitHub CLI Status:${NC}"
    if command -v gh &> /dev/null; then
        echo "  ✓ GitHub CLI: $(gh --version | head -n 1)"
        if gh auth status &> /dev/null 2>&1; then
            echo "  ✓ Authentication: Logged in"
        else
            echo "  ✗ Authentication: Not logged in"
        fi
    else
        echo "  ✗ GitHub CLI: Not installed"
    fi
    echo ""
    
    echo -e "${CYAN}SSH Status:${NC}"
    if [ -f "$HOME/.ssh/id_ed25519" ] || [ -f "$HOME/.ssh/id_rsa" ]; then
        echo "  ✓ SSH Keys: Found"
        ssh-add -l 2>/dev/null | head -n 5
    else
        echo "  ✗ SSH Keys: Not found"
    fi
    echo ""
    
    echo -e "${CYAN}Repository Status:${NC}"
    if git rev-parse --git-dir &> /dev/null 2>&1; then
        echo "  ✓ Git Repository: Yes"
        echo "  ✓ Current Branch: $(git symbolic-ref --short HEAD 2>/dev/null || echo 'N/A')"
        REMOTE=$(git config --get remote.origin.url 2>/dev/null)
        if [ -n "$REMOTE" ]; then
            echo "  ✓ Remote: $REMOTE"
        else
            echo "  ✗ Remote: Not configured"
        fi
    else
        echo "  ✗ Git Repository: No"
    fi
    echo ""
    
    # Save report to file
    REPORT_FILE="$SCRIPT_DIR/logs/summary_$(date +%Y%m%d_%H%M%S).txt"
    {
        echo "GitHub Environment Manager - Summary Report"
        echo "Generated: $(date)"
        echo ""
        echo "System: $OS | Package Manager: $PKG_MANAGER"
        echo "Git: $(command -v git &> /dev/null && git --version || echo 'Not installed')"
        echo "GitHub CLI: $(command -v gh &> /dev/null && gh --version | head -n 1 || echo 'Not installed')"
        echo "SSH Keys: $([ -f "$HOME/.ssh/id_ed25519" ] || [ -f "$HOME/.ssh/id_rsa" ] && echo 'Found' || echo 'Not found')"
    } > "$REPORT_FILE"
    
    print_status "ok" "Report saved to: $REPORT_FILE"
    
    press_any_key
}

# ============================================
# STEP 9: Git Command Toolbox
# ============================================
step_command_toolbox() {
    while true; do
        print_header "STEP 9: Git Command Toolbox"
        
        echo -e "${CYAN}A. BASIC COMMANDS${NC}"
        echo "  1) git init - Initialize repository"
        echo "  2) git status - Check current state"
        echo "  3) git add . - Stage all changes"
        echo "  4) git commit - Commit changes"
        echo ""
        echo -e "${CYAN}B. BRANCH WORKFLOWS${NC}"
        echo "  5) Create & push test branch"
        echo "  6) Switch branch"
        echo "  7) Delete branch"
        echo ""
        echo -e "${CYAN}C. SYNC SCENARIOS (Gray Areas)${NC}"
        echo "  8) I'm behind main, ignore it - just push MY work"
        echo "  9) Make localhost match main exactly"
        echo "  10) Make main match my localhost (⚠️ dangerous)"
        echo "  11) Pull specific commit to localhost"
        echo "  12) I'm behind main, keep MY changes on top (rebase)"
        echo "  13) Undo last commit (keep changes)"
        echo ""
        echo -e "${CYAN}D. PREVIEW BRANCH WORKFLOW${NC}"
        echo "  14) Complete preview workflow guide"
        echo ""
        echo -e "${CYAN}E. EMERGENCY FIXES${NC}"
        echo "  15) Abort merge/rebase"
        echo "  16) Discard all local changes"
        echo "  17) Recover deleted commits (reflog)"
        echo ""
        echo -e "${CYAN}F. GITHUB CLI COMMANDS${NC}"
        echo "  18) gh repo create - Create new repo"
        echo "  19) gh pr create - Create pull request"
        echo "  20) gh pr list - List pull requests"
        echo "  21) gh pr view - View PR details"
        echo "  22) gh pr merge - Merge pull request"
        echo "  23) gh repo view - View repository"
        echo -e "  ${GREEN}24) 🚀 Create GitHub Repo - create repo & get URL${NC}"
        echo ""
        echo "  0) Back to Main Menu"
        echo ""
        
        read -p "Enter choice [0-24]: " toolbox_choice
        
        case $toolbox_choice in
            1) cmd_git_init ;;
            2) cmd_git_status ;;
            3) cmd_git_add ;;
            4) cmd_git_commit ;;
            5) cmd_create_push_branch ;;
            6) cmd_switch_branch ;;
            7) cmd_delete_branch ;;
            8) cmd_push_my_work ;;
            9) cmd_match_main ;;
            10) cmd_force_push_main ;;
            11) cmd_cherry_pick ;;
            12) cmd_rebase_main ;;
            13) cmd_undo_commit ;;
            14) cmd_preview_workflow ;;
            15) cmd_abort_merge ;;
            16) cmd_discard_changes ;;
            17) cmd_reflog_recover ;;
            18) cmd_gh_repo_create ;;
            19) cmd_gh_pr_create ;;
            20) cmd_gh_pr_list ;;
            21) cmd_gh_pr_view ;;
            22) cmd_gh_pr_merge ;;
            23) cmd_gh_repo_view ;;
            24) step_create_github_repo ;;
            0) break ;;
            *) print_status "error" "Invalid choice" ;;
        esac
    done
}

# Basic Commands
cmd_git_init() {
    echo -e "\n${CYAN}━━━ git init ━━━${NC}"
    echo "Initialize a new Git repository in current directory"
    echo ""
    echo "Command: git init"
    
    if ask_yes_no "Execute this command?"; then
        git init
        print_status "ok" "Repository initialized"
    fi
    press_any_key
}

cmd_git_status() {
    echo -e "\n${CYAN}━━━ git status ━━━${NC}"
    echo "Show the working tree status"
    echo ""
    git status
    press_any_key
}

cmd_git_add() {
    echo -e "\n${CYAN}━━━ git add ━━━${NC}"
    echo "Stage all changes for commit"
    echo ""
    echo "Command: git add ."
    
    if ask_yes_no "Execute this command?"; then
        git add .
        print_status "ok" "All changes staged"
        git status
    fi
    press_any_key
}

cmd_git_commit() {
    echo -e "\n${CYAN}━━━ git commit ━━━${NC}"
    echo "Commit staged changes"
    echo ""
    read -p "Enter commit message: " commit_msg
    
    if [ -n "$commit_msg" ]; then
        git commit -m "$commit_msg"
        print_status "ok" "Changes committed"
    else
        print_status "error" "Commit message required"
    fi
    press_any_key
}

# Branch Workflows
cmd_create_push_branch() {
    echo -e "\n${CYAN}━━━ Create & Push Test Branch ━━━${NC}"
    echo ""
    read -p "Enter branch name (e.g., preview/feature-name): " branch_name
    
    if [ -n "$branch_name" ]; then
        echo ""
        echo "Executing:"
        echo "  1. git checkout -b $branch_name"
        echo "  2. git push -u origin $branch_name"
        echo ""
        
        if ask_yes_no "Proceed?"; then
            git checkout -b "$branch_name"
            git push -u origin "$branch_name"
            print_status "ok" "Branch created and pushed"
        fi
    fi
    press_any_key
}

cmd_switch_branch() {
    echo -e "\n${CYAN}━━━ Switch Branch ━━━${NC}"
    echo ""
    echo "Available branches:"
    git branch -a
    echo ""
    read -p "Enter branch name to switch to: " branch_name
    
    if [ -n "$branch_name" ]; then
        git checkout "$branch_name"
    fi
    press_any_key
}

cmd_delete_branch() {
    echo -e "\n${CYAN}━━━ Delete Branch ━━━${NC}"
    echo ""
    echo "Local branches:"
    git branch
    echo ""
    read -p "Enter branch name to delete: " branch_name
    
    if [ -n "$branch_name" ]; then
        echo ""
        echo "Options:"
        echo "  1) Delete local only: git branch -d $branch_name"
        echo "  2) Delete local (force): git branch -D $branch_name"
        echo "  3) Delete remote: git push origin --delete $branch_name"
        echo "  4) Delete both local and remote"
        read -p "Enter choice [1-4]: " del_choice
        
        case $del_choice in
            1) git branch -d "$branch_name" ;;
            2) git branch -D "$branch_name" ;;
            3) git push origin --delete "$branch_name" ;;
            4)
                git branch -D "$branch_name"
                git push origin --delete "$branch_name"
                ;;
        esac
    fi
    press_any_key
}

# Sync Scenarios
cmd_push_my_work() {
    echo -e "\n${CYAN}━━━ Push MY Work (Ignore Being Behind) ━━━${NC}"
    echo ""
    echo "Scenario: Main has commits you don't want. You just want to push YOUR work."
    echo ""
    echo "Command: git push origin your-branch-name --force"
    echo ""
    echo -e "${RED}⚠️  WARNING: This will overwrite remote branch with your local version${NC}"
    echo ""
    
    CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
    echo "Current branch: $CURRENT_BRANCH"
    echo ""
    
    if ask_yes_no "Force push to origin/$CURRENT_BRANCH?"; then
        git push origin "$CURRENT_BRANCH" --force
        print_status "ok" "Force pushed to origin/$CURRENT_BRANCH"
    fi
    press_any_key
}

cmd_match_main() {
    echo -e "\n${CYAN}━━━ Make Localhost Match Main Exactly ━━━${NC}"
    echo ""
    echo "Scenario: Discard all local changes and make your localhost exactly like remote main."
    echo ""
    echo "Commands:"
    echo "  1. git fetch origin"
    echo "  2. git reset --hard origin/main"
    echo ""
    echo -e "${RED}⚠️  WARNING: This will DELETE all local changes permanently${NC}"
    echo ""
    
    if ask_yes_no "Proceed? (This cannot be undone easily)"; then
        git fetch origin
        git reset --hard origin/main
        print_status "ok" "Local branch now matches origin/main exactly"
    fi
    press_any_key
}

cmd_force_push_main() {
    echo -e "\n${CYAN}━━━ Make Main Match Localhost ━━━${NC}"
    echo ""
    echo "Scenario: Make remote main exactly like your localhost."
    echo ""
    echo "Command: git push origin main --force"
    echo ""
    echo -e "${RED}⚠️  DANGER: This will overwrite remote main for everyone!${NC}"
    echo -e "${RED}⚠️  Only do this if you're absolutely sure!${NC}"
    echo ""
    
    if ask_yes_no "Are you ABSOLUTELY SURE you want to force push to main?"; then
        if ask_yes_no "This is your last chance. Really proceed?"; then
            git push origin main --force
            print_status "ok" "Force pushed to origin/main"
        fi
    fi
    press_any_key
}

cmd_cherry_pick() {
    echo -e "\n${CYAN}━━━ Pull Specific Commit to Localhost ━━━${NC}"
    echo ""
    echo "Scenario: You want a specific commit from main (or another branch) in your localhost."
    echo ""
    echo "Recent commits:"
    git log --oneline -10
    echo ""
    read -p "Enter commit hash to cherry-pick: " commit_hash
    
    if [ -n "$commit_hash" ]; then
        echo ""
        echo "Command: git cherry-pick $commit_hash"
        
        if ask_yes_no "Proceed?"; then
            git cherry-pick "$commit_hash"
            print_status "ok" "Cherry-picked commit $commit_hash"
        fi
    fi
    press_any_key
}

cmd_rebase_main() {
    echo -e "\n${CYAN}━━━ Keep MY Changes on Top (Rebase) ━━━${NC}"
    echo ""
    echo "Scenario: You're behind main but want to keep your changes on top of main's updates."
    echo ""
    echo "Command: git pull --rebase origin main"
    echo ""
    echo "This will:"
    echo "  1. Fetch latest main"
    echo "  2. Put main's commits first"
    echo "  3. Replay YOUR commits on top"
    echo ""
    
    if ask_yes_no "Proceed with rebase?"; then
        git pull --rebase origin main
        print_status "ok" "Rebased onto origin/main"
    fi
    press_any_key
}

cmd_undo_commit() {
    echo -e "\n${CYAN}━━━ Undo Last Commit (Keep Changes) ━━━${NC}"
    echo ""
    echo "Options:"
    echo "  1) Soft reset - Undo commit, keep changes staged"
    echo "  2) Mixed reset - Undo commit, keep changes unstaged"
    echo ""
    read -p "Enter choice [1-2]: " reset_choice
    
    case $reset_choice in
        1)
            echo "Command: git reset --soft HEAD~1"
            if ask_yes_no "Proceed?"; then
                git reset --soft HEAD~1
                print_status "ok" "Last commit undone, changes still staged"
            fi
            ;;
        2)
            echo "Command: git reset --mixed HEAD~1"
            if ask_yes_no "Proceed?"; then
                git reset --mixed HEAD~1
                print_status "ok" "Last commit undone, changes unstaged"
            fi
            ;;
    esac
    press_any_key
}

# Preview Workflow
cmd_preview_workflow() {
    echo -e "\n${CYAN}━━━ Preview Branch Workflow Guide ━━━${NC}"
    echo ""
    echo "Complete workflow for creating preview deployments:"
    echo ""
    echo -e "${GREEN}Step 1: Create preview branch${NC}"
    echo "  git checkout -b preview/my-feature"
    echo ""
    echo -e "${GREEN}Step 2: Make changes and commit${NC}"
    echo "  git add ."
    echo "  git commit -m 'Add feature'"
    echo ""
    echo -e "${GREEN}Step 3: Push to trigger auto-build${NC}"
    echo "  git push -u origin preview/my-feature"
    echo ""
    echo -e "${GREEN}Step 4: GitHub Actions builds & deploys${NC}"
    echo "  - Check Actions tab on GitHub"
    echo "  - Bot comments with preview URL"
    echo ""
    echo -e "${GREEN}Step 5: Review live changes${NC}"
    echo "  - Click preview URL"
    echo "  - Test functionality"
    echo ""
    echo -e "${GREEN}Step 6: If changes good:${NC}"
    echo "  - Create PR: gh pr create"
    echo "  - Wait for approval"
    echo "  - Merge: gh pr merge"
    echo ""
    echo -e "${GREEN}Step 7: If changes need work:${NC}"
    echo "  - Make more commits"
    echo "  - git push (auto-rebuilds preview)"
    echo ""
    
    press_any_key
}

# Emergency Fixes
cmd_abort_merge() {
    echo -e "\n${CYAN}━━━ Abort Merge/Rebase ━━━${NC}"
    echo ""
    echo "If you're stuck in a merge or rebase:"
    echo ""
    echo "Abort merge: git merge --abort"
    echo "Abort rebase: git rebase --abort"
    echo ""
    
    if ask_yes_no "Abort current merge/rebase?"; then
        if git merge --abort 2>/dev/null; then
            print_status "ok" "Merge aborted"
        elif git rebase --abort 2>/dev/null; then
            print_status "ok" "Rebase aborted"
        else
            print_status "info" "No merge or rebase in progress"
        fi
    fi
    press_any_key
}

cmd_discard_changes() {
    echo -e "\n${CYAN}━━━ Discard All Local Changes ━━━${NC}"
    echo ""
    echo "Options:"
    echo "  1) Discard unstaged changes only"
    echo "  2) Discard ALL changes (staged + unstaged)"
    echo ""
    read -p "Enter choice [1-2]: " discard_choice
    
    case $discard_choice in
        1)
            echo "Command: git checkout ."
            echo -e "${RED}⚠️  This will delete unstaged changes${NC}"
            if ask_yes_no "Proceed?"; then
                git checkout .
                print_status "ok" "Unstaged changes discarded"
            fi
            ;;
        2)
            echo "Commands: git reset --hard HEAD && git clean -fd"
            echo -e "${RED}⚠️  This will delete ALL local changes and untracked files${NC}"
            if ask_yes_no "Proceed?"; then
                git reset --hard HEAD
                git clean -fd
                print_status "ok" "All changes discarded"
            fi
            ;;
    esac
    press_any_key
}

cmd_reflog_recover() {
    echo -e "\n${CYAN}━━━ Recover Deleted Commits (Reflog) ━━━${NC}"
    echo ""
    echo "Git reflog shows all recent HEAD movements, including deleted commits."
    echo ""
    git reflog -10
    echo ""
    read -p "Enter commit hash to recover (or press Enter to skip): " recover_hash
    
    if [ -n "$recover_hash" ]; then
        echo ""
        echo "Options:"
        echo "  1) Create new branch from this commit: git checkout -b recovery-branch $recover_hash"
        echo "  2) Reset current branch to this commit: git reset --hard $recover_hash"
        read -p "Enter choice [1-2]: " recover_choice
        
        case $recover_choice in
            1)
                read -p "Enter new branch name: " new_branch
                git checkout -b "$new_branch" "$recover_hash"
                print_status "ok" "Created branch $new_branch from $recover_hash"
                ;;
            2)
                echo -e "${RED}⚠️  This will reset current branch${NC}"
                if ask_yes_no "Proceed?"; then
                    git reset --hard "$recover_hash"
                    print_status "ok" "Reset to $recover_hash"
                fi
                ;;
        esac
    fi
    press_any_key
}

# GitHub CLI Commands
cmd_gh_repo_create() {
    echo -e "\n${CYAN}━━━ gh repo create ━━━${NC}"
    echo "Create a new GitHub repository"
    echo ""
    
    if ! command -v gh &> /dev/null; then
        print_status "error" "GitHub CLI not installed"
        press_any_key
        return
    fi
    
    echo "Command: gh repo create"
    echo ""
    
    if ask_yes_no "Run interactive repo creation?"; then
        gh repo create
    fi
    press_any_key
}

cmd_gh_pr_create() {
    echo -e "\n${CYAN}━━━ gh pr create ━━━${NC}"
    echo "Create a pull request"
    echo ""
    
    if ! command -v gh &> /dev/null; then
        print_status "error" "GitHub CLI not installed"
        press_any_key
        return
    fi
    
    echo "Command: gh pr create"
    echo ""
    
    if ask_yes_no "Create pull request?"; then
        gh pr create
    fi
    press_any_key
}

cmd_gh_pr_list() {
    echo -e "\n${CYAN}━━━ gh pr list ━━━${NC}"
    echo "List pull requests"
    echo ""
    
    if ! command -v gh &> /dev/null; then
        print_status "error" "GitHub CLI not installed"
        press_any_key
        return
    fi
    
    gh pr list
    press_any_key
}

cmd_gh_pr_view() {
    echo -e "\n${CYAN}━━━ gh pr view ━━━${NC}"
    echo "View pull request details"
    echo ""
    
    if ! command -v gh &> /dev/null; then
        print_status "error" "GitHub CLI not installed"
        press_any_key
        return
    fi
    
    read -p "Enter PR number (or press Enter for current branch): " pr_number
    
    if [ -n "$pr_number" ]; then
        gh pr view "$pr_number"
    else
        gh pr view
    fi
    press_any_key
}

cmd_gh_pr_merge() {
    echo -e "\n${CYAN}━━━ gh pr merge ━━━${NC}"
    echo "Merge a pull request"
    echo ""
    
    if ! command -v gh &> /dev/null; then
        print_status "error" "GitHub CLI not installed"
        press_any_key
        return
    fi
    
    read -p "Enter PR number (or press Enter for current branch): " pr_number
    
    echo ""
    echo "Merge options:"
    echo "  --merge    - Create merge commit"
    echo "  --squash   - Squash and merge"
    echo "  --rebase   - Rebase and merge"
    echo ""
    
    if [ -n "$pr_number" ]; then
        if ask_yes_no "Merge PR #$pr_number?"; then
            gh pr merge "$pr_number"
        fi
    else
        if ask_yes_no "Merge current PR?"; then
            gh pr merge
        fi
    fi
    press_any_key
}

cmd_gh_repo_view() {
    echo -e "\n${CYAN}━━━ gh repo view ━━━${NC}"
    echo "View repository details"
    echo ""
    
    if ! command -v gh &> /dev/null; then
        print_status "error" "GitHub CLI not installed"
        press_any_key
        return
    fi
    
    gh repo view
    press_any_key
}

# ============================================
# CREATE GITHUB REPO (get the URL, you handle the rest)
# ============================================
step_create_github_repo() {
    print_header "Create GitHub Repository"

    # ── Pre-flight: gh CLI + auth ──────────────────────────────────
    if ! command -v gh &> /dev/null; then
        print_status "error" "GitHub CLI is not installed. Please run Step 3 first."
        press_any_key
        return
    fi

    if ! gh auth status &> /dev/null 2>&1; then
        print_status "error" "Not authenticated with GitHub. Please run Step 6 first."
        press_any_key
        return
    fi

    GH_USER=$(gh api user --jq '.login' 2>/dev/null)
    print_status "ok" "Logged in as: $GH_USER"

    # ── Repo details ───────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}━━━ New Repository Details ━━━${NC}"
    echo ""

    read -p "Repository name: " repo_name
    if [ -z "$repo_name" ]; then
        print_status "error" "Repository name cannot be empty."
        press_any_key
        return
    fi

    read -p "Description (optional, press Enter to skip): " repo_desc

    echo ""
    echo "Visibility:"
    echo "  1) Public"
    echo "  2) Private"
    read -p "Enter choice [1-2] (default: 2): " vis_choice
    case $vis_choice in
        1) VISIBILITY="public"  ;;
        *) VISIBILITY="private" ;;
    esac

    echo ""
    echo -e "${CYAN}Summary:${NC}"
    echo "  Name        : $repo_name"
    echo "  Description : ${repo_desc:-(none)}"
    echo "  Visibility  : $VISIBILITY"
    echo "  Owner       : $GH_USER"
    echo ""

    if ! ask_yes_no "Create this repository on GitHub?"; then
        print_status "info" "Cancelled."
        press_any_key
        return
    fi

    # ── Create the repo (no clone, no push, just create) ──────────
    print_status "info" "Creating repository on GitHub..."

    if [ -n "$repo_desc" ]; then
        CREATE_OUTPUT=$(gh repo create "$repo_name" "--$VISIBILITY" --description "$repo_desc" 2>&1)
    else
        CREATE_OUTPUT=$(gh repo create "$repo_name" "--$VISIBILITY" 2>&1)
    fi
    CREATE_EXIT=$?

    if [ $CREATE_EXIT -eq 0 ]; then
        print_status "ok" "Repository created successfully!"
        log "Created GitHub repo: $GH_USER/$repo_name ($VISIBILITY)"
    else
        print_status "error" "Failed to create repository:"
        echo "$CREATE_OUTPUT"
        log "Failed to create repo: $repo_name"
        press_any_key
        return
    fi

    # ── Display both URLs ──────────────────────────────────────────
    SSH_URL="git@github.com:${GH_USER}/${repo_name}.git"
    HTTPS_URL="https://github.com/${GH_USER}/${repo_name}.git"
    WEB_URL="https://github.com/${GH_USER}/${repo_name}"

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  Repository Ready!                                        ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}  SSH URL   : ${CYAN}$SSH_URL${NC}"
    echo -e "${GREEN}║${NC}  HTTPS URL : ${CYAN}$HTTPS_URL${NC}"
    echo -e "${GREEN}║${NC}  Web       : ${CYAN}$WEB_URL${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}  To link your local repo:                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}git remote add origin $SSH_URL${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}git push -u origin main${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    log "Repo URLs — SSH: $SSH_URL  HTTPS: $HTTPS_URL"

    if ask_yes_no "Open repository in browser?"; then
        gh repo view "$GH_USER/$repo_name" --web 2>/dev/null \
            || (command -v xdg-open &>/dev/null && xdg-open "$WEB_URL") \
            || echo "Open manually: $WEB_URL"
    fi

    press_any_key
}

# ============================================
# FULL SETUP MODE
# ============================================
run_full_setup() {
    print_header "Running Full Setup"
    
    log "Starting full setup mode"
    
    step_system_detection
    step_git_check
    step_gh_cli_check
    step_git_config
    step_ssh_management
    step_github_auth
    step_repo_connection
    step_summary_report
    
    print_status "ok" "Full setup completed!"
    log "Full setup completed"
    
    press_any_key
}

# ============================================
# MAIN MENU
# ============================================
show_main_menu() {
    while true; do
        clear
        echo -e "${CYAN}"
        echo "╔═══════════════════════════════════════════════════════════╗"
        echo "║                                                           ║"
        echo "║         GitHub Environment Manager v1.1                   ║"
        echo "║                                                           ║"
        echo "╚═══════════════════════════════════════════════════════════╝"
        echo -e "${NC}"
        
        echo -e "${GREEN}Main Menu:${NC}"
        echo ""
        echo "  [1]  System Detection"
        echo "  [2]  Check/Install Git"
        echo "  [3]  Check/Install GitHub CLI"
        echo "  [4]  Configure Git Identity"
        echo "  [5]  SSH Key Management"
        echo "  [6]  GitHub Authentication"
        echo "  [7]  Repository Connection Check"
        echo "  [8]  View Summary Report"
        echo "  [9]  Git Command Toolbox"
        echo ""
        echo -e "  ${GREEN}[10] 🚀 Create GitHub Repo (get remote URL)${NC}"
        echo ""
        echo "  [0]  Exit"
        echo ""
        
        read -p "Enter choice [0-10]: " menu_choice
        
        case $menu_choice in
            1) step_system_detection ;;
            2) step_git_check ;;
            3) step_gh_cli_check ;;
            4) step_git_config ;;
            5) step_ssh_management ;;
            6) step_github_auth ;;
            7) step_repo_connection ;;
            8) step_summary_report ;;
            9) step_command_toolbox ;;
            10) step_create_github_repo ;;
            0)
                echo -e "\n${GREEN}Thanks for using GitHub Environment Manager!${NC}"
                log "Exiting script"
                exit 0
                ;;
            *)
                print_status "error" "Invalid choice. Please select 0-10."
                sleep 2
                ;;
        esac
    done
}

# ============================================
# INIT SCREEN
# ============================================
show_init_screen() {
    clear
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                                                           ║"
    echo "║         GitHub Environment Manager v1.1                   ║"
    echo "║                                                           ║"
    echo "║         Complete GitHub setup & configuration             ║"
    echo "║                                                           ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
    
    echo -e "${GREEN}Welcome!${NC} Choose your setup mode:"
    echo ""
    echo "  [1] 🚀 Run Full Setup (Steps 1-7 automatically)"
    echo "  [2] 📋 Main Menu (Pick steps manually)"
    echo ""
    echo "  [0] Exit"
    echo ""
    
    while true; do
        read -p "Enter choice [0-2]: " init_choice
        
        case $init_choice in
            1)
                run_full_setup
                show_main_menu
                break
                ;;
            2)
                show_main_menu
                break
                ;;
            0)
                echo -e "\n${GREEN}Goodbye!${NC}"
                exit 0
                ;;
            *)
                print_status "error" "Invalid choice. Please select 0, 1, or 2."
                ;;
        esac
    done
}

# ============================================
# MAIN EXECUTION
# ============================================
main() {
    log "GitHub Environment Manager started"
    
    # Initialize global variables
    OS=""
    PKG_MANAGER=""
    DOWNLOAD_TOOL=""
    
    show_init_screen
}

# Run the script
main
