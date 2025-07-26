# Sidecar Architecture Design

This branch explores a document-based approach to portal management, addressing the state safety issues of the inline editing approach.

## Core Concept

Instead of inline editing within the main document, portals link to a dedicated sidecar document that provides the y-space editing environment.

```
main-note.md                    main-note.portals.md
├─ Main narrative (x-space)     ├─ ## Portal abc123
├─ Portal doors: 🚪[abc123]     │   Tangent content here
├─ Flow-focused writing         ├─ ## Portal def456  
└─ No dangerous edit states     │   Another digression
                                └─ Scroll-synced to main
```

## Architecture Benefits

### 1. State Safety
- No dangerous cursor tracking in main document
- Portal creation is atomic: trigger → door + sidecar entry
- No session conflicts or content swallowing

### 2. True Margin Notes
- Dedicated document provides authentic sidenote experience
- Scroll synchronization maintains spatial relationship
- Visual separation between x-space and y-space

### 3. Obsidian Integration
- Leverages native multi-pane workspace management
- Uses standard document linking and navigation
- Follows Obsidian's plugin architecture patterns

### 4. Scalable Performance
- No complex DOM manipulation or positioning calculations
- Each document manages its own portal space
- Clean separation of concerns

## Implementation Plan

### Phase 1: Basic Sidecar Management
- Auto-create `{note}.portals.md` when first portal is created
- Open sidecar in right pane when portals exist
- Basic portal door → sidecar section linking

### Phase 2: Scroll Synchronization
- Track scroll events in main document
- Mirror scroll position in sidecar document
- Maintain visual alignment between related content

### Phase 3: Navigation Commands
- Keyboard shortcuts to jump between main ↔ sidecar
- Quick portal creation and editing workflows
- Integration with Obsidian's command palette

### Phase 4: Advanced Features
- Portal-to-portal linking within sidecar
- Export/import of portal collections
- Visualization of portal networks

## Key Differences from Inline Approach

| Aspect | Inline Approach | Sidecar Approach |
|--------|----------------|------------------|
| Edit Location | In-place in main doc | Separate sidecar doc |
| State Management | Complex active portal tracking | Document-based isolation |
| Visual Positioning | CSS absolute positioning | Native pane management |
| Content Safety | Dangerous cursor behavior | Safe document operations |
| Obsidian Integration | Fights against grain | Works with grain |

## Target User Experience

1. **Portal Creation**: User types `||` → instant door creation + sidecar entry
2. **Sidecar Display**: Right pane automatically shows portal document
3. **Navigation**: Click door or use hotkey to jump to sidecar for editing
4. **Scroll Sync**: Sidecar scrolls to relevant section as user moves through main doc
5. **Flow Preservation**: Main document stays clean and focused

This approach embraces the **dual-document nature** of the portal metaphor while providing the seamless writing experience through smart workspace management.