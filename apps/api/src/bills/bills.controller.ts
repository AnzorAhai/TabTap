import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { BillsService } from "./bills.service";
import { CreateSplitDto } from "./dto/create-split.dto";
import { PayItemsDto } from "./dto/pay-items.dto";

@Controller()
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  // The path segment is the table's QR token (what the guest scanned), not its database id.
  @Get("tables/:qrToken/bill")
  getBillForTable(@Param("qrToken") qrToken: string) {
    return this.billsService.getBillForTable(qrToken);
  }

  @Get("bills/:billId")
  getBill(@Param("billId", ParseUUIDPipe) billId: string) {
    return this.billsService.getBill(billId);
  }

  @Post("bills/:billId/splits")
  createSplit(@Param("billId", ParseUUIDPipe) billId: string, @Body() dto: CreateSplitDto) {
    return this.billsService.createEqualSplit(billId, dto.participantsCount);
  }

  @Get("splits/:splitId")
  getSplit(@Param("splitId", ParseUUIDPipe) splitId: string) {
    return this.billsService.getSplit(splitId);
  }

  @Get("bills/:billId/items-split")
  async getItemsSplit(@Param("billId", ParseUUIDPipe) billId: string) {
    return (await this.billsService.getItemsSplit(billId)) ?? { participants: [] };
  }

  @Post("bills/:billId/items-split")
  payForItems(@Param("billId", ParseUUIDPipe) billId: string, @Body() dto: PayItemsDto) {
    return this.billsService.payForItems(billId, dto.itemIds);
  }
}
