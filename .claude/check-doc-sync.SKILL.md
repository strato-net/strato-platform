---
name: check-doc-sync
description: Verify that public documentation on docs.strato.nexus matches the source files in /techdocs
allowed-tools:
  - Read
  - Grep
  - Glob
  - WebFetch(domain:docs.strato.nexus)
  - Bash(diff:*)
---

# Documentation Sync Checker

Verify that the published documentation at https://docs.strato.nexus matches the source files in `/techdocs` and identify any discrepancies.

## Purpose

Ensure that:
1. Published docs reflect the latest source content
2. MkDocs configuration is correctly building all pages
3. No broken links exist on the live site
4. Navigation structure matches `mkdocs.yml`

## What to Do When Invoked

When the user runs `/check-doc-sync` or `/check-doc-sync [specific-page]`:

### 1. Verify MkDocs Configuration

Read `mkdocs.yml` and check:
- `docs_dir` points to `techdocs/`
- All files in `nav:` section exist in `/techdocs`
- Custom CSS files exist at specified paths
- Theme configuration is valid
- Plugins are properly configured

### 2. Compare Source vs Published Content

For each documentation page (or specified page):

**Fetch Published Version:**
```
https://docs.strato.nexus/[path-without-md]
```

**Read Source File:**
```
/techdocs/[path].md
```

**Compare:**
- Content parity (major sections present)
- Code examples match
- Links are not broken
- Images/diagrams render correctly
- Last modified dates are reasonable

### 3. Check for Common Issues

**Navigation Issues:**
- [ ] Pages in `/techdocs` but not in `mkdocs.yml` nav
- [ ] Pages in `mkdocs.yml` nav but missing from `/techdocs`
- [ ] Orphaned pages (no links pointing to them)

**Link Issues:**
- [ ] Broken internal links (e.g., `[text](missing-file.md)`)
- [ ] Broken anchor links (e.g., `[text](file.md#nonexistent-section)`)
- [ ] Incorrect relative paths
- [ ] Links to `/docs` from `/techdocs` (internal docs not published)

**Content Issues:**
- [ ] Source file modified but published version outdated
- [ ] MkDocs build errors (check for invalid markdown)
- [ ] Missing frontmatter or metadata

**Styling Issues:**
- [ ] Broken admonition blocks (`!!!tip` rendered as text)
- [ ] Mermaid diagrams not rendering
- [ ] Code blocks without language specification
- [ ] Tables with formatting issues

### 4. Output Format

```markdown
## Documentation Sync Report

**Generated:** [timestamp]
**MkDocs Version:** [from mkdocs.yml site_name/version]
**Published Site:** https://docs.strato.nexus

---

### ✅ Sync Status: [OK / NEEDS ATTENTION / CRITICAL]

### Summary Statistics

- Total source files: X
- Files in navigation: Y
- Orphaned files: Z
- Broken links found: N
- Last deployment: [check if available]

---

### Critical Issues (Requires Immediate Action)

1. **[Issue Title]**
   - **Impact:** [What users see/can't access]
   - **Source:** `techdocs/path/to/file.md:123`
   - **Published:** https://docs.strato.nexus/path/to/page
   - **Problem:** [Specific description]
   - **Fix:** [Concrete action needed]

---

### Warnings (Should Be Addressed)

1. **[Warning Title]**
   - Location: [file:line]
   - Issue: [description]
   - Suggestion: [how to fix]

---

### Navigation Analysis

**Pages in nav but missing source:**
- path/to/missing.md

**Source files not in nav (orphaned):**
- path/to/orphaned.md

**Broken internal links:**
| Source File | Line | Broken Link | Target |
|-------------|------|-------------|--------|
| file.md | 42 | [text](bad.md) | File not found |

---

### Content Drift Detection

**Files with potential drift:**
| File | Source Modified | Published | Status |
|------|----------------|-----------|---------|
| guide.md | 2026-01-20 | Seems older | ⚠️ Check |

---

### Recommendations

1. [Priority 1 recommendation]
2. [Priority 2 recommendation]
3. [Priority 3 recommendation]
```

### 5. Specific Checks

**For API Documentation:**
- Verify endpoints match Swagger spec
- Check that interactive Swagger UI link works
- Ensure OAuth flow documentation is current

**For User Guides:**
- Verify step-by-step instructions are complete
- Check that screenshots/examples are referenced correctly
- Ensure cross-references to related guides work

**For Architecture Docs:**
- Verify diagrams render correctly (Mermaid)
- Check that component descriptions match system
- Ensure technical specs are current

