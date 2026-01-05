# MkDocs Material Formatting Guide

Quick reference for enhanced formatting features now available in the docs.

---

## Admonitions (Colored Boxes)

### Available Types

```markdown
!!! note "Optional Title"
    Content here

!!! tip "Helpful Tip"
    Content here

!!! info "Information"
    Content here

!!! success "Success Message"
    Content here

!!! question "Question"
    Content here

!!! warning "Warning"
    Content here

!!! failure "Error"
    Content here

!!! danger "Danger"
    Content here

!!! example "Example"
    Content here
```

### Collapsible Admonitions

```markdown
??? note "Click to expand"
    This starts collapsed

???+ note "Click to collapse"
    This starts expanded
```

---

## Tabs

### Code Examples in Multiple Languages

```markdown
=== "JavaScript"
    ```javascript
    const result = await contract.borrow();
    ```

=== "Python"
    ```python
    result = contract.borrow()
    ```

=== "Go"
    ```go
    result := contract.Borrow()
    ```
```

### Content Tabs

```markdown
=== "Users"
    Instructions for end users

=== "Developers"
    Instructions for developers
```

---

## Material Icons

### Using Icons

```markdown
:material-check: Success
:material-alert: Warning
:material-information: Info
:material-code-braces: Code
:material-rocket-launch: Launch
```

Browse all icons: https://materialdesignicons.com/

---

## Buttons

```markdown
[Click Here](#){ .md-button }

[Primary Button](#){ .md-button .md-button--primary }
```

---

## Content Alignment

```markdown
Left aligned text

Text aligned center
{ .text-center }

Right aligned text
{ .text-right }
```

---

## Lists with Icons

```markdown
- :material-check: Feature enabled
- :material-close: Feature disabled
- :material-alert: Experimental
```

---

## Keyboard Keys

```markdown
++ctrl+alt+delete++
++cmd+c++
++enter++
```

---

## Task Lists

```markdown
- [x] Completed task
- [ ] Pending task
- [ ] Another task
```

---

## Tables with Sorting

```markdown
| Name | Price { data-sort-method='number' } | Status |
|------|-------|--------|
| Item A | 100 | Active |
| Item B | 50 | Pending |
```

---

## Definition Lists

```markdown
Term
:   Definition of the term

Another Term
:   Definition here
```

---

## Footnotes

```markdown
Some text with a footnote[^1]

[^1]: The footnote content
```

---

## Custom Containers

```markdown
!!! quote "Quote from someone"
    > This is a blockquote inside an admonition
```

---

## Grid Layout (Advanced)

Requires custom CSS, but possible with `md_in_html`:

```markdown
<div class="grid" markdown>

<div markdown>
## Column 1
Content here
</div>

<div markdown>
## Column 2
Content here
</div>

</div>
```

---

## Best Practices

### For Guides

- Use `!!! tip` for getting started sections
- Use `!!! example` for code examples
- Use `!!! warning` for important caveats
- Use tabs for multi-language code

### For API Docs

- Use tabs for request/response examples
- Use `!!! info` for parameter descriptions
- Use definition lists for API fields

### For Home Page

- Use `!!! success` for user CTAs
- Use `!!! info` for developer CTAs
- Use admonitions to create visual hierarchy

---

## Examples in Our Docs

### Home Page
Uses multiple admonition types for visual appeal

### Developer Guides
Could use tabs for JavaScript vs Python examples

### API Reference
Could use definition lists for parameters

---

## To Enable More Features

Add to `mkdocs.yml`:

```yaml
markdown_extensions:
  - pymdownx.keys  # For keyboard shortcuts
  - pymdownx.tasklist:  # For task lists
      custom_checkbox: true
  - def_list  # For definition lists
  - footnotes  # For footnotes
```

---

**All features above are now available in the docs!**

