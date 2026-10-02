import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { TreeModule } from 'primeng/tree';
import type { TreeNode } from 'primeng/api';

@Component({
  selector: 'app-media-tree-sidebar',
  standalone: true,
  imports: [TreeModule],
  template: `
    <p-tree
      [value]="nodes"
      selectionMode="single"
      [(selection)]="selection"
      (onNodeSelect)="onSelect($event)"
      styleClass="w-full border-none p-0"
    />
  `,
})
export class MediaTreeSidebarComponent implements OnChanges {
  @Input() nodes: TreeNode[] = [];
  @Input() set selectedKey(k: string | null) {
    this._selectedKey = k;
    this.applySelection();
  }
  @Output() folderSelect = new EventEmitter<string>();

  selection: TreeNode | TreeNode[] | null = null;
  private _selectedKey: string | null = null;

  ngOnChanges(_changes: SimpleChanges): void {
    void _changes;
    this.applySelection();
  }

  private applySelection(): void {
    if (!this._selectedKey || this.nodes.length === 0) {
      this.selection = null;
      return;
    }
    const hit = this.findNode(this.nodes, this._selectedKey);
    this.selection = hit;
  }

  private findNode(list: TreeNode[], key: string): TreeNode | null {
    for (const n of list) {
      if (n.key === key) {
        return n;
      }
      if (n.children?.length) {
        const d = this.findNode(n.children, key);
        if (d) {
          return d;
        }
      }
    }
    return null;
  }

  onSelect(ev: { node: TreeNode }): void {
    const key = ev.node?.key;
    if (typeof key === 'string') {
      this.folderSelect.emit(key);
    }
  }
}