## Usage Examples

### Example 1: Full Site Check

**User:** `/check-doc-sync`

**Action:**
1. Read `mkdocs.yml` navigation structure
2. Glob all files in `/techdocs`
3. For each page in navigation:
   - Verify source file exists
   - Fetch published URL
   - Compare major sections
   - Check internal links
4. Report orphaned files
5. Report broken links
6. Estimate last deployment date

### Example 2: Single Page Check

**User:** `/check-doc-sync techdocs/guides/borrow.md`

**Action:**
1. Read source file
2. Fetch https://docs.strato.nexus/guides/borrow
3. Extract all internal links from source
4. Verify each link target exists
5. Compare content sections
6. Check for broken images/diagrams
7. Report detailed comparison

### Example 3: Navigation Only

**User:** `/check-doc-sync --nav-only`

**Action:**
1. Read `mkdocs.yml` nav section
2. Verify each file in nav exists in `/techdocs`
3. Find files in `/techdocs` not in nav
4. Report discrepancies
5. Suggest nav additions

## Technical Implementation

### Mapping Source to Published URLs

```python
# Source path to URL mapping
techdocs/index.md → https://docs.strato.nexus/
techdocs/guides/borrow.md → https://docs.strato.nexus/guides/borrow
techdocs/reference/api.md → https://docs.strato.nexus/reference/api
```

### Link Validation

For each markdown link found:

```markdown
[text](../other-file.md) → Check if file exists
[text](file.md#section) → Check if file exists AND has heading
[text](https://external.com) → Skip or optional web check
```

### Content Comparison Strategy

Don't do byte-by-byte comparison (MkDocs transforms markdown).

Instead, check:
- ✅ Major headings are present (##, ###)
- ✅ Code blocks exist with same language tags
- ✅ Lists have same number of items (approximately)
- ✅ Important keywords/phrases appear
- ⚠️ Don't worry about minor wording changes

### Detecting Last Deployment

Check for:
1. Git revision dates in published page footer
2. "Last updated" timestamps in Material theme
3. Compare with `git log -- techdocs/` recent commits

## Common Issues and Solutions

### Issue: "Published docs seem outdated"

**Check:**
1. Recent commits to `/techdocs` directory
2. CI/CD pipeline status (if visible)
3. Build artifacts or deployment logs
4. Last modified date on published site

**Report:**
```markdown
⚠️ Potential Stale Deployment
- Source last modified: 2026-01-20 (git log)
- Published shows: "Last updated: 2026-01-15"
- Recommendation: Trigger docs rebuild/deployment
```

### Issue: "Broken internal links"

**Check:**
- File exists at target path
- Case sensitivity (guide.md vs Guide.md)
- Correct relative path (../ vs ./)
- Anchor exists in target file

**Report:**
```markdown
❌ Broken Link Found
File: techdocs/guides/borrow.md:45
Link: [CDP Guide](../guides/cdp.md)
Problem: File exists as mint-cdp.md not cdp.md
Fix: Change link to [CDP Guide](../guides/mint-cdp.md)
```

### Issue: "Page in nav but missing source"

**Report:**
```markdown
❌ Navigation Error
mkdocs.yml line 42 references: guides/staking.md
Problem: File does not exist in techdocs/guides/
Impact: 404 error on published site
Fix: Either create the file or remove from navigation
```

## Output Priority

1. **Critical** - 404s, broken site navigation, major content missing
2. **High** - Broken internal links, outdated content, orphaned pages
3. **Medium** - Minor formatting issues, optional improvements
4. **Low** - Style suggestions, nice-to-haves

## Automated Checks (Quick Mode)

For fast validation:

```bash
# Check all nav files exist
grep -o "techdocs/.*\.md" mkdocs.yml | while read f; do
  [ -f "$f" ] || echo "Missing: $f"
done

# Find orphaned files (not in mkdocs.yml)
find techdocs -name "*.md" | while read f; do
  grep -q "$f" mkdocs.yml || echo "Orphaned: $f"
done

# Check for broken internal links
grep -r "\[.*\](.*\.md" techdocs/ --include="*.md" |
  # Parse and validate each link
```

## When to Run This Skill

- **After editing source files** - Before committing
- **Before deployment** - Catch issues pre-publish
- **Periodic checks** - Weekly/monthly sync verification
- **After major updates** - Navigation changes, restructuring
- **When users report 404s** - Investigate broken links

---

**Note:** This skill checks sync status and reports issues. It does NOT automatically fix problems or trigger deployments. Use `/improve-docs` to fix documentation content issues.
