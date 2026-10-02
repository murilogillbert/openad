import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

@Component({
  imports: [RouterModule, ToastModule, ConfirmDialogModule],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    class: 'flex min-h-dvh w-full flex-col',
  },
})
export class App {
  protected title = 'openad-management';
}
