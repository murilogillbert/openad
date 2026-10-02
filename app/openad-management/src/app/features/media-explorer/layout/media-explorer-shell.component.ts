import { BreakpointObserver } from '@angular/cdk/layout';
import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import type { MediaFolderNode } from '@openad/api-contracts';
import { ButtonModule } from 'primeng/button';
import { BreadcrumbModule } from 'primeng/breadcrumb';
import { DrawerModule } from 'primeng/drawer';
import {
  ConfirmationService,
  MessageService,
  type MenuItem,
  type TreeNode,
} from 'primeng/api';
import { ContextMenu, ContextMenuModule } from 'primeng/contextmenu';
import { MediaVfsApiService } from '../services/media-vfs-api.service';
import { MediaTreeSidebarComponent } from '../components/media-tree-sidebar.component';
import { MediaExplorerToolbarComponent } from '../components/media-explorer-toolbar.component';
import { MediaExplorerFoldersComponent } from '../components/media-explorer-folders.component';
import { MediaAssetGridComponent } from '../components/media-asset-grid.component';
import {
  MediaAssetListComponent,
  type MediaExplorerListRow,
} from '../components/media-asset-list.component';
import { MediaInspectorPanelComponent } from '../components/media-inspector-panel.component';
import { MediaMobileFabComponent } from '../components/media-mobile-fab.component';
import { MediaCreateFolderDialogComponent } from '../components/media-create-folder-dialog.component';
import type { FolderPickOption } from '../components/media-folder-picker-dialog.component';
import { MediaFolderPickerDialogComponent } from '../components/media-folder-picker-dialog.component';
import { MediaStringPromptDialogComponent } from '../components/media-string-prompt-dialog.component';
import { MediaExplorerRootDropComponent } from '../components/media-explorer-root-drop.component';
import { MediaUploadDialogComponent } from '../components/media-upload-dialog.component';

