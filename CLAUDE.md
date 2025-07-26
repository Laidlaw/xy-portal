# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development mode with live reloading
- `npm run build` - Build for production (includes TypeScript checking)
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Run ESLint with auto-fixing
- `npm run version` - Bump version and update manifest.json

## Plugin Architecture

This is an Obsidian plugin that creates Tufte-style sidenotes using a "portal" metaphor for seamless tangent capture.

### Core Concepts

**Portal System**: The plugin uses a typing trigger (`||`) that transforms into a portal emoji (`🚪`) during content capture. Users type their tangent thoughts after the portal trigger, then press Escape to "close" the portal, which converts the content into an Obsidian block reference and creates a corresponding sidenote.

**Block Reference Integration**: Leverages Obsidian's native block reference system (`^blockid`) for linking portal doors to sidenote content. All portal content is stored in a "## Portals" section at the bottom of the document.

### Key Components

- **PortalPlugin** (main.ts:37-619): Main plugin class handling editor interaction, portal lifecycle, and settings
- **SidenoteManager** (main.ts:621-756): Manages sidenote positioning, collision detection, and visual rendering  
- **PortalSettingTab** (main.ts:758-871): Configuration interface for portal triggers, styles, and behavior

### Portal Lifecycle

1. User types trigger sequence (`||`) → automatically detected via editor monitoring
2. Trigger converts to emoji, portal session begins with visual feedback
3. User types content in subdued styling mode
4. Escape key ends session: content → block reference, sidenote created
5. Sidenote positioned with collision detection and style variants

### Sidenote Positioning

- **Natural positioning**: Sidenotes appear adjacent to their portal door
- **Collision detection**: Automatic vertical spacing to prevent overlaps
- **Style variants**: Tufte (classic), Modern (gradient), Minimal (clean)
- **Responsive behavior**: Collapses to inline on narrow screens

### Editor Integration

The plugin integrates deeply with Obsidian's editor through:
- Active leaf change monitoring for editor setup
- Text change detection via polling (500ms intervals)
- Direct CodeMirror DOM manipulation for visual feedback
- Markdown post-processor for block reference rendering

### Settings System

All configuration stored in plugin settings:
- Portal trigger sequence (default: `||`)
- Portal emoji (default: `🚪`)
- Exit key (Escape/Enter/Tab)
- Sidenote style variants
- Collision detection and spacing

The plugin emphasizes seamless writing flow - users can capture tangents without interrupting their main narrative, with portal content automatically organizing into elegant sidenotes.

## Intended User Experience & Design Goals

### Core Writing Flow

When a user triggers a "portal door", they are jotting down a **digression** from their main thought. The ESC key signals they have finished the digression and are ready to continue their previous train of thought. This creates a seamless way to capture tangential ideas without losing the main narrative flow.

### Space Concepts

- **xspace**: The default/main document content space
- **yspace**: The portal content space (digressions, tangents, sidenotes)

The yspace content should ideally appear near the initial point of instantiation, using modern CSS for Tufte-style sidenotes with improved collision detection and responsive handling.

### Portal Door Behavior

Each "door" should serve as both:
1. **Visual marker**: Shows where a digression was captured
2. **Bidirectional link**: Links to the yspace entry at the bottom of the document
3. **Edit interface**: Clicking the door emoji should switch back to markdown mode and reveal the yspace content inline (as it was when initially typed) for editing

### Interaction Model

The portal system is conceptually similar to Obsidian's CalloutsAndCheckboxesHelpBox. Key interactions:
- **Portal creation**: Seamless trigger → capture → close cycle
- **Content viewing**: Yspace appears as elegant sidenotes near the door
- **Content editing**: Click door to reveal inline yspace for direct editing
- **Navigation**: Bidirectional linking between door and yspace entry

This design prioritizes maintaining writing flow while providing flexible access to captured tangential content.

## Development History

For a detailed chronicle of the plugin's development journey, including technical challenges, architecture decisions, and lessons learned, see [claude-log.md](./claude-log.md).