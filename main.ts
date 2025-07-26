import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting, MarkdownPostProcessor, Notice } from 'obsidian';

interface PortalSettings {
	portalTrigger: string;
	portalEmoji: string;
	exitKey: string;
	sidenoteStyle: 'tufte' | 'modern' | 'minimal';
	autoCollisionDetection: boolean;
	minSpacing: number;
}

const DEFAULT_SETTINGS: PortalSettings = {
	portalTrigger: '||',
	portalEmoji: '🚪',
	exitKey: 'Escape',
	sidenoteStyle: 'tufte',
	autoCollisionDetection: true,
	minSpacing: 20
}

interface ActivePortal {
	editor: Editor;
	startPos: { line: number, ch: number };
	portalPos: { line: number, ch: number };
	portalId: string;
	isActive: boolean;
}

interface SidenoteData {
	element: HTMLElement;
	naturalTop: number;
	adjustedTop: number;
	height: number;
	portalId: string;
}

export default class PortalPlugin extends Plugin {
	private keySequence: string = '';
	private sequenceTimeout: NodeJS.Timeout | null = null;
	settings!: PortalSettings;
	activePortal: ActivePortal | null = null;
	sidenoteManager!: SidenoteManager;
	styleSheet: HTMLStyleElement | null = null;

	async onload() {
		await this.loadSettings();
		
		this.sidenoteManager = new SidenoteManager(this);
		this.injectStyles();
		
		// Register markdown post processor for rendering portals
		this.registerMarkdownPostProcessor(this.processPortals.bind(this));
		
		// Handle typing in editor - use active-leaf-change to set up editor listeners
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.setupEditorListener(leaf.view.editor);
				}
			})
		);
		
		// Handle escape key and other shortcuts
		this.registerDomEvent(document, 'keydown', this.handleKeyDown.bind(this));
		
		// Commands
		this.addCommand({
			id: 'insert-portal',
			name: 'Insert portal door',
			editorCallback: (editor: Editor) => {
				this.insertPortal(editor);
			},
			hotkeys: [{ modifiers: ['Ctrl'], key: 'p' }]
		});

		this.addCommand({
			id: 'recalculate-sidenotes',
			name: 'Recalculate sidenote positions',
			callback: () => {
				this.sidenoteManager.recalculateAll();
			}
		});
		
		// Handle file changes to refresh sidenotes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.setupEditorListener(leaf.view.editor);
					setTimeout(() => this.sidenoteManager.recalculateAll(), 100);
				}
			})
		);
		
		this.addSettingTab(new PortalSettingTab(this.app, this));
	}

	injectStyles() {
		this.styleSheet = document.createElement('style');
		this.styleSheet.textContent = this.generateCSS();
		document.head.appendChild(this.styleSheet);
	}

	generateCSS(): string {
		const spacing = this.settings.minSpacing;
		
		return `
			/* Portal Plugin Styles */
			.portal-container {
				position: relative;
			}

			.portal-door {
				color: #8b5cf6;
				font-weight: bold;
				cursor: pointer;
				padding: 1px 3px;
				border-radius: 3px;
				transition: all 0.2s ease;
				position: relative;
			}

			.portal-door:hover {
				background: rgba(139, 92, 246, 0.15);
				transform: scale(1.05);
			}

			.portal-door.active {
				background: rgba(139, 92, 246, 0.2);
				box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.3);
			}

			/* Portal content in edit mode */
			.portal-content-active {
				background: rgba(139, 92, 246, 0.08);
				border-radius: 3px;
				padding: 2px 4px;
				font-style: italic;
				color: #7c3aed;
			}

			/* Sidenote base styles */
			.portal-sidenote {
				position: absolute;
				left: calc(100% + 2rem);
				width: 18rem;
				background: rgba(139, 92, 246, 0.03);
				border-left: 3px solid rgba(139, 92, 246, 0.4);
				border-radius: 6px;
				padding: 1rem;
				font-size: 0.9rem;
				line-height: 1.4;
				color: #4b5563;
				box-shadow: 0 2px 12px rgba(139, 92, 246, 0.08);
				z-index: 100;
				transition: all 0.3s ease;
				margin-top: -0.5rem;
			}

			/* Tufte style */
			.portal-sidenote.tufte-style {
				background: rgba(139, 92, 246, 0.02);
				border-left: 2px solid rgba(139, 92, 246, 0.3);
				font-size: 0.85rem;
				padding: 0.75rem;
			}

			/* Modern style */
			.portal-sidenote.modern-style {
				background: linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(139, 92, 246, 0.02));
				border: 1px solid rgba(139, 92, 246, 0.2);
				border-left: 3px solid #8b5cf6;
				box-shadow: 0 4px 16px rgba(139, 92, 246, 0.12);
			}

			/* Minimal style */
			.portal-sidenote.minimal-style {
				background: transparent;
				border-left: 1px solid rgba(139, 92, 246, 0.4);
				box-shadow: none;
				font-size: 0.8rem;
				padding: 0.5rem;
			}

			/* Connection line */
			.portal-sidenote::before {
				content: '';
				position: absolute;
				left: -1.5rem;
				top: 1rem;
				width: 1rem;
				height: 1px;
				background: rgba(139, 92, 246, 0.3);
				opacity: 0.6;
			}

			/* Sidenote metadata */
			.sidenote-meta {
				font-size: 0.75rem;
				color: #9ca3af;
				margin-bottom: 0.5rem;
				font-weight: 500;
			}

			.sidenote-content {
				margin: 0;
			}

			/* Hover effects */
			.portal-sidenote:hover {
				background: rgba(139, 92, 246, 0.08);
				border-left-color: #8b5cf6;
				transform: translateX(-2px);
				box-shadow: 0 6px 20px rgba(139, 92, 246, 0.15);
			}

			/* Collision adjustment indicator */
			.portal-sidenote.collision-adjusted {
				border-left-color: #f59e0b;
				background: rgba(245, 158, 11, 0.05);
			}

			/* Mobile responsive */
			@media (max-width: 1400px) {
				.portal-sidenote {
					position: static;
					width: 100%;
					margin: 1rem 0;
					right: auto;
					background: rgba(139, 92, 246, 0.05);
					border-left-width: 4px;
				}
				
				.portal-sidenote::before {
					display: none;
				}
			}

			/* Ensure markdown container can hold absolute positioned elements */
			.markdown-preview-view .markdown-preview-sizer,
			.markdown-source-view .cm-editor {
				position: relative;
				overflow: visible;
			}

			/* Create space for sidenotes by adjusting content width */
			.markdown-preview-view .markdown-preview-sizer,
			.markdown-source-view .cm-content {
				max-width: 65%;
				margin-left: 0;
				margin-right: auto;
			}

			/* Ensure the workspace leaf has enough space */
			.workspace-leaf-content[data-type="markdown"] {
				position: relative;
				overflow: visible;
			}

			/* Fix container positioning for sidenotes */
			.portal-container {
				position: relative;
				display: inline;
			}

			/* Active portal editing indication */
			.cm-line.portal-editing {
				background: rgba(139, 92, 246, 0.05);
			}
			/* autogen styles for active portal typing */
			/*
			.cm-line.portal-typing-active {
				background: rgba(139, 92, 246, 0.02);
				color: #7c3aed;
				font-style: italic;
			}
			*/
			.portal-typing-active .cm-line {
				color: #8b949e;
				font-style: italic;
				opacity: 0.8;
			}
		`;
	}

	setupEditorListener(editor: Editor) {
		// Set up change listener for this specific editor
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		// Use a simple interval to check for changes (more reliable than editor events)
		const checkForPortalTrigger = () => {
			if (!this.activePortal) {
				this.checkForPortalTrigger(editor, view);
			}
		};

		// Check every 500ms when editor is active
		const interval = setInterval(checkForPortalTrigger, 500);
		
		// Clean up interval when view changes
		this.register(() => clearInterval(interval));
	}

	checkForPortalTrigger(editor: Editor, view: MarkdownView) {
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		
		// Check if user just typed the portal trigger ||
		const triggerPos = currentLine.lastIndexOf(this.settings.portalTrigger, cursor.ch - 1);
		
		if (triggerPos !== -1 && triggerPos === cursor.ch - this.settings.portalTrigger.length) {
			// User just typed || - start portal session
			this.startPortalSession(editor, cursor, triggerPos);
		}
	}

	handleKeyDown(evt: KeyboardEvent) {
		// Handle escape key for closing portals
		if (evt.key === this.settings.exitKey && this.activePortal) {
			evt.preventDefault();
			this.endPortalSession();
			return;
		}

		// Track key sequence for portal trigger
		if (evt.key === '|') {
			// Clear any existing timeout
			if (this.sequenceTimeout) {
				clearTimeout(this.sequenceTimeout);
			}

			// Add to sequence
			this.keySequence += '|';

			// Check if we have the full trigger
			if (this.keySequence.endsWith(this.settings.portalTrigger)) {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && !this.activePortal) {
					// Small delay to ensure the characters are in the editor
					setTimeout(() => {
						this.checkAndStartPortal(activeView.editor);
					}, 10);
				}
			}

			// Reset sequence after a short delay to handle fast typing
			this.sequenceTimeout = setTimeout(() => {
				this.keySequence = '';
			}, 200);
		} else {
			// Reset sequence for non-pipe keys (except modifiers)
			if (!['Shift', 'Control', 'Alt', 'Meta'].includes(evt.key)) {
				this.keySequence = '';
				if (this.sequenceTimeout) {
					clearTimeout(this.sequenceTimeout);
					this.sequenceTimeout = null;
				}
			}
		}
	}

	checkAndStartPortal(editor: Editor) {
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		
		// Check if the trigger sequence is actually at the cursor position
		const triggerStart = cursor.ch - this.settings.portalTrigger.length;
		if (triggerStart >= 0) {
			const textBeforeCursor = currentLine.substring(triggerStart, cursor.ch);
			if (textBeforeCursor === this.settings.portalTrigger) {
				// Found the trigger - start portal session
				this.startPortalSession(editor, cursor, triggerStart);
			}
		}
	}

	startPortalSession(editor: Editor, cursor: { line: number, ch: number }, triggerPos: number) {
		const portalId = this.generateId();
		
		this.activePortal = {
			editor,
			startPos: cursor,
			portalPos: { line: cursor.line, ch: triggerPos },
			portalId,
			isActive: true
		};

		// Visual feedback - highlight the || trigger
		this.addPortalEditingClass(editor, cursor.line);
		
		// Replace || with visual indicator that portal is active
		const line = editor.getLine(cursor.line);
		const newLine = line.slice(0, triggerPos) + this.settings.portalEmoji + line.slice(cursor.ch);
		editor.setLine(cursor.line, newLine);
		
		// Move cursor to after the emoji
		const newCursorPos = { line: cursor.line, ch: triggerPos + this.settings.portalEmoji.length };
		editor.setCursor(newCursorPos);
		
		// Apply subdued styling to subsequent typing
		this.applyPortalTypingStyle(editor, newCursorPos);
	
		new Notice(`🌀 Portal ${portalId} opened (${this.settings.exitKey} to close)`, 3000);
	}

	applyPortalTypingStyle(editor: Editor, cursorPos: { line: number, ch: number }) {
		// Apply subdued styling to text after the portal emoji
		const editorEl = (editor as any).cm?.dom;
		if (editorEl) {
			// Add a class to the editor to enable portal typing styles
			editorEl.classList.add('portal-typing-active');
		}
	}

	async endPortalSession() {
		if (!this.activePortal) return;

		const { editor, portalPos, portalId } = this.activePortal;
		const currentPos = editor.getCursor();
		
		// Extract portal content (everything after the emoji)
		const content = this.extractPortalContent(editor, portalPos, currentPos);
		
		if (content.trim()) {
			let blockId = portalId;
			
			// If this is a new portal, generate a new block ID
			if (!portalId || portalId === 'new') {
				blockId = await this.generateObsidianBlockId();
			}
			
			// Replace emoji + content with door emoji + hidden block reference
			const startOfEmoji = { 
				line: portalPos.line, 
				ch: portalPos.ch 
			};
			
			// Keep the door emoji as a visual indicator with the block ID embedded
			editor.replaceRange(`${this.settings.portalEmoji}[^${blockId}]`, startOfEmoji, currentPos);
			
			// Clean up any commented content from previous edit session
			this.cleanupCommentedPortalContent(editor, blockId);
			
			// Add to portals section with proper block reference
			this.addToPortalsSection(editor, blockId, content.trim());
			
			new Notice(`💭 Portal ${portalId === blockId ? 'updated' : 'captured'} as ^${blockId}`);
		} else {
			// Remove empty portal (just the emoji)
			const startOfEmoji = { line: portalPos.line, ch: portalPos.ch };
			const endOfEmoji = { line: portalPos.line, ch: portalPos.ch + this.settings.portalEmoji.length };
			editor.replaceRange('', startOfEmoji, endOfEmoji);
			new Notice('Empty portal removed');
		}

		// Cleanup
		this.removePortalEditingClass();
		this.activePortal = null;
		
		// Refresh sidenotes after a brief delay
		setTimeout(() => this.sidenoteManager.recalculateAll(), 100);
	}

	extractPortalContent(editor: Editor, portalPos: { line: number, ch: number }, currentPos: { line: number, ch: number }): string {
		if (currentPos.line === portalPos.line) {
			// Single line - extract everything after the emoji
			const line = editor.getLine(portalPos.line);
			return line.substring(portalPos.ch + this.settings.portalEmoji.length, currentPos.ch);
		} else {
			// Multi-line
			let content = '';
			const firstLine = editor.getLine(portalPos.line);
			content += firstLine.substring(portalPos.ch + this.settings.portalEmoji.length) + '\n';
			
			for (let i = portalPos.line + 1; i < currentPos.line; i++) {
				content += editor.getLine(i) + '\n';
			}
			
			if (currentPos.line > portalPos.line) {
				content += editor.getLine(currentPos.line).substring(0, currentPos.ch);
			}
			
			return content;
		}
	}

	cleanupCommentedPortalContent(editor: Editor, blockId: string) {
		const fullContent = editor.getValue();
		const lines = fullContent.split('\n');
		
		// Remove any commented lines related to this portal
		const cleanedLines = lines.filter(line => {
			const isComment = line.trim().startsWith('<!--') && line.trim().endsWith('-->');
			if (isComment) {
				const uncommented = line.replace(/<!--\s*/, '').replace(/\s*-->/, '');
				// Check if this commented line is related to our portal
				return !uncommented.includes(`^${blockId}`) && !uncommented.includes(`Portal ${blockId}`);
			}
			return true;
		});
		
		if (cleanedLines.length !== lines.length) {
			editor.setValue(cleanedLines.join('\n'));
		}
	}

	addToPortalsSection(editor: Editor, blockId: string, content: string) {
		const fullContent = editor.getValue();
		const lines = fullContent.split('\n');
		
		// Check if this portal already exists (for updates)
		let existingPortalStart = -1;
		let existingPortalEnd = -1;
		
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(`**Portal ${blockId}**`)) {
				existingPortalStart = i;
				// Find the end (the block reference line)
				for (let j = i + 1; j < lines.length; j++) {
					if (lines[j].trim() === `^${blockId}`) {
						existingPortalEnd = j;
						break;
					}
				}
				break;
			}
		}
		
		const timestamp = new Date().toLocaleString();
		const portalEntry = `**Portal ${blockId}** - *${timestamp}*\n${content}\n^${blockId}`;
		
		if (existingPortalStart !== -1 && existingPortalEnd !== -1) {
			// Update existing portal
			lines.splice(existingPortalStart, existingPortalEnd - existingPortalStart + 1, portalEntry);
		} else {
			// Add new portal
			// Find or create portals section
			let portalSectionIndex = -1;
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].trim() === '## Portals') {
					portalSectionIndex = i;
					break;
				}
			}
			
			if (portalSectionIndex !== -1) {
				lines.splice(portalSectionIndex + 1, 0, '', portalEntry);
			} else {
				lines.push('', '## Portals', '', portalEntry);
			}
		}
		
		// Save cursor position before updating content
		const currentCursor = editor.getCursor();

		editor.setValue(lines.join('\n'));

		// Restore cursor position (account for added content)
		editor.setCursor(currentCursor);
	}

	insertPortal(editor: Editor) {
		const cursor = editor.getCursor();
		editor.replaceRange(this.settings.portalTrigger, cursor);
		editor.setCursor({ line: cursor.line, ch: cursor.ch + this.settings.portalTrigger.length });
	}

	addPortalEditingClass(editor: Editor, line: number) {
		// Add visual indication that this line is being edited in portal mode
		const editorEl = (editor as any).cm?.dom;
		if (editorEl) {
			const lineEl = editorEl.querySelector(`.cm-line:nth-child(${line + 1})`);
			if (lineEl) {
				lineEl.classList.add('portal-editing');
			}
		}
	}

	removePortalEditingClass() {
		document.querySelectorAll('.portal-editing').forEach(el => {
			el.classList.remove('portal-editing');
		});
		document.querySelectorAll('.portal-typing-active').forEach(el => {
			el.classList.remove('portal-typing-active');
		});
	}

	processPortals: MarkdownPostProcessor = (element, context) => {
		// Process portal door + block reference patterns
		
		console.log('🚪 processPortals called');
		console.log('Element:', element);
		console.log('Element HTML:', element.innerHTML);
		console.log('Context:', context);
		
		const walker = document.createTreeWalker(
			element,
			NodeFilter.SHOW_TEXT
		);

		const textNodes: Text[] = [];
		let node;
		while (node = walker.nextNode()) {
			textNodes.push(node as Text);
		}

		textNodes.forEach(textNode => {
			const content = textNode.textContent || '';
			
			// Look for portal door + block reference pattern
			const portalPattern = new RegExp(`(${this.settings.portalEmoji})\\[\\^([a-z0-9-]+)\\]`, 'g');
			let match;
			console.log(`Text node content: "${content}"`);
			
			while ((match = portalPattern.exec(content)) !== null) {
				const blockId = match[2];
				console.log('Found portal door with block reference:', blockId);
				
				// Create clickable portal door
				const portalDoor = document.createElement('span');
				portalDoor.className = 'portal-door';
				portalDoor.setAttribute('data-block-id', blockId);
				portalDoor.textContent = this.settings.portalEmoji;
				portalDoor.title = `Portal ${blockId} - Click to edit`;
				
				// Add click handler for bi-directional editing
				portalDoor.addEventListener('click', (e) => {
					e.preventDefault();
					this.editPortalContent(blockId);
				});
				
				const wrapper = document.createElement('span');
				wrapper.className = 'portal-container';
				wrapper.appendChild(portalDoor);
				
				// Replace the portal pattern with just the door
				const newContent = content.replace(portalPattern, '');
				if (textNode.parentNode) {
					if (newContent.trim()) {
						// Keep remaining text
						textNode.textContent = newContent;
						textNode.parentNode.insertBefore(wrapper, textNode.nextSibling);
					} else {
						// Replace entirely
						textNode.parentNode.replaceChild(wrapper, textNode);
					}
				}
				
				// Create sidenote for this portal
				console.log('Creating sidenote for block:', blockId);
				this.createSidenoteFromBlockId(wrapper, blockId);
				break; // Only process first match per text node
			}
		});

		// Initialize sidenote manager for this element
		setTimeout(() => this.sidenoteManager.processElement(element), 10);
	};

	editPortalContent(blockId: string) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		const editor = activeView.editor;
		const content = editor.getValue();
		const lines = content.split('\n');
		
		// Find the portal door in the main content and the yspace content
		let doorLine = -1;
		let doorStart = -1;
		let doorEnd = -1;
		let contentStart = -1;
		let contentEnd = -1;
		
		// Find door location
		for (let i = 0; i < lines.length; i++) {
			const doorPattern = new RegExp(`(${this.settings.portalEmoji})\\[\\^${blockId}\\]`);
			const match = lines[i].match(doorPattern);
			if (match) {
				doorLine = i;
				doorStart = lines[i].indexOf(match[0]);
				doorEnd = doorStart + match[0].length;
				break;
			}
		}
		
		// Find yspace content in Portals section
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === `^${blockId}`) {
				// Found the block reference, look backwards for content
				for (let j = i - 1; j >= 0; j--) {
					const line = lines[j].trim();
					if (line && !line.startsWith('**Portal')) {
						contentStart = j;
						contentEnd = i - 1;
						break;
					}
				}
				break;
			}
		}
		
		if (doorLine >= 0 && contentStart >= 0) {
			// Extract the yspace content
			let yspaceContent = '';
			for (let i = contentStart; i <= contentEnd; i++) {
				yspaceContent += lines[i] + (i < contentEnd ? '\n' : '');
			}
			
			// Replace door with expanded form for editing
			const doorLineContent = lines[doorLine];
			const newDoorLine = doorLineContent.substring(0, doorStart) + 
							   this.settings.portalEmoji + yspaceContent + 
							   doorLineContent.substring(doorEnd);
			
			lines[doorLine] = newDoorLine;
			
			// Remove from portals section temporarily
			// Mark the portal section for cleanup by commenting it out
			for (let i = contentStart; i <= contentEnd + 1; i++) {
				if (i < lines.length) {
					lines[i] = '<!-- ' + lines[i] + ' -->';
				}
			}
			
			editor.setValue(lines.join('\n'));
			
			// Position cursor at the end of the expanded content
			const newCursorPos = {
				line: doorLine,
				ch: doorStart + this.settings.portalEmoji.length + yspaceContent.length
			};
			editor.setCursor(newCursorPos);
			
			// Start a new portal session for editing
			this.activePortal = {
				editor,
				startPos: newCursorPos,
				portalPos: { line: doorLine, ch: doorStart },
				portalId: blockId,
				isActive: true
			};
			
			this.applyPortalTypingStyle(editor, newCursorPos);
			new Notice(`📝 Editing portal ${blockId} - press ${this.settings.exitKey} to save`);
		}
	}

	createSidenoteFromBlockId(container: HTMLElement, blockId: string) {
		// Find portal content using Obsidian's block reference system
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		const content = activeView.editor.getValue();
		// Look for the block with this ID in the Portals section
		const blockRefRegex = new RegExp(`\\*\\*\\[\\[#\\^${blockId}\\|[^\\]]+\\]\\][^\\n]*\\n([^\\n\\^]+(?:\\n(?!\\*\\*|\\^)[^\\n]+)*)\\s*\\^${blockId}`, 'g');
		const match = blockRefRegex.exec(content);

		if (match && match[1]) {
			this.sidenoteManager.createSidenote(container, blockId, match[1].trim());
		}
	}

	generateId(): string {
		// Use Obsidian's native block reference format
		// This creates IDs compatible with Obsidian's linking system
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).substring(2, 5);
		return `${timestamp}-${random}`;
	}

	async generateObsidianBlockId(): Promise<string> {
		// Alternative: Use Obsidian's internal block ID generator if available
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.editor) {
			// This mimics how Obsidian generates block IDs
			const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
			let result = '';
			for (let i = 0; i < 7; i++) {
				result += chars.charAt(Math.floor(Math.random() * chars.length));
			}
			return result;
		}
		return this.generateId();
	}

	onunload() {
		if (this.activePortal) {
			this.removePortalEditingClass();
		}
		
		if (this.sequenceTimeout) {
			clearTimeout(this.sequenceTimeout);
		}
		
		if (this.styleSheet) {
			this.styleSheet.remove();
		}
		
		this.sidenoteManager?.cleanup();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		// Refresh styles when settings change
		if (this.styleSheet) {
			this.styleSheet.textContent = this.generateCSS();
		}
		
		this.sidenoteManager?.recalculateAll();
	}
}

