# STRATO Platform - Claude Skills

This directory contains [Claude Code skills](https://code.claude.com/docs/en/skills) for improving and maintaining the STRATO platform documentation.

## What are Claude Skills?

Claude skills are reusable AI agents that can be invoked with slash commands (e.g., `/improve-docs`). They provide specialized capabilities for common tasks and can be shared across projects.

**All skills follow the meta-cognitive reasoning framework** defined in [REASONING.md](REASONING.md), which emphasizes:
- Skeptical verification of claims
- Explicit confidence scoring (0.0-1.0)
- Precision over politeness
- Evidence-based analysis
- Transparent reasoning with self-checks

## Available Skills

### 📝 `/improve-docs` - Documentation Improvement

**Purpose:** Analyze and improve documentation for clarity, accuracy, completeness, and consistency.

**When to use:**
- Before committing documentation changes
- When onboarding new users reports confusion
- During documentation reviews
- To ensure consistency across guides

**Examples:**
```bash
# Review a single user guide
/improve-docs techdocs/guides/borrow.md

# Review all user scenarios
/improve-docs techdocs/scenarios/

# Review technical API specification
/improve-docs techdocs/technical/api-specs/lending-spec.md

# Review all architecture docs
/improve-docs techdocs/technical/architecture/
```

**What it checks:**
- ✅ Clarity and readability for target audience
- ✅ Technical accuracy (formulas, endpoints, configs)
- ✅ Completeness (examples, prerequisites, error handling)
- ✅ Consistency (terminology, style, structure)
- ✅ Link validity (internal references)
- ✅ MkDocs-specific features (admonitions, diagrams)
- ✅ Safety warnings for DeFi operations

**Output:** Detailed review with prioritized improvements and specific suggestions.

---

### 🔄 `/check-doc-sync` - Documentation Sync Verification

**Purpose:** Verify that published documentation at docs.strato.nexus matches source files in `/techdocs`.

**When to use:**
- Before deploying documentation updates
- After restructuring navigation
- When users report 404 errors
- Periodic sync checks (weekly/monthly)
- After major content updates

**Examples:**
```bash
# Check entire site sync status
/check-doc-sync

# Check specific page
/check-doc-sync techdocs/guides/borrow.md

# Check only navigation structure
/check-doc-sync --nav-only
```

**What it checks:**
- ✅ Published content matches source files
- ✅ Navigation in mkdocs.yml is correct
- ✅ No broken internal links
- ✅ No orphaned pages (not in navigation)
- ✅ No missing pages (in nav but not in source)
- ✅ MkDocs build validity
- ✅ Last deployment date

**Output:** Comprehensive sync report with critical issues, warnings, and recommendations.

---

## Documentation Structure

All documentation is in **`/techdocs`** and published to https://docs.strato.nexus (MkDocs with Material theme).

Documentation is organized by audience and depth:

### `/techdocs/guides` & `/techdocs/scenarios` - User Documentation
- **Audience:** End users performing DeFi operations
- **Content:** Step-by-step guides, end-to-end scenarios
- **Style:** Conversational, beginner-friendly, with real examples

### `/techdocs/build-apps` & `/techdocs/reference` - Developer Documentation
- **Audience:** External developers building apps on STRATO
- **Content:** API references, integration guides, quick starts
- **Style:** Technical but accessible, code-focused

### `/techdocs/technical` - Technical Documentation
- **Audience:** Core platform developers, contributors
- **Content:** Design specs, detailed architecture, smart contract formulas, test plans
- **Style:** Implementation-focused, formula-heavy, precise

### `/techdocs/contribute` - Contributor Documentation
- **Audience:** Platform contributors
- **Content:** Setup guides, architecture overview, contribution guidelines

**Important:** Skills understand these distinctions and apply appropriate standards to each section.

---

## Skill Development Guide

### Creating a New Skill

1. **Create a `.SKILL.md` file** in this directory:
   ```bash
   touch .claude/my-skill.SKILL.md
   ```

2. **Add YAML frontmatter:**
   ```yaml
   ---
   name: my-skill
   description: Brief description for when Claude should auto-invoke
   allowed-tools:
     - Read
     - Edit
     - Bash(git:*)
   ---
   ```

3. **Write markdown instructions:**
   - Explain the skill's purpose
   - Define what it does when invoked
   - Provide examples
   - Specify output format
   - Include guidelines and edge cases

4. **Test the skill:**
   ```bash
   /my-skill [args]
   ```

### Skill File Naming Convention

- **Format:** `skill-name.SKILL.md`
- **Lowercase with hyphens:** `improve-docs.SKILL.md` ✅
- **Not:** `ImproveSkill.md` ❌
- **Not:** `improve_docs.skill.md` ❌

### Best Practices

1. **Clear scope:** Each skill should do one thing well
2. **Tool permissions:** Only request tools actually needed
3. **Examples:** Include 3-5 usage examples
4. **Output format:** Specify expected output structure
5. **Edge cases:** Document what NOT to do
6. **Context awareness:** Use repository-specific knowledge

### Skill Invocation

Skills are invoked in two ways:

**1. Manual (slash commands):**
```bash
/improve-docs techdocs/guides/borrow.md
/check-doc-sync
```

**2. Automatic (Claude decides):**
Claude may automatically invoke skills when their `description` matches the user's intent. For example:

> "Check if the published docs are up to date"

Claude would automatically invoke `/check-doc-sync`.

---

## Workflow Examples

### Example 1: Pre-Commit Documentation Review

Before committing changes to documentation:

```bash
# 1. Review the changes
/improve-docs techdocs/guides/liquidity.md

# 2. Apply suggested improvements
# (Claude will ask which to apply)

# 3. Verify sync status
/check-doc-sync techdocs/guides/liquidity.md

# 4. Commit changes
git add techdocs/guides/liquidity.md
git commit -m "docs: improve liquidity guide clarity"
```

### Example 2: New User Guide Creation

When creating a new user guide:

```bash
# 1. Create the guide
# (write initial content)

# 2. Get improvement suggestions
/improve-docs techdocs/guides/new-feature.md

# 3. Apply improvements
# (Claude will edit the file)

# 4. Verify navigation
/check-doc-sync --nav-only

# 5. Add to mkdocs.yml if needed
```

### Example 3: Quarterly Documentation Audit

Periodic full documentation review:

```bash
# 1. Check overall sync status
/check-doc-sync

# 2. Review all user guides
/improve-docs techdocs/guides/

# 3. Review all scenarios
/improve-docs techdocs/scenarios/

# 4. Review API documentation
/improve-docs techdocs/reference/

# 5. Generate report of findings
# (aggregate all issues)
```

---

## Configuration

### Permissions

The `.claude/settings.local.json` file configures allowed tools and domains:

```json
{
  "permissions": {
    "allow": [
      "Bash(wc:*)",
      "WebFetch(domain:docs.strato.nexus)"
    ]
  }
}
```

To add more permissions for skills:

```json
{
  "permissions": {
    "allow": [
      "Bash(wc:*)",
      "Bash(diff:*)",
      "Bash(git:*)",
      "WebFetch(domain:docs.strato.nexus)",
      "WebFetch(domain:github.com)"
    ]
  }
}
```

---

## Future Skills Ideas

Potential skills to add:

- **`/generate-api-docs`** - Auto-generate API documentation from Swagger spec
- **`/validate-examples`** - Test all code examples in documentation
- **`/check-screenshots`** - Verify screenshots match current UI
- **`/translate-docs`** - Translate documentation to other languages
- **`/docs-metrics`** - Analyze documentation coverage and quality metrics
- **`/sync-from-code`** - Update docs based on code changes (contract ABIs, etc.)

---

## Resources

- **Claude Code Skills Documentation:** https://code.claude.com/docs/en/skills
- **Agent Skills Repository:** https://github.com/anthropics/skills
- **MkDocs Material Documentation:** https://squidfunk.github.io/mkdocs-material/
- **STRATO Public Docs:** https://docs.strato.nexus

---

## Contributing

To improve existing skills or add new ones:

1. Edit the `.SKILL.md` file in this directory
2. Test thoroughly with various inputs
3. Update this README if adding new skills
4. Commit with descriptive message: `feat(skills): add X capability to Y skill`

---

## Support

For issues or questions about these skills:
- GitHub: https://github.com/blockapps/strato-platform/issues
- Documentation: https://docs.strato.nexus
