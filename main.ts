import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';

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
	originalFile?: string;
	originalPosition?: { line: number, ch: number };
}

// Sidenotes are now handled by native callouts

export default class PortalPlugin extends Plugin {
	private keySequence: string = '';
	private sequenceTimeout: NodeJS.Timeout | null = null;
	settings!: PortalSettings;
	activePortal: ActivePortal | null = null;
	styleSheet: HTMLStyleElement | null = null;

	async onload() {
		await this.loadSettings();
		
		this.injectStyles();
		
		// Simple portal trigger detection - no complex state management
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.setupEditorListener(leaf.view.editor);
				}
			})
		);
		
		// Handle escape key for portal creation
		this.registerDomEvent(document, 'keydown', this.handleKeyDown.bind(this));
		
		// Handle hover previews for portal doors
		this.registerDomEvent(document, 'mouseover', this.handlePortalHover.bind(this));
		this.registerDomEvent(document, 'mouseout', this.handlePortalHoverEnd.bind(this));
		
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
			id: 'open-sidecar',
			name: 'Open portal sidecar',
			editorCallback: () => {
				this.openSidecar();
			},
			hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'p' }]
		});
		
		this.addSettingTab(new PortalSettingTab(this.app, this));
	}

	injectStyles() {
		this.styleSheet = document.createElement('style');
		this.styleSheet.textContent = this.generateCSS();
		document.head.appendChild(this.styleSheet);
	}

	generateCSS(): string {
		
		return `
			/* Portal Plugin Styles */
			.portal-container {
				position: relative;
			}

			/* Style portal doors with IDs */
			span:has-text("🚪["), 
			.cm-line:contains("🚪[") {
				color: #8b5cf6;
				font-weight: bold;
				cursor: pointer;
				padding: 1px 3px;
				border-radius: 3px;
				transition: all 0.2s ease;
				position: relative;
			}

			span:has-text("🚪["):hover,
			.cm-line:contains("🚪["):hover {
				background: rgba(139, 92, 246, 0.15);
				transform: scale(1.05);
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

			/* Portal preview tooltip styles */
			.portal-preview-tooltip {
				background: var(--background-secondary) !important;
				border: 1px solid var(--background-modifier-border) !important;
				border-radius: 4px !important;
				padding: 8px 12px !important;
				font-size: 0.9em !important;
				max-width: 300px !important;
				box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
				z-index: 1000 !important;
				pointer-events: none !important;
				position: absolute !important;
			}

			/* Portal content in edit mode */
			.portal-content-active {
				background: rgba(139, 92, 246, 0.08);
				border-radius: 3px;
				padding: 2px 4px;
				font-style: italic;
				color: #7c3aed;
			}

			/* Tufte-style Sidenotes using Callouts */
			
			/* Create space for sidenotes by adjusting content width */
			.workspace-leaf-content[data-type="markdown"] .markdown-preview-view .markdown-preview-sizer,
			.workspace-leaf-content[data-type="markdown"] .markdown-source-view .cm-content {
				max-width: 60% !important;
				margin-left: 0 !important;
				margin-right: 40% !important;
			}

			/* Ensure containers can hold positioned elements */
			.workspace-leaf-content[data-type="markdown"] {
				position: relative !important;
				overflow: visible !important;
			}
			
			.workspace-leaf-content[data-type="markdown"] .markdown-preview-view,
			.workspace-leaf-content[data-type="markdown"] .markdown-source-view .cm-editor {
				position: relative !important;
				overflow: visible !important;
			}

			/* Style sidenote callouts as floating margin notes */
			.callout[data-callout="sidenote"] {
				position: absolute !important;
				left: calc(65% + 1rem) !important;
				width: 30% !important;
				max-width: 20rem !important;
				margin: 0 !important;
				z-index: 100 !important;
				
				/* Tufte styling based on user preference */
				background: rgba(139, 92, 246, 0.02) !important;
				border: none !important;
				border-left: 2px solid rgba(139, 92, 246, 0.3) !important;
				border-radius: 0 !important;
				padding: 0.75rem !important;
				font-size: 0.85rem !important;
				line-height: 1.4 !important;
				color: var(--text-muted) !important;
				box-shadow: none !important;
			}

			/* Enhanced positioning for dynamically positioned sidenotes */
			.callout[data-callout="sidenote"].positioned-sidenote {
				position: fixed !important;
				z-index: 1000 !important;
				background: rgba(139, 92, 246, 0.05) !important;
				border-left: 3px solid rgba(139, 92, 246, 0.5) !important;
				box-shadow: 0 2px 8px rgba(139, 92, 246, 0.1) !important;
			}

			/* Hide callout icons for sidenotes */
			.callout[data-callout="sidenote"] .callout-icon {
				display: none !important;
			}

			/* Style callout title as sidenote metadata */
			.callout[data-callout="sidenote"] .callout-title {
				font-size: 0.75rem !important;
				color: var(--text-faint) !important;
				font-weight: 500 !important;
				margin-bottom: 0.5rem !important;
				padding: 0 !important;
			}

			/* Style callout content */
			.callout[data-callout="sidenote"] .callout-content {
				padding: 0 !important;
				margin: 0 !important;
			}

			/* Connection line from door to sidenote */
			.callout[data-callout="sidenote"]::before {
				content: '';
				position: absolute;
				left: -1.5rem;
				top: 1rem;
				width: 1rem;
				height: 1px;
				background: rgba(139, 92, 246, 0.3);
				opacity: 0.6;
			}

			/* Hover effects */
			.callout[data-callout="sidenote"]:hover {
				background: rgba(139, 92, 246, 0.08) !important;
				border-left-color: var(--color-accent) !important;
				transform: translateX(-2px);
				box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15) !important;
			}

			/* Modern style variant */
			.callout[data-callout="sidenote"].modern-style {
				background: linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(139, 92, 246, 0.02)) !important;
				border: 1px solid rgba(139, 92, 246, 0.2) !important;
				border-left: 3px solid var(--color-accent) !important;
				border-radius: 6px !important;
				box-shadow: 0 4px 16px rgba(139, 92, 246, 0.12) !important;
			}

			/* Minimal style variant */
			.callout[data-callout="sidenote"].minimal-style {
				background: transparent !important;
				border-left: 1px solid rgba(139, 92, 246, 0.4) !important;
				box-shadow: none !important;
				font-size: 0.8rem !important;
				padding: 0.5rem !important;
			}

			/* Mobile responsive - stack sidenotes inline */
			@media (max-width: 1200px) {
				.callout[data-callout="sidenote"] {
					position: static !important;
					left: auto !important;
					width: 100% !important;
					margin: 1rem 0 !important;
					background: rgba(139, 92, 246, 0.05) !important;
					border-left-width: 4px !important;
				}
				
				.callout[data-callout="sidenote"]::before {
					display: none !important;
				}

				/* Restore full width on mobile */
				.workspace-leaf-content[data-type="markdown"] .markdown-preview-view .markdown-preview-sizer,
				.workspace-leaf-content[data-type="markdown"] .markdown-source-view .cm-content {
					max-width: 100% !important;
					margin-right: 0 !important;
				}
			}

			/* Active portal editing indication */
			.cm-line.portal-editing {
				background: rgba(139, 92, 246, 0.05);
			}
			
			/* Portal typing active styles */
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
		// Handle ESC key for automated return to original position
		if (evt.key === 'Escape' && this.activePortal && this.activePortal.isActive) {
			evt.preventDefault();
			this.returnToOriginalPosition();
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
				if (activeView) {
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

	async startPortalSession(editor: Editor, cursor: { line: number, ch: number }, triggerPos: number) {
		const portalId = this.generateId();
		
		// Store original cursor position for return navigation
		const originalPos = { line: cursor.line, ch: triggerPos };
		
		// Simple atomic operation: replace || with door
		const line = editor.getLine(cursor.line);
		const newLine = line.slice(0, triggerPos) + `${this.settings.portalEmoji}[${portalId}]` + line.slice(cursor.ch);
		editor.setLine(cursor.line, newLine);
		
		// Create entry in sidecar document
		await this.createSidecarEntry(portalId);
		
		// AUTOMATED FLOW: Open sidecar and move cursor
		await this.openSidecarAndFocusPortal(portalId, originalPos);
		
		new Notice(`🚪 Portal ${portalId} ready for content`, 2000);
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
			
			// Replace emoji + content with just the door emoji
			const startOfEmoji = { 
				line: portalPos.line, 
				ch: portalPos.ch 
			};
			
			// Keep just the door emoji with ID as a visual indicator
			editor.replaceRange(`${this.settings.portalEmoji}[${blockId}]`, startOfEmoji, currentPos);
			
			// Clean up any commented content from previous edit session
			this.cleanupCommentedPortalContent(editor, blockId);
			
			// Add to portals section as a callout
			this.addToPortalsSectionAsCallout(editor, blockId, content.trim());
			
			new Notice(`💭 Portal ${portalId === blockId ? 'updated' : 'captured'} as ${blockId}`);
		} else {
			// Remove empty portal (emoji + ID)
			const line = editor.getLine(portalPos.line);
			const portalPattern = new RegExp(`${this.settings.portalEmoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[([^\\]]+)\\]`);
			const match = line.substring(portalPos.ch).match(portalPattern);
			const portalMarkerLength = match ? match[0].length : this.settings.portalEmoji.length;
			
			const startOfEmoji = { line: portalPos.line, ch: portalPos.ch };
			const endOfEmoji = { line: portalPos.line, ch: portalPos.ch + portalMarkerLength };
			editor.replaceRange('', startOfEmoji, endOfEmoji);
			new Notice('Empty portal removed');
		}

		// Cleanup
		this.removePortalEditingClass();
		this.activePortal = null;
	}

	extractPortalContent(editor: Editor, portalPos: { line: number, ch: number }, currentPos: { line: number, ch: number }): string {
		if (currentPos.line === portalPos.line) {
			// Single line - extract everything after the emoji[id]
			const line = editor.getLine(portalPos.line);
			// Find the end of the portal marker
			const portalPattern = new RegExp(`${this.settings.portalEmoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[([^\\]]+)\\]`);
			const match = line.substring(portalPos.ch).match(portalPattern);
			const portalMarkerLength = match ? match[0].length : this.settings.portalEmoji.length;
			return line.substring(portalPos.ch + portalMarkerLength, currentPos.ch);
		} else {
			// Multi-line
			let content = '';
			const firstLine = editor.getLine(portalPos.line);
			// Find the end of the portal marker
			const portalPattern = new RegExp(`${this.settings.portalEmoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[([^\\]]+)\\]`);
			const match = firstLine.substring(portalPos.ch).match(portalPattern);
			const portalMarkerLength = match ? match[0].length : this.settings.portalEmoji.length;
			content += firstLine.substring(portalPos.ch + portalMarkerLength) + '\n';
			
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

	addToPortalsSectionAsCallout(editor: Editor, blockId: string, content: string) {
		const fullContent = editor.getValue();
		const lines = fullContent.split('\n');
		
		// Check if this portal already exists (for updates)
		let existingCalloutStart = -1;
		let existingCalloutEnd = -1;
		
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(`> [!sidenote] Portal ${blockId}`)) {
				existingCalloutStart = i;
				// Find the end of the callout (next non-callout line)
				for (let j = i + 1; j < lines.length; j++) {
					if (!lines[j].startsWith('>') && lines[j].trim() !== '') {
						existingCalloutEnd = j - 1;
						break;
					}
				}
				// If we reach end of file, the callout extends to the end
				if (existingCalloutEnd === -1) {
					existingCalloutEnd = lines.length - 1;
				}
				break;
			}
		}
		
		const timestamp = new Date().toLocaleTimeString();
		// Create callout format for sidenote
		const calloutLines = [
			`> [!sidenote] Portal ${blockId} • ${timestamp}`,
			...content.split('\n').map(line => `> ${line}`)
		];
		
		if (existingCalloutStart !== -1 && existingCalloutEnd !== -1) {
			// Update existing portal callout
			lines.splice(existingCalloutStart, existingCalloutEnd - existingCalloutStart + 1, ...calloutLines);
		} else {
			// Add new portal callout
			// Find or create portals section
			let portalSectionIndex = -1;
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].trim() === '## Portals') {
					portalSectionIndex = i;
					break;
				}
			}
			
			if (portalSectionIndex !== -1) {
				lines.splice(portalSectionIndex + 1, 0, '', ...calloutLines, '');
			} else {
				lines.push('', '## Portals', '', ...calloutLines, '');
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

	async createSidecarEntry(portalId: string) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		// Generate sidecar filename
		const sidecarPath = activeFile.path.replace(/\.md$/, '.portals.md');
		
		// Check if sidecar exists, create if not
		let sidecarFile = this.app.vault.getAbstractFileByPath(sidecarPath);
		if (!sidecarFile) {
			sidecarFile = await this.app.vault.create(sidecarPath, '# Portal Notes\n\n');
		}

		if (sidecarFile) {
			try {
				// Add portal entry to sidecar
				const content = await this.app.vault.read(sidecarFile as any);
				const timestamp = new Date().toLocaleTimeString();
				const newEntry = `\n## Portal ${portalId} • ${timestamp}\n\n*Click here to add your thoughts...*\n\n`;
				
				await this.app.vault.modify(sidecarFile as any, content + newEntry);
			} catch (error) {
				console.error('Error updating sidecar:', error);
			}
		}
	}

	async openSidecar() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		const sidecarPath = activeFile.path.replace(/\.md$/, '.portals.md');
		const sidecarFile = this.app.vault.getAbstractFileByPath(sidecarPath);

		if (sidecarFile) {
			// Open sidecar in right pane
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.openFile(sidecarFile as any);
			}
		} else {
			new Notice('No portal sidecar exists for this document');
		}
	}

	async openSidecarAndFocusPortal(portalId: string, originalPos: { line: number, ch: number }) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		// Store current context for ESC return
		this.activePortal = {
			editor: this.app.workspace.getActiveViewOfType(MarkdownView)?.editor!,
			startPos: originalPos,
			portalPos: originalPos,
			portalId: portalId,
			isActive: true,
			originalFile: activeFile.path,
			originalPosition: originalPos
		};

		const sidecarPath = activeFile.path.replace(/\.md$/, '.portals.md');
		const sidecarFile = this.app.vault.getAbstractFileByPath(sidecarPath);

		if (sidecarFile) {
			// Open sidecar in right pane
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.openFile(sidecarFile as any);
				
				// Focus the sidecar and position cursor at the portal section
				await this.focusPortalInSidecar(leaf, portalId);
			}
		}
	}

	async focusPortalInSidecar(leaf: any, portalId: string) {
		// Give the leaf time to fully load
		await new Promise(resolve => setTimeout(resolve, 100));
		
		const view = leaf.view;
		if (view instanceof MarkdownView) {
			const editor = view.editor;
			const content = editor.getValue();
			
			// Find the portal section
			const portalHeader = `## Portal ${portalId}`;
			const headerIndex = content.indexOf(portalHeader);
			
			if (headerIndex !== -1) {
				// Position cursor at end of portal section for immediate typing
				const lines = content.split('\n');
				let targetLine = 0;
				
				for (let i = 0; i < lines.length; i++) {
					if (lines[i].includes(portalHeader)) {
						// Position cursor after the header, ready for content
						targetLine = i + 1;
						break;
					}
				}
				
				editor.setCursor({ line: targetLine, ch: 0 });
				editor.focus();
			}
		}
	}

	async returnToOriginalPosition() {
		if (!this.activePortal || !this.activePortal.originalFile || !this.activePortal.originalPosition) {
			return;
		}

		// Sync portal content to bottom of main document
		await this.syncPortalContentToMainDoc();

		// Find and focus the original file
		const originalFile = this.app.vault.getAbstractFileByPath(this.activePortal.originalFile);
		if (originalFile) {
			// Get the left leaf (main document area) 
			const leftLeaf = this.app.workspace.getLeftLeaf(false);
			if (leftLeaf) {
				await leftLeaf.openFile(originalFile as any);
				
				// Wait for the view to load
				await new Promise(resolve => setTimeout(resolve, 50));
				
				const view = leftLeaf.view;
				if (view instanceof MarkdownView) {
					// Position cursor after the portal door
					const portalDoorLength = `${this.settings.portalEmoji}[${this.activePortal.portalId}]`.length;
					const returnPos = {
						line: this.activePortal.originalPosition.line,
						ch: this.activePortal.originalPosition.ch + portalDoorLength
					};
					
					view.editor.setCursor(returnPos);
					view.editor.focus();
				}
			}
		}

		// Clear active portal state
		this.activePortal = null;
		new Notice('Returned to main document', 1500);
	}

	async syncPortalContentToMainDoc() {
		if (!this.activePortal) return;

		// Get current sidecar content
		const sidecarPath = this.activePortal.originalFile?.replace(/\.md$/, '.portals.md');
		if (!sidecarPath) return;

		const sidecarFile = this.app.vault.getAbstractFileByPath(sidecarPath);
		if (sidecarFile) {
			const sidecarContent = await this.app.vault.read(sidecarFile as any);
			
			// Extract content for this portal
			const portalHeader = `## Portal ${this.activePortal.portalId}`;
			const lines = sidecarContent.split('\n');
			
			let portalContent = '';
			let inPortalSection = false;
			
			for (const line of lines) {
				if (line === portalHeader) {
					inPortalSection = true;
					continue;
				}
				if (inPortalSection && line.startsWith('## Portal ')) {
					break; // Hit the next portal section
				}
				if (inPortalSection && line.trim()) {
					portalContent += line + '\n';
				}
			}

			// Add to main document bottom if there's content
			if (portalContent.trim()) {
				await this.addPortalToMainDoc(this.activePortal.portalId, portalContent.trim());
			}
		}
	}

	async addPortalToMainDoc(portalId: string, content: string) {
		if (!this.activePortal?.originalFile) return;

		const originalFile = this.app.vault.getAbstractFileByPath(this.activePortal.originalFile);
		if (originalFile) {
			const mainContent = await this.app.vault.read(originalFile as any);
			
			// Add portal content to "## Portals" section at bottom
			let updatedContent = mainContent;
			
			if (!mainContent.includes('## Portals')) {
				updatedContent += '\n\n## Portals\n';
			}
			
			const portalEntry = `\n### ${portalId}\n${content}\n`;
			updatedContent += portalEntry;
			
			await this.app.vault.modify(originalFile as any, updatedContent);
		}
	}

	async handlePortalHover(evt: MouseEvent) {
		const target = evt.target as HTMLElement;
		
		// Check if hovering over a portal door
		if (target.textContent?.includes(this.settings.portalEmoji)) {
			const portalMatch = target.textContent.match(/🚪\[([^\]]+)\]/);
			if (portalMatch) {
				const portalId = portalMatch[1];
				await this.showPortalPreview(target, portalId);
			}
		}
	}

	handlePortalHoverEnd() {
		// Remove any existing preview tooltips
		document.querySelectorAll('.portal-preview-tooltip').forEach(el => el.remove());
	}

	async showPortalPreview(element: HTMLElement, portalId: string) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		// Get portal content from sidecar
		const sidecarPath = activeFile.path.replace(/\.md$/, '.portals.md');
		const sidecarFile = this.app.vault.getAbstractFileByPath(sidecarPath);
		
		if (sidecarFile) {
			const sidecarContent = await this.app.vault.read(sidecarFile as any);
			
			// Extract content for this portal
			const portalHeader = `## Portal ${portalId}`;
			const lines = sidecarContent.split('\n');
			
			let portalContent = '';
			let inPortalSection = false;
			
			for (const line of lines) {
				if (line === portalHeader) {
					inPortalSection = true;
					continue;
				}
				if (inPortalSection && line.startsWith('## Portal ')) {
					break;
				}
				if (inPortalSection && line.trim()) {
					portalContent += line + '\n';
				}
			}

			if (portalContent.trim()) {
				this.createPreviewTooltip(element, portalContent.trim());
			}
		}
	}

	createPreviewTooltip(element: HTMLElement, content: string) {
		// Remove any existing tooltips
		document.querySelectorAll('.portal-preview-tooltip').forEach(el => el.remove());

		const tooltip = document.createElement('div');
		tooltip.className = 'portal-preview-tooltip';
		tooltip.textContent = content;
		
		// Style the tooltip
		Object.assign(tooltip.style, {
			position: 'absolute',
			background: 'var(--background-secondary)',
			border: '1px solid var(--background-modifier-border)',
			borderRadius: '4px',
			padding: '8px 12px',
			fontSize: '0.9em',
			maxWidth: '300px',
			boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
			zIndex: '1000',
			pointerEvents: 'none'
		});

		// Position tooltip near the element
		const rect = element.getBoundingClientRect();
		tooltip.style.left = rect.right + 10 + 'px';
		tooltip.style.top = rect.top + 'px';

		document.body.appendChild(tooltip);

		// Auto-remove after delay
		setTimeout(() => {
			tooltip.remove();
		}, 3000);
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

	handlePortalClick(evt: MouseEvent) {
		const target = evt.target as HTMLElement;
		
		// Check if clicked element contains portal emoji
		if (target.textContent?.includes(this.settings.portalEmoji)) {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return;
			
			evt.preventDefault();
			this.enterPortalEditMode(activeView.editor, target);
		}
	}

	async enterPortalEditMode(editor: Editor, portalElement: HTMLElement) {
		// Find the portal door in editor content
		const content = editor.getValue();
		const lines = content.split('\n');
		
		// Look for the emoji in the text to find its position
		for (let lineNum = 0; lineNum < lines.length; lineNum++) {
			const line = lines[lineNum];
			const emojiIndex = line.indexOf(this.settings.portalEmoji);
			
			if (emojiIndex !== -1) {
				// Try to extract portal ID or find associated yspace content
				const portalId = this.findPortalIdNearPosition(lines, lineNum, emojiIndex);
				if (portalId) {
					await this.openPortalForEditing(editor, lineNum, emojiIndex, portalId);
					return;
				}
			}
		}
	}

	findPortalIdNearPosition(lines: string[], lineNum: number, emojiIndex: number): string | null {
		// First, try to extract ID from the current line
		const currentLine = lines[lineNum];
		const portalPattern = new RegExp(`${this.settings.portalEmoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[([^\\]]+)\\]`);
		const match = currentLine.match(portalPattern);
		
		if (match) {
			return match[1]; // Return the portal ID from the emoji
		}
		
		// Fallback: look for any portal content in Portals section
		const portalSectionStart = lines.findIndex(line => line.trim() === '## Portals');
		if (portalSectionStart === -1) return null;
		
		// Find callouts in portal section and extract IDs
		for (let i = portalSectionStart; i < lines.length; i++) {
			const calloutMatch = lines[i].match(/> \[!sidenote\] Portal ([^\s•]+)/);
			if (calloutMatch) {
				return calloutMatch[1]; // Return the portal ID
			}
		}
		
		return null;
	}

	async openPortalForEditing(editor: Editor, lineNum: number, emojiIndex: number, portalId: string) {
		// Find the yspace content for this portal
		const yspaceContent = this.getYspaceContent(editor, portalId);
		if (!yspaceContent) {
			new Notice(`Portal ${portalId} content not found`);
			return;
		}
		
		// Replace door emoji with inline editable content
		const line = editor.getLine(lineNum);
		const beforeEmoji = line.substring(0, emojiIndex);
		// Find the end of the portal marker (emoji + ID)
		const portalPattern = new RegExp(`${this.settings.portalEmoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[([^\\]]+)\\]`);
		const match = line.substring(emojiIndex).match(portalPattern);
		const portalMarkerLength = match ? match[0].length : this.settings.portalEmoji.length;
		const afterEmoji = line.substring(emojiIndex + portalMarkerLength);
		
		// Create editable inline version
		const editableContent = `${beforeEmoji}|| ${yspaceContent} ||${afterEmoji}`;
		editor.setLine(lineNum, editableContent);
		
		// Position cursor inside the portal content
		const cursorPos = { line: lineNum, ch: emojiIndex + 3 };
		editor.setCursor(cursorPos);
		
		// Start portal session for editing
		this.activePortal = {
			editor,
			startPos: cursorPos,
			portalPos: { line: lineNum, ch: emojiIndex },
			portalId,
			isActive: true
		};
		
		// Apply visual feedback
		this.addPortalEditingClass(editor, lineNum);
		this.applyPortalTypingStyle(editor, cursorPos);
		
		new Notice(`🌀 Editing Portal ${portalId} (${this.settings.exitKey} to close)`);
	}

	getYspaceContent(editor: Editor, portalId: string): string | null {
		const content = editor.getValue();
		const lines = content.split('\n');
		
		// Find the specific portal callout
		let calloutStart = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(`> [!sidenote] Portal ${portalId}`)) {
				calloutStart = i + 1; // Start after the title line
				break;
			}
		}
		
		if (calloutStart === -1) return null;
		
		// Extract content until next non-callout line
		const contentLines: string[] = [];
		for (let i = calloutStart; i < lines.length; i++) {
			if (lines[i].startsWith('> ')) {
				contentLines.push(lines[i].substring(2)); // Remove "> " prefix
			} else if (lines[i].trim() === '') {
				continue; // Skip empty lines within callout
			} else {
				break; // End of callout
			}
		}
		
		return contentLines.join('\n').trim();
	}

	processSidenotes(el: HTMLElement, ctx: any) {
		// Find sidenote callouts and position them near their portal doors
		const sidenotes = el.querySelectorAll('.callout[data-callout="sidenote"]');
		
		Array.from(sidenotes).forEach((sidenote) => {
			const titleEl = sidenote.querySelector('.callout-title');
			if (!titleEl) return;
			
			// Extract portal ID from title
			const match = titleEl.textContent?.match(/Portal ([^\s•]+)/);
			if (!match) return;
			
			const portalId = match[1];
			this.positionSidenoteNearPortal(sidenote as HTMLElement, portalId, el);
		});
	}

	positionSidenoteNearPortal(sidenote: HTMLElement, portalId: string, container: HTMLElement) {
		// Find portal door emoji in the document
		const portalDoors = container.querySelectorAll('*');
		let portalElement: HTMLElement | null = null;
		
		for (const element of Array.from(portalDoors)) {
			if (element.textContent?.includes(this.settings.portalEmoji)) {
				portalElement = element as HTMLElement;
				break;
			}
		}
		
		if (!portalElement) return;
		
		// Calculate position relative to portal door
		const portalRect = portalElement.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		
		// Position sidenote adjacent to portal door
		const topOffset = portalRect.top - containerRect.top;
		sidenote.style.top = `${topOffset}px`;
		
		// Add visual connection
		sidenote.classList.add('positioned-sidenote');
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
		
		const debugInfo = containerEl.createEl('div', { cls: 'setting-item-description' });
		debugInfo.innerHTML = `
			<p><strong>Callout-based Sidenotes:</strong></p>
			<p>Sidenotes are now rendered using Obsidian's native callout system with <code>[!sidenote]</code> type.</p>
			<p>Positioning and styling are handled automatically through CSS.</p>
		`;
	}
}