class SidenoteManager {
	private plugin: PortalPlugin;
	private sidenotes: Map<string, SidenoteData> = new Map();
	private observer: ResizeObserver;

	constructor(plugin: PortalPlugin) {
		this.plugin = plugin;
		this.observer = new ResizeObserver(() => {
			this.recalculateAll();
		});
		
		// Observe the main content area
		const contentEl = document.querySelector('.workspace-leaf-content');
		if (contentEl) {
			this.observer.observe(contentEl);
		}
	}

	createSidenote(container: HTMLElement, portalId: string, content: string) {
		const sidenote = document.createElement('div');
		sidenote.className = `portal-sidenote ${this.plugin.settings.sidenoteStyle}-style`;
		sidenote.setAttribute('data-portal-id', portalId);
		
		const timestamp = new Date().toLocaleTimeString();
		sidenote.innerHTML = `
			<div class="sidenote-meta">Portal ${portalId} • ${timestamp}</div>
			<div class="sidenote-content">${content}</div>
		`;
		
		// Calculate natural position based on portal door location
		const naturalTop = this.calculateNaturalTop(container);
		sidenote.style.top = naturalTop + 'px';
		
		// Add to the appropriate container
		const markdownContainer = container.closest('.markdown-preview-view, .markdown-source-view');
		const workspaceLeaf = container.closest('.workspace-leaf-content[data-type="markdown"]');
		const targetContainer = markdownContainer || workspaceLeaf || document.body;
		
		targetContainer.appendChild(sidenote);
		
		// Track sidenote
		this.sidenotes.set(portalId, {
			element: sidenote,
			naturalTop,
			adjustedTop: naturalTop,
			height: sidenote.offsetHeight,
			portalId
		});
		
		// Resolve collisions
		this.resolveCollisions();
		
		// Add interaction
		this.addSidenoteInteraction(sidenote, container);
	}