@Component({
  selector: 'app-media-explorer-shell',
  standalone: true,
  imports: [
    CommonModule,
    DrawerModule,
    BreadcrumbModule,
    ButtonModule,
    MediaTreeSidebarComponent,
    MediaExplorerToolbarComponent,
    MediaExplorerFoldersComponent,
    MediaAssetGridComponent,
    MediaAssetListComponent,
    MediaInspectorPanelComponent,
    MediaMobileFabComponent,
    MediaCreateFolderDialogComponent,
    MediaUploadDialogComponent,
    MediaExplorerRootDropComponent,
    ContextMenuModule,
    MediaStringPromptDialogComponent,
    MediaFolderPickerDialogComponent,
  ],
  host: {
    class: 'flex min-h-0 min-w-0 grow flex-1 flex-col overflow-hidden',
  },
  template: `
    <div
      class="flex w-full min-h-0 min-w-0 grow flex-1 flex-col overflow-hidden md:flex-row"
    >
      <!-- Desktop left rail -->
      <aside
        class="hidden min-h-0 shrink-0 flex-col border-r border-surface-200 bg-surface-0 py-4 pl-3 pr-2 dark:border-surface-700 dark:bg-surface-900 md:flex md:w-64"
      >
        <div class="mb-6 flex shrink-0 items-center gap-3 px-1">
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-[color:var(--p-primary-contrast-color)]"
          >
            <i class="pi pi-images text-lg"></i>
          </div>
          <div class="min-w-0">
            <h2 class="font-headline truncate text-lg font-bold leading-tight text-color">
              Media library
            </h2>
            <p
              class="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-color"
            >
              Digital curator
            </p>
          </div>
        </div>
        <div class="mb-6 flex flex-col gap-2">
          <p-button
            label="Upload media"
            icon="pi pi-upload"
            styleClass="w-full font-semibold shadow-md"
            (onClick)="openUploadFromToolbar()"
          />
          <p-button
            label="New folder"
            icon="pi pi-folder-plus"
            [outlined]="true"
            styleClass="w-full font-semibold"
            (onClick)="openCreateFolderFromToolbar()"
          />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
          <p
            class="mb-2 px-2 text-[11px] font-bold uppercase tracking-wider text-muted-color"
          >
            Folders
          </p>
          <app-media-tree-sidebar
            [nodes]="treeNodes()"
            [selectedKey]="selectedFolderId()"
            (folderSelect)="selectFolder($event)"
          />
        </div>
      </aside>

      <!-- Main explorer -->
      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-50 dark:bg-surface-950/40"
      >
        @if (mobile()) {
          <div
            class="flex items-baseline justify-between gap-3 border-b border-surface-200 px-1 pb-3 pt-1 dark:border-surface-700 md:hidden"
          >
            <h2 class="font-headline text-2xl font-extrabold tracking-tight text-color">
              Media library
            </h2>
            <span class="text-sm font-medium tabular-nums text-muted-color">
              {{ mobileExplorerCount() }}
              {{ mobileExplorerCount() === 1 ? 'item' : 'items' }}
            </span>
          </div>
        }

        <app-media-explorer-root-drop
          [folderId]="selectedFolderId()"
          (uploadFinished)="reloadExplorer()"
        >
          <ng-template #mediaExplorerDropBody>
          <div
            class="shrink-0 border-b border-surface-200 bg-surface-100/80 px-3 py-3 dark:border-surface-800 dark:bg-surface-900/50 md:px-6 md:py-4"
          >
            @if (mobile()) {
              <div class="mb-3 flex min-w-0 items-center gap-2">
                <p-button
                  icon="pi pi-bars"
                  [rounded]="true"
                  [text]="true"
                  (onClick)="treeDrawer.set(true)"
                  aria-label="Open folder tree"
                />
                @if (!searchMode() && breadcrumbItems().length > 0) {
                  <p-breadcrumb
                    [model]="breadcrumbItems()"
                    styleClass="!min-w-0 !flex-1 !border-none !bg-transparent !p-0 [&_.p-breadcrumb-list]:min-w-0 [&_.p-breadcrumb-list]:flex-wrap"
                  />
                }
              </div>
            }
            <app-media-explorer-toolbar
              [showBreadcrumb]="!mobile() && !searchMode()"
              [searchMode]="searchMode()"
              [scopeLabel]="scopeFolderLabel()"
              [crumbs]="breadcrumbItems()"
              [view]="view()"
              [searchText]="search()"
              (searchChange)="onSearch($event)"
              (viewChange)="view.set($event)"
            />
          </div>

          <div
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain py-3 md:py-6"
            (contextmenu)="onExplorerBackgroundMenu($event)"
          >
            @if (loading()) {
              <p class="px-4 text-sm text-muted-color md:px-6">Loading…</p>
            } @else if (explorerShowsEmpty()) {
              @if (searchMode()) {
                <div
                  class="flex flex-col items-center justify-center px-4 py-12 text-center text-muted-color md:px-6 md:py-20"
                >
                  <i class="pi pi-search mb-4 text-5xl opacity-40"></i>
                  <p class="text-lg font-semibold text-color">No matches</p>
                  <p class="mt-2 max-w-sm text-sm">
                    Nothing in
                    <span class="font-medium text-color">{{ scopeFolderLabel() }}</span>
                    matched “<span class="font-mono text-color">{{ search().trim() }}</span
                    >”. Try a different term.
                  </p>
                </div>
              } @else {
                <div
                  class="flex flex-col items-center justify-center px-4 py-12 text-center text-muted-color md:px-6 md:py-20"
                >
                  <i class="pi pi-inbox mb-4 text-5xl opacity-40"></i>
                  <p class="text-lg font-semibold text-color">This folder is empty</p>
                  <p class="mt-2 max-w-sm text-sm">
                    Upload files or open another folder. Folders and files appear here for navigation.
                  </p>
                </div>
              }
            } @else if (searchMode()) {
              @if (view() === 'grid') {
                <div class="w-full min-w-0 space-y-8 px-4 md:px-6">
                  @if (searchFolders().length > 0) {
                    <app-media-explorer-folders
                      [folders]="searchFolders()"
                      [parentUpId]="null"
                      [highlightQuery]="search()"
                      [showPaths]="true"
                      (open)="selectFolder($event)"
                      (contextFolder)="onFolderTileContext($event)"
                    />
                  }
                  @if (searchFiles().length > 0) {
                    <div>
                      <h3 class="mb-3 text-xs font-bold uppercase tracking-wider text-muted-color">
                        Files
                      </h3>
                      <app-media-asset-grid
                        [assets]="searchFiles()"
                        [highlightQuery]="search()"
                        [showPaths]="true"
                        (selectAsset)="onSelectAsset($event)"
                        (contextAsset)="onGridFileContext($event)"
                      />
                    </div>
                  }
                </div>
              } @else {
                <div class="w-full min-w-0 px-0 md:px-0">
                  <app-media-asset-list
                    [rows]="explorerSearchListRows()"
                    [highlightQuery]="search()"
                    [showLocationColumn]="true"
                    (navigateFolder)="selectFolder($event)"
                    (selectAsset)="onSelectAsset($event)"
                    (contextParentUp)="onListParentContext($event)"
                    (contextFolderRow)="onListFolderContext($event)"
                    (contextFileRow)="onListFileContext($event)"
                  />
                </div>
              }
            } @else if (view() === 'grid') {
              <div class="w-full min-w-0 px-4 md:px-6">
                <app-media-explorer-folders
                  [folders]="childFolders()"
                  [parentUpId]="parentNavigateTargetId()"
                  (open)="selectFolder($event)"
                  (contextFolder)="onFolderTileContext($event)"
                  (contextParentUp)="onParentUpTileContext($event)"
                />
                @if (assets().length > 0) {
                  <h3 class="mb-3 text-xs font-bold uppercase tracking-wider text-muted-color">
                    Files
                  </h3>
                }
                <app-media-asset-grid
                  [assets]="assets()"
                  (selectAsset)="onSelectAsset($event)"
                  (contextAsset)="onGridFileContext($event)"
                />
              </div>
            } @else {
              <div class="w-full min-w-0 px-0 md:px-0">
                <app-media-asset-list
                  [rows]="explorerListRows()"
                  [highlightQuery]="''"
                  [showLocationColumn]="false"
                  (navigateFolder)="selectFolder($event)"
                  (selectAsset)="onSelectAsset($event)"
                  (contextParentUp)="onListParentContext($event)"
                  (contextFolderRow)="onListFolderContext($event)"
                  (contextFileRow)="onListFileContext($event)"
                />
              </div>
            }
          </div>
          </ng-template>
        </app-media-explorer-root-drop>
      </div>
    </div>

    <p-contextmenu
      #explorerCtx
      [model]="ctxMenuItems"
      [appendTo]="'body'"
      [pressDelay]="500"
      (onHide)="onExplorerCtxHide()"
    />

    <app-media-string-prompt-dialog
      [visible]="renamePrompt() !== null"
      [header]="renamePrompt()?.target === 'folder' ? 'Rename folder' : 'Rename file'"
      [label]="renamePrompt()?.target === 'folder' ? 'Folder name' : 'Filename'"
      [initialValue]="renamePrompt()?.initial ?? ''"
      (visibleChange)="onRenamePromptVisible($event)"
      (confirm)="onRenameConfirm($event)"
    />

    <app-media-folder-picker-dialog
      [visible]="movePick() !== null"
      [header]="movePick()?.kind === 'folder' ? 'Move folder' : 'Move file'"
      [description]="
        movePick()?.kind === 'folder'
          ? 'Choose the new parent folder.'
          : 'Choose the folder for this file.'
      "
      [options]="folderMoveOptions()"
      (visibleChange)="onMovePickVisible($event)"
      (pickFolder)="onMovePickConfirm($event)"
    />

    <app-media-upload-dialog
      [visible]="uploadDialog()"
      (visibleChange)="uploadDialog.set($event)"
      [folderId]="selectedFolderId()"
      (vfsUploadFinished)="reloadExplorer()"
    />

    <app-media-create-folder-dialog
      [visible]="createFolderDialog()"
      (visibleChange)="onCreateFolderVisible($event)"
      [parentFolderId]="createFolderResolvedParent()!"
      (folderCreated)="onFolderCreated($event)"
    />

    @if (mobile()) {
      <p-drawer
        header="Folders"
        [visible]="treeDrawer()"
        (visibleChange)="treeDrawer.set($event)"
        position="full"
        [appendTo]="'body'"
        [modal]="true"
        [closable]="true"
        [style]="{ width: '100%', height: '100%', maxHeight: '100dvh' }"
      >
        <app-media-tree-sidebar
          [nodes]="treeNodes()"
          [selectedKey]="selectedFolderId()"
          (folderSelect)="onMobileTreeFolderSelect($event)"
        />
      </p-drawer>
      <app-media-mobile-fab
        (openUpload)="openUploadFromToolbar()"
        (openCreateFolder)="openCreateFolderFromToolbar()"
      />
    }

    @if (selectedFolderId() && selectedDetail()) {
      <p-drawer
        header="Details"
        [position]="mobile() ? 'bottom' : 'right'"
        [visible]="inspectorDrawer()"
        (visibleChange)="onInspectorVisible($event)"
        [appendTo]="'body'"
        [modal]="true"
        styleClass="app-media-inspector-drawer"
        [style]="inspectorDrawerStyle()"
      >
        <app-media-inspector-panel
          [detail]="selectedDetail()"
          [folderId]="selectedFolderId()!"
          (reload)="onInspectorReload()"
        />
      </p-drawer>
    }
  `,
})
export class MediaExplorerShellComponent implements OnInit, OnDestroy {
  private readonly api = inject(MediaVfsApiService);
  private readonly bp = inject(BreakpointObserver);
  private readonly confirmation = inject(ConfirmationService);
  private readonly messages = inject(MessageService);

