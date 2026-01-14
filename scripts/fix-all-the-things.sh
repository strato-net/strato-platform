#!/bin/bash
#
# fix-all-the-things.sh
#
# Automatically fix GitHub issues using Claude Code.
# Runs completely non-interactively with verbose output.
#
# Usage:
#   ./fix-all-the-things.sh <issue_number> [issue_number2] [issue_number3] ...
#   ./fix-all-the-things.sh 5960
#   ./fix-all-the-things.sh 5960 5961 5962
#
# Requirements:
#   Tools:
#     - Claude Code CLI (claude) - npm install -g @anthropic-ai/claude-code
#     - GitHub CLI (gh) - https://cli.github.com/
#     - git - standard package manager
#     - jq - apt-get install jq or brew install jq
#     - timeout - part of coreutils
#
#   Environment Variables:
#     - GH_TOKEN - GitHub personal access token (scopes: repo, workflow)
#                  Can be set via .env file in repository root or exported
#
#   Location:
#     - Must be located in strato-platform/scripts/ directory
#

set -euo pipefail

# ============================================================================
# Configuration - HARDCODED FOR NOW
# ============================================================================

REPO="blockapps/strato-platform"
BASE_BRANCH="develop"
BRANCH_PREFIX="claude-auto-fix"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source .env file if it exists in the repository root
if [ -f "${PROJECT_DIR}/.env" ]; then
    echo "Loading environment variables from ${PROJECT_DIR}/.env"
    set -a  # automatically export all variables
    source "${PROJECT_DIR}/.env"
    set +a
fi

# Check for required GH_TOKEN environment variable
if [ -z "${GH_TOKEN:-}" ]; then
    echo "ERROR: GH_TOKEN environment variable is not set"
    echo "Please set it with: export GH_TOKEN='your-github-token'"
    exit 1
fi