	calculateNaturalTop(portalElement: HTMLElement): number {
		const rect = portalElement.getBoundingClientRect();
		
		// Find the best reference container
		const markdownContainer = portalElement.closest('.markdown-preview-view, .markdown-source-view');
		const workspaceLeaf = portalElement.closest('.workspace-leaf-content[data-type="markdown"]');
		const referenceContainer = markdownContainer || workspaceLeaf;
		
		if (referenceContainer) {
			const containerRect = referenceContainer.getBoundingClientRect();
			const relativeTop = rect.top - containerRect.top;
			return Math.max(0, relativeTop - 8);
		}
		
		// Fallback to viewport position
		return Math.max(0, rect.top - 8);
	}

	resolveCollisions() {
		if (!this.plugin.settings.autoCollisionDetection) return;

		const notes = Array.from(this.sidenotes.values())
			.sort((a, b) => a.naturalTop - b.naturalTop);

		let lastBottom = 0;
		const minSpacing = this.plugin.settings.minSpacing;

		notes.forEach(note => {
			const newTop = Math.max(note.naturalTop, lastBottom + minSpacing);
			note.adjustedTop = newTop;
			note.element.style.top = newTop + 'px';
			
			// Visual indicator if position was adjusted
			if (Math.abs(newTop - note.naturalTop) > 5) {
				note.element.classList.add('collision-adjusted');
			} else {
				note.element.classList.remove('collision-adjusted');
			}
			
			lastBottom = newTop + note.height + 5; // Small buffer
		});
	}

