# Design Documents

Technical design specifications for major STRATO platform features.

## Available Documents

### [Rewards System](rewards.md)
**Technical Implementation Guide**

Complete implementation guide for the global rewards system that distributes CATA tokens based on protocol participation.

**Key Topics:**
- Activity types (Position vs OneTime)
- Data structures and state management
- O(1) gas-efficient algorithms
- Cumulative index patterns
- Integration points for protocol contracts

**Audience:** Smart contract developers, protocol contributors

---

### [Rewards Chef](rewards-chef.md)
**Alternative Rewards Implementation**

Detailed specification for an alternative rewards distribution mechanism.

**Audience:** Smart contract developers, protocol architects

---

## Purpose of Design Docs

These documents provide:
- ✅ **Implementation-level details** - Data structures, algorithms, formulas
- ✅ **Code references** - Links to specific files and line numbers
- ✅ **Integration guides** - How to integrate with existing systems
- ✅ **Technical decisions** - Why things were implemented this way
- ✅ **Edge cases** - Handling of unusual scenarios

## How to Use

1. **Read before implementing** - Understand the design before writing code
2. **Reference during development** - Use as specification during implementation
3. **Update when changing** - Keep design docs in sync with code changes
4. **Review during audits** - Use as reference during security reviews

## Related Documentation

- [Smart Contracts Architecture](../architecture/contracts.md) - Contract structure and organization
- [API Specifications](../api-specs/) - Detailed API specs with formulas
