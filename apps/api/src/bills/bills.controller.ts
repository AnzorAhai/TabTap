import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { BillsService } from "./bills.service";
import { CreateSplitDto } from "./dto/create-split.dto";

@Controller()
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Get("tables/:tableId/bill")
  getBillForTable(@Param("tableId") tableId: string) {
    return this.billsService.getBillForTable(tableId);
  }

  @Get("bills/:billId")
  getBill(@Param("billId") billId: string) {
    return this.billsService.getBill(billId);
  }

  @Post("bills/:billId/splits")
  createSplit(@Param("billId") billId: string, @Body() dto: CreateSplitDto) {
    return this.billsService.createEqualSplit(billId, dto.participantsCount);
  }

  @Get("splits/:splitId")
  getSplit(@Param("splitId") splitId: string) {
    return this.billsService.getSplit(splitId);
  }
}