	addSidenoteInteraction(sidenote: HTMLElement, portalDoor: HTMLElement) {
		// Highlight connection on hover
		const portalDoorEl = portalDoor.querySelector('.portal-door');
		
		if (portalDoorEl) {
			portalDoorEl.addEventListener('mouseenter', () => {
				sidenote.style.background = 'rgba(139, 92, 246, 0.1)';
				sidenote.style.borderLeftColor = '#8b5cf6';
			});
			
			portalDoorEl.addEventListener('mouseleave', () => {
				sidenote.style.background = '';
				sidenote.style.borderLeftColor = '';
			});
		}
		
		// Click to focus
		sidenote.addEventListener('click', () => {
			sidenote.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		});
	}

	processElement(element: HTMLElement) {
		// Update existing sidenotes in this element
		this.recalculateAll();
	}

	recalculateAll() {
		// Recalculate heights
		this.sidenotes.forEach(note => {
			note.height = note.element.offsetHeight;
		});
		
		// Resolve collisions
		this.resolveCollisions();
	}

	cleanup() {
		if (this.observer) {
			this.observer.disconnect();
		}
		this.sidenotes.forEach(note => {
			note.element.remove();
		});
		this.sidenotes.clear();
	}
}

class PortalSettingTab extends PluginSettingTab {
	plugin: PortalPlugin;

