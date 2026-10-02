import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';

export type FolderPickOption = { label: string; value: string };

@Component({
  selector: 'app-media-folder-picker-dialog',
  standalone: true,
  imports: [DialogModule, FormsModule, SelectModule, ButtonModule],
  template: `
    <p-dialog
      [header]="header"
      [modal]="true"
      [draggable]="false"
      [dismissableMask]="true"
      [appendTo]="'body'"
      [style]="{ width: 'min(96vw, 28rem)' }"
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
    >
      <p class="mb-2 text-sm text-muted-color">{{ description }}</p>
      <p-select
        [options]="options"
        [(ngModel)]="selectedId"
        optionLabel="label"
        optionValue="value"
        placeholder="Choose folder"
        [filter]="true"
        filterPlaceholder="Filter"
        class="w-full"
        styleClass="w-full"
      />
      <div class="mt-6 flex justify-end gap-2">
        <p-button label="Cancel" [text]="true" (onClick)="visibleChange.emit(false)" />
        <p-button label="Move" icon="pi pi-check" [disabled]="!selectedId" (onClick)="pick()" />
      </div>
    </p-dialog>
  `,
})
export class MediaFolderPickerDialogComponent implements OnChanges {
  @Input({ required: true }) visible = false;
  @Input() header = 'Move to folder';
  @Input() description = 'Select the destination folder.';
  @Input() options: FolderPickOption[] = [];
  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly pickFolder = new EventEmitter<string>();

  selectedId: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue === true && this.options.length > 0) {
      this.selectedId = this.options[0]?.value ?? null;
    }
  }

  pick(): void {
    const id = this.selectedId;
    if (!id) {
      return;
    }
    this.pickFolder.emit(id);
    this.visibleChange.emit(false);
  }
}