  @ViewChild('explorerCtx') private explorerCtx?: ContextMenu;

  ctxMenuItems: MenuItem[] = [];
  readonly renamePrompt = signal<
    | { target: 'folder'; id: string; initial: string }
    | { target: 'file'; mediaId: string; initial: string }
    | null
  >(null);
  readonly movePick = signal<
    | { kind: 'folder'; folderId: string }
    | { kind: 'file'; mediaId: string; currentFolderId: string }
    | null
  >(null);
  readonly createFolderParentOverride = signal<string | null>(null);
  readonly createFolderResolvedParent = computed(() =>
    this.createFolderParentOverride() ?? this.selectedFolderId()
  );

  readonly mobile = toSignal(
    this.bp.observe('(max-width: 767.98px)').pipe(map((m) => m.matches)),
    { initialValue: false }
  );

  readonly treeNodes = signal<TreeNode[]>([]);
  readonly flatFolders = signal<MediaFolderNode[]>([]);
  readonly selectedFolderId = signal<string | null>(null);
  readonly assets = signal<unknown[]>([]);
  /** Recursive search (scope = selected folder). */
  readonly searchFolders = signal<MediaFolderNode[]>([]);
  readonly searchFiles = signal<unknown[]>([]);
  readonly loading = signal(false);
  readonly view = signal<'grid' | 'list'>('grid');
  readonly search = signal('');
  readonly treeDrawer = signal(false);
  readonly inspectorDrawer = signal(false);
  readonly selectedDetail = signal<Record<string, unknown> | null>(null);
  readonly uploadDialog = signal(false);
  readonly createFolderDialog = signal(false);