# Parse command-line arguments for issue numbers
# If provided, use them; otherwise fall back to hardcoded defaults
if [ $# -gt 0 ]; then
    # Use command-line arguments
    ISSUE_NUMBERS=("$@")
    echo "Using ${#ISSUE_NUMBERS[@]} issue number(s) from command line: ${ISSUE_NUMBERS[*]}"
else
    # Fall back to hardcoded default values
    ISSUE_NUMBERS=(
        5990  # Update bridge and fileserver urls in the platform code
        5956  # Change tx result polling approach in the Bridge
        5941  # Network slowness caused by one validator being down
        5979  # Events on the activity feeds should be in alphabetical order
        5925  # Don't show % delta when basis is zero
        5954  # Daily slack notifications with network metrics
        5973  # Oracle price validation optimizations
        5957  # Net balance graph doesn't subtract LendingPool debt
        5963  # Hide sUSDST-USDST swap pool
        5937  # intermittent swap error notifications
    )
    echo "Using ${#ISSUE_NUMBERS[@]} hardcoded default issue numbers"
fi

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
# Argument Parsing (disabled - using hardcoded values)
# ============================================================================

# Using hardcoded ISSUE_NUMBERS and GH_TOKEN from Configuration section above

# ============================================================================
# Pre-flight Checks (run once)
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

if ! command -v git &> /dev/null; then
    log_error "git not found. Install git from your package manager"
    exit 1
fi
log_success "git found"

if ! command -v jq &> /dev/null; then
    log_error "jq not found. Install with: apt-get install jq (Ubuntu/Debian) or brew install jq (macOS)"
    exit 1
fi
log_success "jq found"

if ! command -v timeout &> /dev/null; then
    log_error "timeout command not found. Install coreutils from your package manager"
    exit 1
fi
log_success "timeout command found"

# Verify we're in the scripts directory of the repo
if [[ ! "$SCRIPT_DIR" =~ /scripts$ ]]; then
    log_warning "This script is intended to be run from strato-platform/scripts/"
    log_info "Current script location: ${SCRIPT_DIR}"
fi

# Change to the project directory
cd "$PROJECT_DIR" || {
    log_error "Failed to change to project directory: ${PROJECT_DIR}"
    exit 1
}
log_info "Changed to directory: $(pwd)"

# Verify we're in a git repository
if ! git rev-parse --is-inside-work-tree &> /dev/null; then
    log_error "Not inside a git repository"
    log_info "Project directory: ${PROJECT_DIR}"
    log_info "This script must be located in strato-platform/scripts/"
    exit 1
fi

# Verify we're in the correct repository
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
if [ "$REPO_NAME" != "strato-platform" ]; then
    log_error "Wrong repository: found '${REPO_NAME}', expected 'strato-platform'"
    log_info "This script must be run from the strato-platform repository"
    exit 1
fi
log_success "Inside strato-platform repository at ${PROJECT_DIR}"

log_info "Will process ${#ISSUE_NUMBERS[@]} issue(s): ${ISSUE_NUMBERS[*]}"

# Track results
declare -a SUCCESSFUL_ISSUES=()
declare -a FAILED_ISSUES=()
declare -a SKIPPED_ISSUES=()

# ============================================================================
# Process Each Issue
# ============================================================================

for ISSUE_NUMBER in "${ISSUE_NUMBERS[@]}"; do
    log_step "Processing Issue #${ISSUE_NUMBER} ($(( ${#SUCCESSFUL_ISSUES[@]} + ${#FAILED_ISSUES[@]} + ${#SKIPPED_ISSUES[@]} + 1 ))/${#ISSUE_NUMBERS[@]})"

    BRANCH_NAME="${BRANCH_PREFIX}-${ISSUE_NUMBER}"

    # Use a subshell to isolate errors and allow continuing on failure
    (
        set -e

        # ============================================================================
        # Fetch Issue Details
        # ============================================================================

        log_info "Fetching issue #${ISSUE_NUMBER} from ${REPO}..."

        ISSUE_JSON=$(gh issue view "$ISSUE_NUMBER" --repo "$REPO" --json title,body,labels 2>&1) || {
            log_error "Failed to fetch issue #${ISSUE_NUMBER}"
            log_error "$ISSUE_JSON"
            exit 1
        }

        ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
        ISSUE_BODY=$(echo "$ISSUE_JSON" | jq -r '.body // "No description provided"')
        ISSUE_LABELS=$(echo "$ISSUE_JSON" | jq -r '.labels[].name // empty' | tr '\n' ', ' | sed 's/,$//')

        log_success "Issue fetched: ${ISSUE_TITLE}"
        log_info "Labels: ${ISSUE_LABELS:-none}"

        # Check if issue description is too vague or short
        BODY_LENGTH=$(echo "$ISSUE_BODY" | wc -c)
        WORD_COUNT=$(echo "$ISSUE_BODY" | wc -w)

        if [ "$BODY_LENGTH" -lt 50 ] || [ "$WORD_COUNT" -lt 10 ]; then
            log_warning "Issue description is too vague or short (${WORD_COUNT} words)"
            log_info "Cleaning up any existing PR/branch and skipping..."

            # Clean up existing PR if it exists
            EXISTING_PR=$(gh pr view "$BRANCH_NAME" --repo "$REPO" --json number,url -q '.number' 2>/dev/null || echo "")
            if [ -n "$EXISTING_PR" ]; then
                log_warning "Found existing PR #${EXISTING_PR}, closing it..."
                gh pr close "$EXISTING_PR" --repo "$REPO" --delete-branch 2>/dev/null || true
            fi

            # Clean up local branch if it exists
            if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
                git checkout "$BASE_BRANCH" --quiet 2>/dev/null || true
                git branch -D "$BRANCH_NAME" 2>/dev/null || true
            fi

            # Clean up remote branch if it exists
            if git ls-remote --exit-code --heads origin "$BRANCH_NAME" &> /dev/null; then
                git push origin --delete "$BRANCH_NAME" 2>/dev/null || true
            fi

            # Add comment to the issue
            COMMENT="I attempted to auto-fix this issue, but the description is unclear or lacks sufficient detail to determine what needs to be fixed.

Please provide more information:
- What is the current behavior?
- What is the expected behavior?
- Steps to reproduce (if applicable)
- Any relevant error messages or screenshots

🤖 Auto-comment by Claude Code"

            gh issue comment "$ISSUE_NUMBER" --repo "$REPO" --body "$COMMENT" 2>/dev/null || log_warning "Failed to add comment to issue"

            log_info "Issue skipped due to vague description"
            exit 2  # Special exit code for "skipped"
        fi

        # ============================================================================
        # Prepare Git Branch
        # ============================================================================

        log_info "Preparing git branch..."

        git checkout "$BASE_BRANCH" --quiet
        git pull --quiet origin "$BASE_BRANCH"

        # Clean up any existing PR and branch for this issue (Claude only; leave GPT branches alone)
        log_info "Checking for existing PR for branch ${BRANCH_NAME}..."
        EXISTING_PR=$(gh pr view "$BRANCH_NAME" --repo "$REPO" --json number,url -q '.number' 2>/dev/null || echo "")
        if [ -n "$EXISTING_PR" ]; then
            log_warning "Found existing PR #${EXISTING_PR} for this branch, closing it..."
            gh pr close "$EXISTING_PR" --repo "$REPO" --delete-branch 2>/dev/null || true
            log_success "Closed PR #${EXISTING_PR}"
        fi

        if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
            log_warning "Branch ${BRANCH_NAME} already exists locally, deleting..."
            git branch -D "$BRANCH_NAME"
        fi

        if git ls-remote --exit-code --heads origin "$BRANCH_NAME" &> /dev/null; then
            log_warning "Branch ${BRANCH_NAME} exists on remote, deleting..."
            git push origin --delete "$BRANCH_NAME" 2>/dev/null || true
        fi

        git checkout -b "$BRANCH_NAME"
        log_success "Created branch ${BRANCH_NAME}"

        # ============================================================================
        # Run Claude Code to Fix the Issue
        # ============================================================================

        log_info "Running Claude Code (timeout: 20 minutes)..."

        # Build the prompt for Claude
        CLAUDE_PROMPT="You are fixing GitHub issue #${ISSUE_NUMBER} from ${REPO}.

ISSUE TITLE: ${ISSUE_TITLE}

ISSUE DESCRIPTION:
${ISSUE_BODY}

ISSUE LABELS: ${ISSUE_LABELS}

CODEBASE CONTEXT:
This is a blockchain/DeFi platform called STRATO/Mercata with multiple components:
- Frontend: React/TypeScript in mercata/ui/src/
- Backend services: Node.js/TypeScript in mercata/services/
  - Oracle service: Handles external price feeds (CoinGecko, etc.) in mercata/services/oracle/
  - Bridge service: Handles cross-chain token transfers
- Smart contracts: Solidity in mercata/contracts/
- Common patterns: Use existing utility functions, follow TypeScript conventions, prefer explicit error handling

PHASE 1 - DEEP CODEBASE EXPLORATION (DO THIS FIRST):
Before making any changes, thoroughly explore and understand:

1. Find ALL relevant files:
   - Search broadly for files related to this functionality
   - Look for similar patterns or related features in the codebase
   - Find utility functions, helpers, or shared code that might be relevant
   - Locate configuration files that might affect this issue
   - Find existing tests for this or similar features

2. Understand the architecture:
   - What is the data flow for this feature?
   - What are the dependencies of the code being changed?
   - How does this component fit into the larger system?
   - What design patterns or architectural decisions should we respect?

3. Learn from existing code:
   - How do other parts of the code handle similar situations?
   - What are the coding conventions and patterns used in this project?
   - Are there examples of similar fixes elsewhere?

4. Read documentation:
   - Check for README files in the relevant directories
   - Look for inline comments explaining complex logic
   - Review any architecture documentation

5. Answer these questions BEFORE implementing:
   - What is the root cause of this issue?
   - How did this bug likely get introduced?
   - Are there similar patterns elsewhere that might have the same issue?
   - What would prevent this type of bug in the future?

PHASE 2 - IMPLEMENT THE FIX:
1. Make minimal, focused changes - only change what's necessary
2. Follow existing code patterns and conventions
3. Add comments explaining non-obvious logic
4. Consider edge cases and error handling

PHASE 3 - CREATE DETAILED COMMIT:
Create a git commit with a COMPREHENSIVE message that includes:

- A brief summary line referencing the issue (#${ISSUE_NUMBER})
- A blank line
- **Files Changed**: List all modified files with brief explanation of what changed in each
- **Current Behavior**: What the code currently does that causes the issue
- **Root Cause**: Why this behavior occurs (be specific about the code and architecture)
- **Fix Applied**: What changes were made and why they solve the problem
- **Impact Analysis**:
  - What other features might be affected by this change
  - Any potential side effects or risks
  - Related code that uses similar patterns (not modified but relevant)
- **Testing Recommendations**: What should be tested to verify this fix
- **Confidence Level**: Rate your understanding and confidence (Low/Medium/High)
- End with: Co-Authored-By: Claude <noreply@anthropic.com>

COMMIT MESSAGE EXAMPLE FORMAT:
fix: Address health factor display issue (#5960)

Files Changed:
- mercata/ui/src/pages/Borrow.tsx: Added polling mechanism in transaction handlers

Current Behavior:
After submitting a collateral supply transaction, the health factor briefly
shows the new value but then reverts to the old value.

Root Cause:
The component fetches loan data immediately after the transaction completes,
but the blockchain state has not yet propagated. The stale data overwrites
the optimistic UI update. This is a common issue in blockchain UIs where
transaction completion doesn't mean state is immediately queryable.

Fix Applied:
Added a pollForLoanUpdate() helper function that waits for the loan data to
actually change before updating the UI. The poll checks every 500ms for up to
10 seconds until the health factor reflects the new collateral amount. This
matches the pattern used in other transaction-heavy components.

Impact Analysis:
- Affects: Supply, Withdraw, Borrow, and Repay operations in lending pools
- Risk: Low - adds retry logic without changing core transaction flow
- Related: Similar polling exists in mercata/ui/src/pages/Swap.tsx for swap
  confirmations, and mercata/ui/src/pages/Bridge.tsx for bridge operations

Testing Recommendations:
- Test all four operations (supply, withdraw, borrow, repay) in lending pools
- Verify health factor updates correctly after each operation
- Test on slow network conditions to ensure polling timeout is adequate
- Verify UI doesn't freeze during polling

Confidence Level: High
- Root cause clearly identified through code analysis
- Solution follows existing patterns in the codebase
- All transaction handlers updated consistently

Co-Authored-By: Claude <noreply@anthropic.com>

SELF-CHECK BEFORE COMMITTING:
Rate your understanding. You should be able to check ALL these boxes:
- [ ] I understand the root cause completely
- [ ] I understand how this feature fits in the larger system
- [ ] I've identified all files that need changes
- [ ] I've checked for similar issues elsewhere in the codebase
- [ ] I've followed existing code patterns and conventions
- [ ] I've considered edge cases and potential side effects

If you can't check all boxes, explain what's unclear in your commit message.

IMPORTANT:
- Take your time to understand the codebase thoroughly - QUALITY OVER SPEED
- Read multiple related files before making changes
- Don't rush to a solution - explore first, then implement
- Do NOT push to remote or create a PR - just make the commit locally
- Do NOT run tests - just implement the fix (but note what should be tested)
- If the issue is already fixed, create a commit explaining why
- If after thorough investigation the issue is UNCLEAR or VAGUE (you cannot determine what needs to be fixed or how to fix it), do NOT make any code changes. Instead, create a file called SKIP_ISSUE.txt in the repo root with the reason why it's unclear. This will signal the script to skip and add a comment to the issue.
- Use the TodoWrite tool to track your progress through the phases

Work autonomously. Do not ask questions. Make your best effort."

        echo "----------------------------------------"

        set +e
        timeout 1200 claude \
            --dangerously-skip-permissions \
            --verbose \
            --output-format stream-json \
            -p "$CLAUDE_PROMPT" 2>&1 | while IFS= read -r line; do
            # Parse JSON lines and format nicely
            if echo "$line" | jq -e '.' &>/dev/null 2>&1; then
                TYPE=$(echo "$line" | jq -r '.type // "unknown"' 2>/dev/null)

                case "$TYPE" in
                    "assistant")
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
                        echo -e "${BLUE}[$TYPE]${NC}"
                        ;;
                esac
            else
                [ -n "$line" ] && echo "$line"
            fi
        done
        CLAUDE_EXIT_CODE=${PIPESTATUS[0]}
        set -e

        echo "----------------------------------------"

        if [ $CLAUDE_EXIT_CODE -eq 124 ]; then
            log_error "Claude timed out after 20 minutes"
            exit 1
        elif [ $CLAUDE_EXIT_CODE -ne 0 ]; then
            log_warning "Claude exited with code ${CLAUDE_EXIT_CODE}"
        fi

        # ============================================================================
        # Check Results
        # ============================================================================

        log_info "Checking results..."

        # Check if Claude determined the issue is unclear/vague
        if [ -f "SKIP_ISSUE.txt" ]; then
            SKIP_REASON=$(cat SKIP_ISSUE.txt)
            log_warning "Claude determined issue is unclear: ${SKIP_REASON}"

            # Clean up the file
            rm SKIP_ISSUE.txt

            # Add comment to the issue
            COMMENT="I attempted to auto-fix this issue after thorough code analysis, but determined it is unclear or lacks sufficient detail.

**Reason:**
${SKIP_REASON}

Please provide more information or clarify the requirements so this can be addressed properly.

🤖 Auto-comment by Claude Code"

            gh issue comment "$ISSUE_NUMBER" --repo "$REPO" --body "$COMMENT" 2>/dev/null || log_warning "Failed to add comment to issue"

            log_info "Cleaning up branch..."
            git checkout "$BASE_BRANCH" --quiet
            git branch -D "$BRANCH_NAME" 2>/dev/null || true
            exit 2  # Special exit code for "skipped"
        fi

        log_info "Checking git status..."
        GIT_STATUS=$(git status --porcelain)

        if [ -n "$GIT_STATUS" ]; then
            log_warning "Uncommitted changes detected, creating commit..."
            git add -A
            git commit -m "fix: Address issue #${ISSUE_NUMBER} - ${ISSUE_TITLE}

Auto-generated fix by Claude Code.

Co-Authored-By: Claude <noreply@anthropic.com>"
        fi

        # Check if we have any new commits
        COMMITS_AHEAD=$(git rev-list --count "${BASE_BRANCH}..HEAD")

        if [ "$COMMITS_AHEAD" -eq 0 ]; then
            log_warning "No commits were made for issue #${ISSUE_NUMBER}"
            git checkout "$BASE_BRANCH" --quiet
            git branch -D "$BRANCH_NAME" 2>/dev/null || true
            exit 2  # Special exit code for "skipped"
        fi

        log_success "Branch has ${COMMITS_AHEAD} commit(s)"

        # ============================================================================
        # Push and Create PR
        # ============================================================================

        log_info "Pushing branch and creating PR..."
        git push -u origin "$BRANCH_NAME" --force

        # Get the commit message which contains the detailed analysis
        COMMIT_MSG=$(git log -1 --format="%B")

        PR_BODY="## Summary
This PR addresses issue #${ISSUE_NUMBER}.

## Issue
**${ISSUE_TITLE}**

${ISSUE_BODY:0:1000}

## Analysis & Fix
\`\`\`
${COMMIT_MSG}
\`\`\`

---
🤖 Generated with [Claude Code](https://claude.ai/claude-code)
"

        PR_URL=$(gh pr create \
            --repo "$REPO" \
            --base "$BASE_BRANCH" \
            --head "$BRANCH_NAME" \
            --title "Fix #${ISSUE_NUMBER}: ${ISSUE_TITLE}" \
            --body "$PR_BODY" \
            --label "ai-fixes-experimental" \
            2>&1) || {
            PR_URL=$(gh pr view "$BRANCH_NAME" --repo "$REPO" --json url -q '.url' 2>/dev/null || echo "unknown")
        }

        log_success "PR created: ${PR_URL}"

        # Return to base branch for next iteration
        git checkout "$BASE_BRANCH" --quiet

    ) && {
        SUCCESSFUL_ISSUES+=("$ISSUE_NUMBER")
        log_success "Issue #${ISSUE_NUMBER} completed successfully"
    } || {
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 2 ]; then
            SKIPPED_ISSUES+=("$ISSUE_NUMBER")
            log_warning "Issue #${ISSUE_NUMBER} skipped (no changes made)"
        else
            FAILED_ISSUES+=("$ISSUE_NUMBER")
            log_error "Issue #${ISSUE_NUMBER} failed"
        fi
        # Make sure we're back on base branch
        git checkout "$BASE_BRANCH" --quiet 2>/dev/null || true
    }

    echo ""
done

# ============================================================================
# Summary
# ============================================================================

log_step "Summary"

echo -e "${GREEN}"
echo "========================================"
echo "  Processing Complete!"
echo "========================================"
echo -e "${NC}"
echo ""

if [ ${#SUCCESSFUL_ISSUES[@]} -gt 0 ]; then
    log_success "Successful (${#SUCCESSFUL_ISSUES[@]}): ${SUCCESSFUL_ISSUES[*]}"
fi

if [ ${#SKIPPED_ISSUES[@]} -gt 0 ]; then
    log_warning "Skipped (${#SKIPPED_ISSUES[@]}): ${SKIPPED_ISSUES[*]}"
fi

if [ ${#FAILED_ISSUES[@]} -gt 0 ]; then
    log_error "Failed (${#FAILED_ISSUES[@]}): ${FAILED_ISSUES[*]}"
fi

echo ""
log_info "Total: ${#ISSUE_NUMBERS[@]} issues processed"
log_warning "Remember to review the PRs before merging!"

# Exit with error if any issues failed
if [ ${#FAILED_ISSUES[@]} -gt 0 ]; then
    exit 1
fi
