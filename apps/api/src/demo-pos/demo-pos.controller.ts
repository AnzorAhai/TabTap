import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import type { AddDemoLineRequest, DemoPosView } from "@tabtap/shared";
import { AnyTenantRole, CurrentTenant, TenantRoles, type TenantAccess } from "../auth/staff.guard";
import { IsId, ParseIdPipe } from "../common/ids";
import { DemoPosService } from "./demo-pos.service";

export class AddDemoLineDto implements AddDemoLineRequest {
  @IsId()
  menuItemId!: string;
}

/** The demo POS screen. Answers 404 for anything but the demo restaurant. */
@Controller("tenants/:tenantId/demo-pos")
export class DemoPosController {
  constructor(private readonly demoPos: DemoPosService) {}

  @AnyTenantRole()
  @Get()
  view(@CurrentTenant() access: TenantAccess): Promise<DemoPosView> {
    return this.demoPos.view(access.tenantId);
  }

  @AnyTenantRole()
  @Post("tables/:tableId/lines")
  @HttpCode(200)
  addLine(
    @CurrentTenant() access: TenantAccess,
    @Param("tableId", ParseIdPipe) tableId: string,
    @Body() dto: AddDemoLineDto,
  ): Promise<DemoPosView> {
    return this.demoPos.addLine(access.tenantId, tableId, dto.menuItemId);
  }

  @AnyTenantRole()
  @Delete("tables/:tableId/lines/:lineId")
  removeLine(
    @CurrentTenant() access: TenantAccess,
    @Param("tableId", ParseIdPipe) tableId: string,
    @Param("lineId", ParseIdPipe) lineId: string,
  ): Promise<DemoPosView> {
    return this.demoPos.removeLine(access.tenantId, tableId, lineId);
  }

  @AnyTenantRole()
  @Post("tables/:tableId/close")
  @HttpCode(200)
  closeTable(
    @CurrentTenant() access: TenantAccess,
    @Param("tableId", ParseIdPipe) tableId: string,
  ): Promise<DemoPosView> {
    return this.demoPos.closeTable(access.tenantId, tableId);
  }

  @TenantRoles("owner", "manager")
  @Post("reset")
  @HttpCode(200)
  reset(@CurrentTenant() access: TenantAccess): Promise<DemoPosView> {
    return this.demoPos.reset(access.tenantId);
  }
}