  private searchDebounceId: ReturnType<typeof setTimeout> | undefined;

  searchMode(): boolean {
    return this.search().trim().length > 0;
  }

  scopeFolderLabel(): string {
    const id = this.selectedFolderId();
    const f = id ? this.flatFolders().find((x) => x.id === id) : undefined;
    return f?.name ?? '';
  }

  /** Folders + files + parent row when not at root (mobile header tally). */
  mobileExplorerCount(): number {
    if (this.searchMode()) {
      return this.searchFolders().length + this.searchFiles().length;
    }
    return (
      this.childFolders().length +
      this.assets().length +
      (this.parentNavigateTargetId() ? 1 : 0)
    );
  }

  explorerShowsEmpty(): boolean {
    if (this.loading()) {
      return false;
    }
    if (this.searchMode()) {
      return this.searchFolders().length === 0 && this.searchFiles().length === 0;
    }
    return this.folderAndAssetsEmpty();
  }

  childFolders(): MediaFolderNode[] {
    const pid = this.selectedFolderId();
    if (!pid) {
      return [];
    }
    return this.flatFolders()
      .filter((f) => f.parentId === pid)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
  }

  /**
   * Full “empty folder” messaging only at the catalog root. Nested folders always have a parent
   * to go back to (`..`), so leaf folders must not replace the explorer with this empty state.
   */
  folderAndAssetsEmpty(): boolean {
    return (
      !this.loading() &&
      this.childFolders().length === 0 &&
      this.assets().length === 0 &&
      this.parentNavigateTargetId() === null
    );
  }

  /** Target folder id for “..” in grid and list (null at catalog root). */
  parentNavigateTargetId(): string | null {
    const id = this.selectedFolderId();
    if (!id) {
      return null;
    }
    const cur = this.flatFolders().find((f) => f.id === id);
    return cur?.parentId ?? null;
  }

  /** Unified rows for list view: parent link, subfolders, then files. */
  explorerListRows(): MediaExplorerListRow[] {
    const rows: MediaExplorerListRow[] = [];
    const pid = this.parentNavigateTargetId();
    if (pid) {
      rows.push({ kind: 'parent', parentId: pid });
    }
    for (const f of this.childFolders()) {
      rows.push({ kind: 'folder', id: f.id, name: f.name });
    }
    for (const raw of this.assets()) {
      const x = raw as Record<string, unknown>;
      const mediaId = x['mediaId'];
      if (typeof mediaId !== 'string') {
        continue;
      }
      rows.push({
        kind: 'file',
        mediaId,
        filename: typeof x['filename'] === 'string' ? x['filename'] : '—',
        fileSize: typeof x['fileSize'] === 'number' ? x['fileSize'] : 0,
        codec: typeof x['codec'] === 'string' ? x['codec'] : undefined,
        mimeType: typeof x['mimeType'] === 'string' ? x['mimeType'] : undefined,
        placementFolderId:
          typeof x['folderId'] === 'string' ? x['folderId'] : undefined,
      });
    }
    return rows;
  }

