import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Post,
  Req,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { JwtPayload } from '../auth/auth.types';
import { SaveWebProductDto, WebCatalogListDto } from './web-catalog.dto';
import { ApproveWebCandidateDto } from './web-catalog.dto';
import { RevokeWebApprovalDto } from './web-catalog.dto';
import { ApproveWebBatchDto } from './web-catalog.dto';
import { WebCatalogService } from './web-catalog.service';
@Controller('web-catalog/admin/products')
@Roles(RolUsuario.ADMIN)
export class WebCatalogController {
  constructor(private readonly service: WebCatalogService) {}
  @Get('batch/approvals/:receipt') batchStatus(
    @Param('receipt', ParseIntPipe) receipt: number,
  ) {
    return this.service.batchStatus(receipt);
  }
  @Post('batch/approvals/:receipt/revoke') revokeBatch(
    @Param('receipt', ParseIntPipe) receipt: number,
    @Body() dto: RevokeWebApprovalDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.revokeBatch(
      receipt,
      dto.confirmed,
      req.user.idUser ?? 0,
    );
  }
  @Post('batch/approve') approveBatch(
    @Body() dto: ApproveWebBatchDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.approveBatch(
      dto.raw,
      dto.members,
      dto.confirmed,
      req.user.idUser ?? 0,
    );
  }
  @Get(':id/approvals/:receipt') approvalStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('receipt', ParseIntPipe) receipt: number,
  ) {
    return this.service.approvalStatus(id, receipt);
  }
  @Post(':id/approvals/:receipt/revoke') revokeApproval(
    @Param('id', ParseIntPipe) id: number,
    @Param('receipt', ParseIntPipe) receipt: number,
    @Body() dto: RevokeWebApprovalDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.revokeApproval(
      id,
      receipt,
      dto.confirmed,
      req.user.idUser ?? 0,
    );
  }
  @Post(':id/approve-candidate') approveCandidate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveWebCandidateDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.approveCandidate(
      id,
      dto.version,
      dto.confirmed,
      req.user.idUser ?? 0,
    );
  }
  @Get() list(@Query() dto: WebCatalogListDto) {
    return this.service.list(dto);
  }
  @Get(':id') preview(@Param('id', ParseIntPipe) id: number) {
    return this.service.preview(id);
  }
  @Get(':id/export-candidate') exportCandidate(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.exportCandidate(id);
  }
  @Put(':id') save(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveWebProductDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.service.save(id, dto, req.user.idUser ?? 0);
  }
}