	constructor(app: App, plugin: PortalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: '🚪 Portal Plugin Settings' });

		new Setting(containerEl)
			.setName('Portal trigger')
			.setDesc('Text sequence that opens a portal (e.g., || or :: or >>)')
			.addText(text => text
				.setPlaceholder('||')
				.setValue(this.plugin.settings.portalTrigger)
				.onChange(async (value) => {
					this.plugin.settings.portalTrigger = value || '||';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Portal emoji')
			.setDesc('Visual indicator when portal is active')
			.addText(text => text
				.setPlaceholder('🚪')
				.setValue(this.plugin.settings.portalEmoji)
				.onChange(async (value) => {
					this.plugin.settings.portalEmoji = value || '🚪';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Exit key')
			.setDesc('Key to press to close portal and capture content')
			.addDropdown(dropdown => dropdown
				.addOption('Escape', 'Escape')
				.addOption('Enter', 'Enter')
				.addOption('Tab', 'Tab')
				.setValue(this.plugin.settings.exitKey)
				.onChange(async (value) => {
					this.plugin.settings.exitKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sidenote style')
			.setDesc('Visual style for rendered sidenotes')
			.addDropdown(dropdown => dropdown
				.addOption('tufte', 'Tufte (Classic)')
				.addOption('modern', 'Modern (Gradient)')
				.addOption('minimal', 'Minimal (Clean)')
				.setValue(this.plugin.settings.sidenoteStyle)
				.onChange(async (value) => {
					this.plugin.settings.sidenoteStyle = value as any;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto collision detection')
			.setDesc('Automatically prevent sidenotes from overlapping')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCollisionDetection)
				.onChange(async (value) => {
					this.plugin.settings.autoCollisionDetection = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Minimum spacing')
			.setDesc('Minimum pixels between sidenotes when collision detection is active')
			.addSlider(slider => slider
				.setLimits(10, 50, 5)
				.setValue(this.plugin.settings.minSpacing)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.minSpacing = value;
					await this.plugin.saveSettings();
				}));

		// Usage instructions
		containerEl.createEl('h3', { text: 'How to Use' });
		
		const instructions = containerEl.createEl('div', { cls: 'setting-item-description' });
		instructions.innerHTML = `
			<p><strong>Opening a Portal:</strong></p>
			<ul>
				<li>Type <code>${this.plugin.settings.portalTrigger}</code> anywhere in your text</li>
				<li>The trigger becomes <code>${this.plugin.settings.portalEmoji}</code> and portal mode activates</li>
				<li>Continue writing your tangent thoughts</li>
				<li>Press <code>${this.plugin.settings.exitKey}</code> to close the portal</li>
			</ul>
			<p><strong>Result:</strong> Your main text stays clean, tangents appear as elegant sidenotes!</p>
			<p><strong>Tip:</strong> Use <code>Ctrl+P</code> to quickly insert the portal trigger.</p>
		`;

		// Debug controls
		containerEl.createEl('h3', { text: 'Debug & Maintenance' });
		
		new Setting(containerEl)
			.setName('Recalculate positions')
			.setDesc('Manually trigger sidenote position recalculation')
			.addButton(button => button
				.setButtonText('Recalculate')
				.onClick(() => {
					this.plugin.sidenoteManager.recalculateAll();
					new Notice('Sidenote positions recalculated');
				}));
	}
}