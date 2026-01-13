#!/bin/bash
#
# fix-all-the-things.sh
#
# Automatically fix GitHub issues using Claude Code.
# Runs completely non-interactively with verbose output.
#
# Usage:
#   ./fix-all-the-things.sh <issue_number>
#   ./fix-all-the-things.sh 5960
#
# Requirements:
#   - Claude Code CLI installed (claude command)
#   - GitHub CLI installed (gh command)
#   - GH_TOKEN environment variable set, or passed as second argument
#

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

REPO="blockapps/strato-platform"
BASE_BRANCH="develop"
BRANCH_PREFIX="claude-auto-fix"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "\n${CYAN}========================================${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}========================================${NC}\n"
}

# ============================================================================
# Argument Parsing
# ============================================================================

if [ $# -lt 1 ]; then
    log_error "Usage: $0 <issue_number> [gh_token]"
    log_info "Example: $0 5960"
    log_info "Example: $0 5960 ghp_xxxxxxxxxxxx"
    exit 1
fi

ISSUE_NUMBER="$1"
GH_TOKEN="${2:-${GH_TOKEN:-}}"

if [ -z "$GH_TOKEN" ]; then
    log_error "GH_TOKEN not set. Pass as second argument or set GH_TOKEN environment variable."
    exit 1
fi

export GH_TOKEN

BRANCH_NAME="${BRANCH_PREFIX}-${ISSUE_NUMBER}"

# ============================================================================
# Pre-flight Checks
# ============================================================================

log_step "Pre-flight Checks"

log_info "Checking for required tools..."

if ! command -v claude &> /dev/null; then
    log_error "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
    exit 1
fi
log_success "Claude Code CLI found"

if ! command -v gh &> /dev/null; then
    log_error "GitHub CLI not found. Install from: https://cli.github.com/"
    exit 1
fi
log_success "GitHub CLI found"

if ! git rev-parse --is-inside-work-tree &> /dev/null; then
    log_error "Not inside a git repository"
    exit 1
fi
log_success "Inside git repository"

# ============================================================================
# Fetch Issue Details
# ============================================================================

log_step "Fetching Issue #${ISSUE_NUMBER}"

log_info "Retrieving issue from ${REPO}..."

ISSUE_JSON=$(gh issue view "$ISSUE_NUMBER" --repo "$REPO" --json title,body,labels 2>&1) || {
    log_error "Failed to fetch issue #${ISSUE_NUMBER}"
    log_error "$ISSUE_JSON"
    exit 1
}

ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
ISSUE_BODY=$(echo "$ISSUE_JSON" | jq -r '.body // "No description provided"')
ISSUE_LABELS=$(echo "$ISSUE_JSON" | jq -r '.labels[].name // empty' | tr '\n' ', ' | sed 's/,$//')

log_success "Issue fetched successfully"
echo ""
log_info "Title: ${ISSUE_TITLE}"
log_info "Labels: ${ISSUE_LABELS:-none}"
echo ""
log_info "Description (first 500 chars):"
echo "${ISSUE_BODY:0:500}..."

# ============================================================================
# Prepare Git Branch
# ============================================================================

log_step "Preparing Git Branch"

log_info "Ensuring we're on ${BASE_BRANCH} and up to date..."
git checkout "$BASE_BRANCH" --quiet
git pull --quiet origin "$BASE_BRANCH"
log_success "On ${BASE_BRANCH}, up to date with origin"

log_info "Checking if branch ${BRANCH_NAME} already exists..."
if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
    log_warning "Branch ${BRANCH_NAME} already exists locally, deleting..."
    git branch -D "$BRANCH_NAME"
fi

if git ls-remote --exit-code --heads origin "$BRANCH_NAME" &> /dev/null; then
    log_warning "Branch ${BRANCH_NAME} exists on remote, will create fresh local branch"
fi

log_info "Creating new branch: ${BRANCH_NAME}"
git checkout -b "$BRANCH_NAME"
log_success "Created and switched to branch ${BRANCH_NAME}"

# ============================================================================
# Run Claude Code to Fix the Issue
# ============================================================================

log_step "Running Claude Code to Fix Issue #${ISSUE_NUMBER}"

log_info "This may take several minutes..."
log_info "Claude will analyze the issue, explore the codebase, and implement a fix."
echo ""

# Build the prompt for Claude
CLAUDE_PROMPT="You are fixing GitHub issue #${ISSUE_NUMBER} from ${REPO}.

ISSUE TITLE: ${ISSUE_TITLE}

ISSUE DESCRIPTION:
${ISSUE_BODY}

ISSUE LABELS: ${ISSUE_LABELS}

YOUR TASK:
1. Analyze this issue carefully to understand what needs to be fixed
2. Search the codebase to find the relevant files
3. Implement a fix for this issue
4. Make your changes minimal and focused - only change what's necessary
5. After making changes, create a git commit with a detailed message that:
   - References the issue number (#${ISSUE_NUMBER})
   - Explains the root cause of the issue
   - Describes the fix implemented
   - Ends with: Co-Authored-By: Claude <noreply@anthropic.com>

IMPORTANT:
- Do NOT push to remote or create a PR - just make the commit locally
- Do NOT run tests - just implement the fix
- If the issue is already fixed or cannot be fixed, still create a commit explaining why
- Be thorough in your analysis but efficient in your changes
- Use the TodoWrite tool to track your progress

Work autonomously. Do not ask questions. Make your best effort."

log_info "Invoking Claude Code with streaming output..."
log_info "Timeout: 10 minutes"
echo "----------------------------------------"

# Run Claude with dangerously-skip-permissions for non-interactive mode
# Use --output-format stream-json for realtime streaming output
# Set a timeout of 10 minutes for the entire operation
set +e
timeout 600 claude \
    --dangerously-skip-permissions \
    --verbose \
    --output-format stream-json \
    -p "$CLAUDE_PROMPT" 2>&1 | while IFS= read -r line; do
    # Parse JSON lines and format nicely
    if echo "$line" | jq -e '.' &>/dev/null 2>&1; then
        TYPE=$(echo "$line" | jq -r '.type // "unknown"' 2>/dev/null)

        case "$TYPE" in
            "assistant")
                # Extract ALL content from assistant messages - text and tool uses with full details
                echo "$line" | jq -r '
                    if .message.content then
                        .message.content[] |
                        if .type == "text" then
                            "💬 " + .text
                        elif .type == "tool_use" then
                            "🔧 TOOL: " + .name + "\n" +
                            (if .name == "Bash" then
                                "   Command: " + (.input.command // "?")
                            elif .name == "Read" then
                                "   File: " + (.input.file_path // "?")
                            elif .name == "Edit" then
                                "   File: " + (.input.file_path // "?") + "\n" +
                                "   Replacing: " + ((.input.old_string // "?") | .[0:100]) + "..."
                            elif .name == "Write" then
                                "   File: " + (.input.file_path // "?")
                            elif .name == "Grep" then
                                "   Pattern: " + (.input.pattern // "?") + " in " + (.input.path // ".")
                            elif .name == "Glob" then
                                "   Pattern: " + (.input.pattern // "?")
                            elif .name == "TodoWrite" then
                                "   Todos: " + ((.input.todos // []) | length | tostring) + " items"
                            else
                                "   Input: " + ((.input // {}) | tostring | .[0:200])
                            end)
                        else empty
                        end
                    else empty end
                ' 2>/dev/null | while IFS= read -r content_line; do
                    if [ -n "$content_line" ]; then
                        echo -e "${CYAN}${content_line}${NC}"
                    fi
                done
                ;;
            "user")
                echo -e "${BLUE}[User message sent]${NC}"
                ;;
            "result")
                # Tool results - show more detail
                TOOL_NAME=$(echo "$line" | jq -r '.tool // "unknown"' 2>/dev/null)
                TOOL_RESULT=$(echo "$line" | jq -r '
                    if .result then
                        .result | tostring | .[0:500]
                    else "no result" end
                ' 2>/dev/null)
                echo -e "${GREEN}✓ ${TOOL_NAME} result:${NC}"
                echo "$TOOL_RESULT" | head -10 | sed 's/^/    /'
                if [ $(echo "$TOOL_RESULT" | wc -l) -gt 10 ]; then
                    echo "    ... (truncated)"
                fi
                ;;
            "system")
                SYS_MSG=$(echo "$line" | jq -r '.message // empty' 2>/dev/null)
                echo -e "${YELLOW}[System]${NC} $SYS_MSG"
                ;;
            *)
                # Show other types for debugging
                echo -e "${BLUE}[$TYPE]${NC}"
                ;;
        esac
    else
        # Non-JSON output (stderr, raw text, etc) - print as-is
        [ -n "$line" ] && echo "$line"
    fi
done
CLAUDE_EXIT_CODE=${PIPESTATUS[0]}
set -e

echo "----------------------------------------"

if [ $CLAUDE_EXIT_CODE -eq 124 ]; then
    log_error "Claude timed out after 10 minutes"
    exit 1
elif [ $CLAUDE_EXIT_CODE -ne 0 ]; then
    log_warning "Claude exited with code ${CLAUDE_EXIT_CODE}"
fi

# ============================================================================
# Check Results
# ============================================================================

log_step "Checking Results"

log_info "Checking git status..."
GIT_STATUS=$(git status --porcelain)

if [ -n "$GIT_STATUS" ]; then
    log_warning "Uncommitted changes detected:"
    echo "$GIT_STATUS"
    log_info "Creating commit for uncommitted changes..."
    git add -A
    git commit -m "fix: Address issue #${ISSUE_NUMBER} - ${ISSUE_TITLE}

Auto-generated fix by Claude Code.

Co-Authored-By: Claude <noreply@anthropic.com>"
fi

# Check if we have any new commits
COMMITS_AHEAD=$(git rev-list --count "${BASE_BRANCH}..HEAD")

if [ "$COMMITS_AHEAD" -eq 0 ]; then
    log_warning "No commits were made. The issue may already be fixed or Claude couldn't determine a fix."
    log_info "Cleaning up branch..."
    git checkout "$BASE_BRANCH"
    git branch -D "$BRANCH_NAME"
    exit 0
fi

log_success "Branch has ${COMMITS_AHEAD} commit(s) ahead of ${BASE_BRANCH}"

# Show the commits
log_info "Commits made:"
git log --oneline "${BASE_BRANCH}..HEAD"

# ============================================================================
# Push and Create PR
# ============================================================================

log_step "Pushing Branch and Creating Pull Request"

log_info "Pushing branch ${BRANCH_NAME} to origin..."
git push -u origin "$BRANCH_NAME" --force

log_success "Branch pushed successfully"

log_info "Creating pull request..."

PR_BODY="## Summary
This PR addresses issue #${ISSUE_NUMBER}.

## Issue
**${ISSUE_TITLE}**

${ISSUE_BODY:0:1000}

## Changes
Auto-generated fix by Claude Code. Please review carefully before merging.

---
🤖 Generated with [Claude Code](https://claude.ai/claude-code)
"

PR_URL=$(gh pr create \
    --repo "$REPO" \
    --base "$BASE_BRANCH" \
    --head "$BRANCH_NAME" \
    --title "Fix #${ISSUE_NUMBER}: ${ISSUE_TITLE}" \
    --body "$PR_BODY" \
    2>&1) || {
    log_warning "Failed to create PR (may already exist)"
    PR_URL=$(gh pr view "$BRANCH_NAME" --repo "$REPO" --json url -q '.url' 2>/dev/null || echo "unknown")
}

log_success "Pull request created/found: ${PR_URL}"

# ============================================================================
# Done
# ============================================================================

log_step "Complete!"

echo -e "${GREEN}"
echo "========================================"
echo "  Issue #${ISSUE_NUMBER} fix complete!"
echo "========================================"
echo -e "${NC}"
echo ""
log_info "Branch: ${BRANCH_NAME}"
log_info "PR URL: ${PR_URL}"
echo ""
log_warning "Remember to review the changes before merging!"