  /** Search result rows (folders first, then files) with paths for the Location column. */
  explorerSearchListRows(): MediaExplorerListRow[] {
    const rows: MediaExplorerListRow[] = [];
    for (const f of this.searchFolders()) {
      rows.push({
        kind: 'folder',
        id: f.id,
        name: f.name,
        pathLabel: f.materializedPath,
      });
    }
    for (const raw of this.searchFiles()) {
      const x = raw as Record<string, unknown> & { searchLocationPath?: string };
      const mediaId = x['mediaId'];
      if (typeof mediaId !== 'string') {
        continue;
      }
      rows.push({
        kind: 'file',
        mediaId,
        filename: typeof x['filename'] === 'string' ? x['filename'] : '—',
        fileSize: typeof x['fileSize'] === 'number' ? x['fileSize'] : 0,
        codec: typeof x['codec'] === 'string' ? x['codec'] : undefined,
        mimeType: typeof x['mimeType'] === 'string' ? x['mimeType'] : undefined,
        pathLabel: x['searchLocationPath']?.trim() || undefined,
        placementFolderId:
          typeof x['folderId'] === 'string' ? x['folderId'] : undefined,
      });
    }
    return rows;
  }

  breadcrumbItems(): MenuItem[] {
    const row = this.flatFolders().find((f) => f.id === this.selectedFolderId());
    if (!row) {
      return [];
    }
    const parts = row.materializedPath.split('/').filter(Boolean);
    const items: MenuItem[] = [];
    for (let i = 0; i < parts.length; i++) {
      const targetPath = `/${parts.slice(0, i + 1).join('/')}`;
      const folder = this.flatFolders().find((f) => f.materializedPath === targetPath);
      const label = parts[i];
      if (!folder) {
        items.push({ label });
        continue;
      }
      const id = folder.id;
      items.push({
        label,
        command: () => {
          this.selectFolder(id);
        },
      });
    }
    return items;
  }

