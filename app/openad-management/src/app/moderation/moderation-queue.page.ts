import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { CentsPipe } from '../shared/cents.pipe';
import {
  ModerationApiService,
  type ItemDaFila,
} from './moderation-api.service';

/**
 * Fila de moderacao de criativo.
 *
 * O que a tela precisa entregar, e o motivo de cada parte:
 *
 * - **O criativo visivel.** Uma fila que lista nomes de campanha nao permite moderar nada; a
 *   decisao e sobre o conteudo.
 * - **O repasse ao motorista.** Faz parte do que esta sendo aprovado, e e dinheiro.
 * - **`readyToActivate` antes do clique.** A API recusa aprovar campanha sem conteudo
 *   entregavel; sem o aviso na tela, o moderador descobre pelo erro.
 * - **Motivo obrigatorio na recusa**, com confirmacao em dialogo. A recusa vai para o
 *   anunciante e e o unico caminho dele para saber o que corrigir.
 */
@Component({
  selector: 'app-moderation-queue-page',
  standalone: true,
  imports: [
    CardModule,
    ButtonModule,
    TagModule,
    DialogModule,
    TextareaModule,
    ProgressSpinnerModule,
    FormsModule,
    DatePipe,
    CentsPipe,
  ],
  templateUrl: './moderation-queue.page.html',
})
export class ModerationQueuePage implements OnInit {
  private readonly api = inject(ModerationApiService);
  private readonly messages = inject(MessageService);

  protected readonly carregando = signal(false);
  protected readonly itens = signal<ItemDaFila[]>([]);
  protected readonly total = signal(0);
  /** `campaignId` em decisao. Trava apenas o cartao em questao, nao a tela inteira. */
  protected readonly decidindo = signal<string | null>(null);

  protected readonly vazia = computed(
    () => !this.carregando() && this.itens().length === 0
  );

  protected recusaAberta = false;
  protected recusaAlvo: ItemDaFila | null = null;
  protected recusaMotivo = '';

  ngOnInit(): void {
    this.carregar();
  }

  protected carregar(): void {
    this.carregando.set(true);
    this.api.fila(1, 25).subscribe({
      next: (res) => {
        this.itens.set(res.data);
        this.total.set(res.pagination.total);
        this.carregando.set(false);
      },
      error: () => {
        // O interceptor global de erro ja mostra o toast; aqui so solta a tela.
        this.carregando.set(false);
      },
    });
  }

  protected aprovar(item: ItemDaFila): void {
    if (!item.readyToActivate) {
      this.messages.add({
        severity: 'warn',
        summary: 'Campanha sem conteudo entregavel',
        detail:
          item.readinessReason ??
          'A campanha nao tem criativo aprovado nem regra de agendamento valida.',
        life: 8000,
      });
      return;
    }
    this.decidindo.set(item.campaignId);
    this.api.decidir(item.campaignId, { decision: 'approve' }).subscribe({
      next: () => {
        this.messages.add({
          severity: 'success',
          summary: 'Campanha aprovada',
          detail: `${item.name} esta no ar.`,
        });
        this.removerDaLista(item.campaignId);
      },
      error: () => {
        this.decidindo.set(null);
        // Recarrega porque o erro mais provavel e `NOT_IN_REVIEW`: outro moderador decidiu
        // enquanto esta tela mostrava o retrato antigo.
        this.carregar();
      },
    });
  }

  protected abrirRecusa(item: ItemDaFila): void {
    this.recusaAlvo = item;
    this.recusaMotivo = '';
    this.recusaAberta = true;
  }

  protected confirmarRecusa(): void {
    const item = this.recusaAlvo;
    const motivo = this.recusaMotivo.trim();
    if (!item) {
      return;
    }
    if (motivo.length < 3) {
      this.messages.add({
        severity: 'warn',
        summary: 'Motivo obrigatorio',
        detail:
          'O anunciante le este texto para corrigir o criativo. Escreva o que esta errado.',
      });
      return;
    }
    this.decidindo.set(item.campaignId);
    this.api
      .decidir(item.campaignId, { decision: 'reject', reason: motivo })
      .subscribe({
        next: () => {
          this.messages.add({
            severity: 'success',
            summary: 'Campanha recusada',
            detail: `O motivo foi registrado e fica visivel para o anunciante.`,
          });
          this.recusaAberta = false;
          this.recusaAlvo = null;
          this.removerDaLista(item.campaignId);
        },
        error: () => {
          this.decidindo.set(null);
          this.recusaAberta = false;
          this.carregar();
        },
      });
  }

  /** Rotulo legivel do repasse, nos dois modelos. */
  protected repasse(item: ItemDaFila): string {
    const p = item.driverPayout;
    if (!p) {
      return '—';
    }
    if (p.model === 'percent') {
      return p.percent === null
        ? '—'
        : `${(p.percent * 100).toFixed(1)}% por veiculacao`;
    }
    return p.valueCents === null
      ? '—'
      : `${(p.valueCents / 100).toFixed(2)} ${item.budget.currency} por veiculacao`;
  }

  /** Resumo da segmentacao. Vazio significa sem restricao, e a tela diz isso. */
  protected segmentacao(item: ItemDaFila): string {
    const t = item.targeting;
    const partes: string[] = [];
    if (t.cities.length) partes.push(`cidades: ${t.cities.join(', ')}`);
    if (t.zoneIds.length) partes.push(`${t.zoneIds.length} zona(s) especifica(s)`);
    if (t.tiers.length) partes.push(`tiers: ${t.tiers.join(', ')}`);
    if (t.vehicleTiers.length)
      partes.push(`veiculos: ${t.vehicleTiers.join(', ')}`);
    if (t.dayparts.length) partes.push(`faixas: ${t.dayparts.join(', ')}`);
    return partes.length > 0 ? partes.join(' · ') : 'Sem restricao de segmentacao';
  }

  private removerDaLista(campaignId: string): void {
    this.itens.update((atual) =>
      atual.filter((i) => i.campaignId !== campaignId)
    );
    this.total.update((t) => Math.max(0, t - 1));
    this.decidindo.set(null);
  }
}
