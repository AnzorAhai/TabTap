import { Body, Controller, Delete, Get, Param, Put, Sse, type MessageEvent } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { TableBillView } from "@tabtap/shared";
import { IsInt, Max, Min } from "class-validator";
import type { Observable } from "rxjs";
import { BillEventsService } from "../events/bill-events.service";
import { BillsService } from "./bills.service";
import { ParseIdPipe } from "../common/ids";

export class SetEqualSplitDto {
  @IsInt()
  @Min(2)
  @Max(30)
  shareCount!: number;
}

@Controller()
export class BillsController {
  constructor(
    private readonly bills: BillsService,
    private readonly events: BillEventsService,
  ) {}

  // The path segment is the table's QR token (what the guest scanned), not its database id.
  @Get("tables/:qrToken/bill")
  getTableBill(@Param("qrToken") qrToken: string): Promise<TableBillView> {
    return this.bills.getTableView(qrToken);
  }

  @Get("bills/:billId")
  getBill(@Param("billId", ParseIdPipe) billId: string): Promise<TableBillView> {
    return this.bills.getView(billId);
  }

  /** Server-sent events: "bill.updated" whenever anything on this bill changes. */
  @SkipThrottle()
  @Sse("bills/:billId/events")
  events$(@Param("billId", ParseIdPipe) billId: string): Observable<MessageEvent> {
    return this.events.stream(billId);
  }

  @Put("bills/:billId/equal-split")
  setEqualSplit(@Param("billId", ParseIdPipe) billId: string, @Body() dto: SetEqualSplitDto): Promise<TableBillView> {
    return this.bills.setEqualSplit(billId, dto.shareCount);
  }

  @Delete("bills/:billId/equal-split")
  removeEqualSplit(@Param("billId", ParseIdPipe) billId: string): Promise<TableBillView> {
    return this.bills.removeEqualSplit(billId);
  }
}