  async ngOnInit(): Promise<void> {
    await this.loadTree();
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchDebounceId);
  }

  private buildTree(flat: MediaFolderNode[]): TreeNode[] {
    const byId = new Map<string, TreeNode>();
    for (const f of flat) {
      byId.set(f.id, {
        key: f.id,
        label: f.name,
        data: f,
        children: [],
      });
    }
    const roots: TreeNode[] = [];
    for (const f of flat) {
      const node = byId.get(f.id);
      if (!node) {
        continue;
      }
      if (f.parentId === null) {
        roots.push(node);
      } else {
        const p = byId.get(f.parentId);
        if (p) {
          p.children = [...(p.children ?? []), node];
        }
      }
    }
    const sortRec = (nodes: TreeNode[]) => {
      nodes.sort((a, b) =>
        String(a.label).localeCompare(String(b.label), undefined, {
          sensitivity: 'base',
        })
      );
      for (const n of nodes) {
        if (n.children?.length) {
          sortRec(n.children);
        }
      }
    };
    sortRec(roots);
    return roots;
  }

  private async loadTree(): Promise<void> {
    this.loading.set(true);
    try {
      const flat = await this.api.listFolderTree();
      this.flatFolders.set(flat);
      this.treeNodes.set(this.buildTree(flat));
      const global = flat.find((f) =>
        f.materializedPath.endsWith('/Global_Ads')
      );
      const pick = global?.id ?? flat[0]?.id ?? null;
      this.selectedFolderId.set(pick);
      if (pick) {
        await this.loadExplorer();
      }
    } finally {
      this.loading.set(false);
    }
  }

  selectFolder(id: string): void {
    this.search.set('');
    this.selectedFolderId.set(id);
    this.selectedDetail.set(null);
    this.inspectorDrawer.set(false);
    void this.loadExplorer();
  }

  /**
   * Close the mobile folder drawer before loading folder contents so the leave animation / mask
   * teardown does not race with heavy tree + grid updates (stuck `.p-overlay-mask-leave-active`).
   */
  onMobileTreeFolderSelect(folderId: string): void {
    this.treeDrawer.set(false);
    queueMicrotask(() => this.selectFolder(folderId));
  }

  onSearch(q: string): void {
    this.search.set(q);
    clearTimeout(this.searchDebounceId);
    this.searchDebounceId = setTimeout(() => {
      this.searchDebounceId = undefined;
      void this.loadExplorer();
    }, 350);
  }

  async reloadExplorer(): Promise<void> {
    await this.loadExplorer();
  }

  async onFolderCreated(ev: { id: string }): Promise<void> {
    this.createFolderParentOverride.set(null);
    const flat = await this.api.listFolderTree();
    this.flatFolders.set(flat);
    this.treeNodes.set(this.buildTree(flat));
    this.selectFolder(ev.id);
  }

  onCreateFolderVisible(v: boolean): void {
    if (!v) {
      this.createFolderParentOverride.set(null);
    }
    this.createFolderDialog.set(v);
  }

  openUploadFromToolbar(): void {
    this.uploadDialog.set(true);
  }

  openCreateFolderFromToolbar(): void {
    this.createFolderParentOverride.set(null);
    this.createFolderDialog.set(true);
  }

  onExplorerBackgroundMenu(ev: Event): void {
    const t = ev.target as HTMLElement | null;
    if (t?.closest?.('[data-media-ctx-item]')) {
      return;
    }
    ev.preventDefault();
    this.showBlankExplorerMenu(ev);
  }

  onExplorerCtxHide(): void {
    this.ctxMenuItems = [];
  }

  onFolderTileContext(payload: {
    event: Event;
    folder: MediaFolderNode;
  }): void {
    this.showFolderContextMenu(payload.event, payload.folder);
  }

  onParentUpTileContext(payload: {
    event: Event;
    parentId: string;
  }): void {
    this.showParentUpContextMenu(payload.event, payload.parentId);
  }

  onListParentContext(payload: { event: Event; parentId: string }): void {
    this.showParentUpContextMenu(payload.event, payload.parentId);
  }

  onListFolderContext(payload: {
    event: Event;
    id: string;
    name: string;
  }): void {
    const folder = this.flatFolders().find((f) => f.id === payload.id);
    if (folder) {
      this.showFolderContextMenu(payload.event, folder);
    }
  }

  onListFileContext(payload: {
    event: Event;
    mediaId: string;
    filename: string;
    placementFolderId: string | null;
  }): void {
    const placement =
      payload.placementFolderId ?? this.selectedFolderId() ?? '';
    if (!placement) {
      return;
    }
    this.showFileContextMenu(payload.event, {
      mediaId: payload.mediaId,
      filename: payload.filename,
      placementFolderId: placement,
    });
  }

  onGridFileContext(payload: {
    event: Event;
    mediaId: string;
    filename: string;
    placementFolderId: string | null;
  }): void {
    const placement =
      payload.placementFolderId ?? this.selectedFolderId() ?? '';
    if (!placement) {
      return;
    }
    this.showFileContextMenu(payload.event, {
      mediaId: payload.mediaId,
      filename: payload.filename,
      placementFolderId: placement,
    });
  }

  onRenamePromptVisible(v: boolean): void {
    if (!v) {
      this.renamePrompt.set(null);
    }
  }

  async onRenameConfirm(name: string): Promise<void> {
    const r = this.renamePrompt();
    this.renamePrompt.set(null);
    if (!r) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    try {
      if (r.target === 'folder') {
        await this.api.patchFolder(r.id, { name: trimmed });
        this.messages.add({ severity: 'success', summary: 'Folder renamed' });
      } else {
        await this.api.patchAsset(r.mediaId, { filename: trimmed });
        this.messages.add({ severity: 'success', summary: 'File renamed' });
      }
      await this.refreshTreeAndExplorer();
    } catch (e) {
      this.messages.add({
        severity: 'error',
        summary: r.target === 'folder' ? 'Rename failed' : 'Rename failed',
        detail: e instanceof Error ? e.message : 'Error',
      });
    }
  }

  onMovePickVisible(v: boolean): void {
    if (!v) {
      this.movePick.set(null);
    }
  }

  folderMoveOptions(): FolderPickOption[] {
    const pick = this.movePick();
    if (!pick) {
      return [];
    }
    if (pick.kind === 'folder') {
      const ban = new Set<string>([
        pick.folderId,
        ...this.descendantFolderIds(pick.folderId),
      ]);
      return this.flatFolders()
        .filter((f) => !ban.has(f.id))
        .map((f) => ({ label: f.materializedPath, value: f.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    return this.flatFolders()
      .filter((f) => f.id !== pick.currentFolderId)
      .map((f) => ({ label: f.materializedPath, value: f.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async onMovePickConfirm(targetId: string): Promise<void> {
    const pick = this.movePick();
    this.movePick.set(null);
    if (!pick) {
      return;
    }
    try {
      if (pick.kind === 'folder') {
        await this.api.patchFolder(pick.folderId, { parentId: targetId });
        this.messages.add({ severity: 'success', summary: 'Folder moved' });
      } else {
        await this.api.patchAsset(pick.mediaId, { folderId: targetId });
        this.messages.add({ severity: 'success', summary: 'File moved' });
      }
      await this.refreshTreeAndExplorer();
    } catch (e) {
      this.messages.add({
        severity: 'error',
        summary: 'Move failed',
        detail: e instanceof Error ? e.message : 'Error',
      });
    }
  }

  private showBlankExplorerMenu(ev: Event): void {
    this.ctxMenuItems = [
      {
        label: 'New folder…',
        icon: 'pi pi-folder-plus',
        command: () => {
          this.createFolderParentOverride.set(null);
          this.createFolderDialog.set(true);
        },
      },
      {
        label: 'Upload media…',
        icon: 'pi pi-upload',
        command: () => this.uploadDialog.set(true),
      },
    ];
    this.explorerCtx?.show(ev);
  }

  private showParentUpContextMenu(ev: Event, parentId: string): void {
    this.ctxMenuItems = [
      {
        label: 'Go up',
        icon: 'pi pi-arrow-circle-up',
        command: () => this.selectFolder(parentId),
      },
    ];
    this.explorerCtx?.show(ev);
  }

  private showFolderContextMenu(ev: Event, folder: MediaFolderNode): void {
    const locked = folder.isSystemLocked;
    const items: MenuItem[] = [
      {
        label: 'Open',
        icon: 'pi pi-folder-open',
        command: () => this.selectFolder(folder.id),
      },
    ];
    if (!locked) {
      items.push(
        {
          label: 'New subfolder…',
          icon: 'pi pi-folder-plus',
          command: () => {
            this.createFolderParentOverride.set(folder.id);
            this.createFolderDialog.set(true);
          },
        },
        {
          label: 'Rename…',
          icon: 'pi pi-pencil',
          command: () =>
            this.renamePrompt.set({
              target: 'folder',
              id: folder.id,
              initial: folder.name,
            }),
        },
        {
          label: 'Move to…',
          icon: 'pi pi-arrow-right-arrow-left',
          command: () =>
            this.movePick.set({ kind: 'folder', folderId: folder.id }),
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'pi pi-trash',
          command: () => this.confirmDeleteFolder(folder),
        }
      );
    }
    this.ctxMenuItems = items;
    this.explorerCtx?.show(ev);
  }

  private showFileContextMenu(
    ev: Event,
    file: {
      mediaId: string;
      filename: string;
      placementFolderId: string;
    }
  ): void {
    this.ctxMenuItems = [
      {
        label: 'Open',
        icon: 'pi pi-eye',
        command: () => void this.onSelectAsset({ mediaId: file.mediaId }),
      },
      { separator: true },
      {
        label: 'Clone here',
        icon: 'pi pi-copy',
        command: () => void this.runCloneFile(file),
      },
      {
        label: 'Rename…',
        icon: 'pi pi-pencil',
        command: () =>
          this.renamePrompt.set({
            target: 'file',
            mediaId: file.mediaId,
            initial: file.filename,
          }),
      },
      {
        label: 'Move to…',
        icon: 'pi pi-arrow-right-arrow-left',
        command: () =>
          this.movePick.set({
            kind: 'file',
            mediaId: file.mediaId,
            currentFolderId: file.placementFolderId,
          }),
      },
      { separator: true },
      {
        label: 'Delete',
        icon: 'pi pi-trash',
        command: () => this.confirmDeleteFile(file),
      },
    ];
    this.explorerCtx?.show(ev);
  }

  private confirmDeleteFolder(folder: MediaFolderNode): void {
    this.confirmation.confirm({
      message: `Delete folder "${folder.name}"? It must have no subfolders or file placements.`,
      header: 'Delete folder',
      icon: 'pi pi-exclamation-triangle',
      accept: () => void this.runDeleteFolder(folder),
    });
  }

  private async runDeleteFolder(folder: MediaFolderNode): Promise<void> {
    try {
      await this.api.deleteFolder(folder.id);
      this.messages.add({ severity: 'success', summary: 'Folder deleted' });
      const flat = await this.api.listFolderTree();
      this.flatFolders.set(flat);
      this.treeNodes.set(this.buildTree(flat));
      if (this.selectedFolderId() === folder.id) {
        const parent = folder.parentId ?? this.defaultRootFolderId(flat);
        if (parent) {
          this.selectFolder(parent);
        }
      } else {
        await this.loadExplorer();
      }
    } catch (e) {
      this.messages.add({
        severity: 'error',
        summary: 'Delete failed',
        detail: e instanceof Error ? e.message : 'Error',
      });
    }
  }

  private defaultRootFolderId(flat: MediaFolderNode[]): string | null {
    const global = flat.find((f) => f.materializedPath.endsWith('/Global_Ads'));
    return global?.id ?? flat[0]?.id ?? null;
  }

  private confirmDeleteFile(file: {
    mediaId: string;
    filename: string;
    placementFolderId: string;
  }): void {
    this.confirmation.confirm({
      message:
        'Remove this placement from the folder? Storage is deleted only when no copies remain.',
      header: 'Delete media placement',
      icon: 'pi pi-exclamation-triangle',
      accept: () => void this.runDeleteFile(file),
    });
  }

  private async runDeleteFile(file: {
    mediaId: string;
    placementFolderId: string;
  }): Promise<void> {
    try {
      await this.api.deleteAsset(file.mediaId);
      this.messages.add({ severity: 'success', summary: 'Deleted' });
      await this.refreshTreeAndExplorer();
      const cur = this.selectedDetail()?.['mediaId'];
      if (cur === file.mediaId) {
        this.selectedDetail.set(null);
        this.inspectorDrawer.set(false);
      }
    } catch (e) {
      this.messages.add({
        severity: 'error',
        summary: 'Delete failed',
        detail: e instanceof Error ? e.message : 'Error',
      });
    }
  }

  private async runCloneFile(file: {
    mediaId: string;
    placementFolderId: string;
  }): Promise<void> {
    try {
      await this.api.cloneAsset(file.mediaId, {
        targetFolderId: file.placementFolderId,
      });
      this.messages.add({
        severity: 'success',
        summary: 'Cloned',
        detail: 'Placement duplicated in this folder',
      });
      await this.refreshTreeAndExplorer();
    } catch (e) {
      this.messages.add({
        severity: 'error',
        summary: 'Clone failed',
        detail: e instanceof Error ? e.message : 'Error',
      });
    }
  }

  private descendantFolderIds(rootId: string): string[] {
    const byParent = new Map<string, string[]>();
    for (const f of this.flatFolders()) {
      if (!f.parentId) {
        continue;
      }
      const arr = byParent.get(f.parentId) ?? [];
      arr.push(f.id);
      byParent.set(f.parentId, arr);
    }
    const out: string[] = [];
    const stack = [...(byParent.get(rootId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      out.push(id);
      for (const c of byParent.get(id) ?? []) {
        stack.push(c);
      }
    }
    return out;
  }

  private async refreshTreeAndExplorer(): Promise<void> {
    const flat = await this.api.listFolderTree();
    this.flatFolders.set(flat);
    this.treeNodes.set(this.buildTree(flat));
    await this.loadExplorer();
  }

  async onSelectAsset(ev: { mediaId: string }): Promise<void> {
    const d = await this.api.getAsset(ev.mediaId);
    this.selectedDetail.set(d);
    this.inspectorDrawer.set(true);
  }

  onInspectorVisible(v: boolean): void {
    this.inspectorDrawer.set(v);
    if (!v) {
      this.selectedDetail.set(null);
    }
  }

  protected inspectorDrawerStyle(): Record<string, string> {
    return this.mobile()
      ? { height: 'min(70vh, 32rem)' }
      : { width: 'min(100vw, 24rem)' };
  }

  async onInspectorReload(): Promise<void> {
    const id = this.selectedDetail()?.['mediaId'];
    await this.loadExplorer();
    if (typeof id === 'string') {
      try {
        const d = await this.api.getAsset(id);
        this.selectedDetail.set(d);
      } catch {
        this.selectedDetail.set(null);
        this.inspectorDrawer.set(false);
      }
    }
  }

  private async loadExplorer(): Promise<void> {
    const fid = this.selectedFolderId();
    if (!fid) {
      return;
    }
    const q = this.search().trim();
    this.loading.set(true);
    try {
      if (q) {
        const { folders, files } = await this.api.vfsSearch(fid, q);
        this.searchFolders.set(folders);
        this.searchFiles.set(this.attachSearchLocationPaths(files));
        this.assets.set([]);
      } else {
        this.searchFolders.set([]);
        this.searchFiles.set([]);
        const page = await this.api.listFolderAssets(fid, {
          page: 1,
          limit: 50,
        });
        this.assets.set(page.data);
      }
    } finally {
      this.loading.set(false);
    }
  }

  private attachSearchLocationPaths(files: unknown[]): unknown[] {
    return files.map((raw) => {
      const x = raw as Record<string, unknown>;
      const folderId = x['folderId'];
      const folder =
        typeof folderId === 'string'
          ? this.flatFolders().find((f) => f.id === folderId)
          : undefined;
      return {
        ...x,
        searchLocationPath: folder?.materializedPath ?? '',
      };
    });
  }
}
