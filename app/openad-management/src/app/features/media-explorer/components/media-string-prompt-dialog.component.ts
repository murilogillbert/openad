import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-media-string-prompt-dialog',
  standalone: true,
  imports: [DialogModule, FormsModule, InputTextModule, ButtonModule],
  template: `
    <p-dialog
      [header]="header"
      [modal]="true"
      [draggable]="false"
      [dismissableMask]="true"
      [appendTo]="'body'"
      [style]="{ width: 'min(96vw, 24rem)' }"
      [visible]="visible"
      (visibleChange)="onVisibleChange($event)"
    >
      <label class="mb-2 block text-sm font-medium text-color" [attr.for]="inputId">{{ label }}</label>
      <input
        [id]="inputId"
        pInputText
        type="text"
        class="w-full"
        [ngModel]="value()"
        (ngModelChange)="value.set($event)"
        (keydown.enter)="submit()"
        autocomplete="off"
      />
      <div class="mt-6 flex justify-end gap-2">
        <p-button label="Cancel" [text]="true" (onClick)="onVisibleChange(false)" />
        <p-button label="Save" icon="pi pi-check" (onClick)="submit()" />
      </div>
    </p-dialog>
  `,
})
export class MediaStringPromptDialogComponent implements OnChanges {
  @Input({ required: true }) visible = false;
  @Input() header = '';
  @Input() label = '';
  @Input() inputId = 'media-prompt-input';
  @Input() initialValue = '';
  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly confirm = new EventEmitter<string>();

  readonly value = signal('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue === true) {
      this.value.set(this.initialValue);
    }
    if (changes['initialValue'] && this.visible) {
      this.value.set(this.initialValue);
    }
  }

  onVisibleChange(v: boolean): void {
    if (v) {
      this.value.set(this.initialValue);
    }
    this.visibleChange.emit(v);
  }

  submit(): void {
    const s = this.value().trim();
    if (!s) {
      return;
    }
    this.confirm.emit(s);
    this.visibleChange.emit(false);
  }
}
