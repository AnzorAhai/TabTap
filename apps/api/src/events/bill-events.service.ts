import { Injectable, type MessageEvent } from "@nestjs/common";
import type { BillEvent } from "@tabtap/shared";
import { filter, interval, map, merge, Observable, Subject } from "rxjs";

const HEARTBEAT_MS = 25_000;

/**
 * In-process bus of "this bill changed" notifications, streamed to guests over SSE so
 * everyone at a table sees claims and payments as they happen. Single-instance only:
 * with several API instances this needs a shared channel (e.g. Postgres LISTEN/NOTIFY).
 */
@Injectable()
export class BillEventsService {
  private readonly changes = new Subject<string>();

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
    return merge(updates, pings).pipe(map((data) => ({ data })));
  }

  /** Raw change notifications (bill ids); used by tests. */
  changesFeed(): Observable<string> {
    return this.changes.asObservable();
  }
}
