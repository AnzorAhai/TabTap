import { Injectable, type MessageEvent, type OnModuleDestroy } from "@nestjs/common";
import type { BillEvent } from "@tabtap/shared";
import { filter, interval, map, merge, Observable, Subject, takeUntil } from "rxjs";

const HEARTBEAT_MS = 25_000;

/**
 * In-process bus of "this bill changed" notifications, streamed to guests over SSE so
 * everyone at a table sees claims and payments as they happen. Single-instance only:
 * with several API instances this needs a shared channel (e.g. Postgres LISTEN/NOTIFY).
 */
@Injectable()
export class BillEventsService implements OnModuleDestroy {
  private readonly changes = new Subject<string>();
  private readonly closing = new Subject<void>();

  /**
   * End every open stream when the app shuts down: an open SSE response would otherwise
   * keep the HTTP server from closing. Browsers reconnect to the new instance by themselves.
   */
  onModuleDestroy(): void {
    this.closing.next();
    this.closing.complete();
  }

  emit(billId: string): void {
    this.changes.next(billId);
  }

  /** Bill changes, plus periodic pings that keep proxies from closing an idle stream. */
  stream(billId: string): Observable<MessageEvent> {
    const updates = this.changes.pipe(
      filter((id) => id === billId),
      map((): BillEvent => ({ kind: "bill.updated", billId, at: new Date().toISOString() })),
    );
    const pings = interval(HEARTBEAT_MS).pipe(
      map((): BillEvent => ({ kind: "ping", billId, at: new Date().toISOString() })),
    );
    return merge(updates, pings).pipe(
      map((data) => ({ data })),
      takeUntil(this.closing),
    );
  }

  /** Raw change notifications (bill ids); used by tests. */
  changesFeed(): Observable<string> {
    return this.changes.asObservable();
  }
}
