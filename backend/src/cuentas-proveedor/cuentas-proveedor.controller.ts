import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { CreateFacturaProveedorDto, CreateSupplierAdvanceDto, CreateSupplierCreditDto, PaySupplierInvoiceDto, PayGroupedSupplierInvoicesDto, ResolveDiscrepancyDto, ReviewSupplierTransactionDto, ScheduleSupplierPaymentDto } from './cuentas-proveedor.dto';
import { CuentasProveedorService } from './cuentas-proveedor.service';
import { supplierJson } from './supplier-json';

@Controller('cuentas-proveedor')
export class CuentasProveedorController {
  constructor(private readonly service: CuentasProveedorService) {}
  private async json<T>(result: Promise<T>): Promise<T> { return supplierJson(await result); }

  @Get('dashboard') dashboard() { return this.json(this.service.dashboard()); }
  @Get('facturas') invoices() { return this.json(this.service.listInvoices()); }
  @Get('facturas/:id') invoice(@Param('id', ParseIntPipe) id: number) { return this.json(this.service.invoice(id)); }

  @Post('facturas')
  @Permissions('compras.facturas')
  create(@Body() dto: CreateFacturaProveedorDto, @Req() req: { user: JwtPayload }) {
    return this.json(this.service.createInvoice(dto, req.user?.idUser));
  }

  @Post('facturas/:id/pdf')
  @Permissions('compras.facturas')
  @UseInterceptors(FileInterceptor('pdf', { storage: memoryStorage(), limits: { files: 1, fileSize: 10 * 1024 * 1024 } }))
  uploadPdf(@Param('id', ParseIntPipe) id: number, @UploadedFile() file?: Express.Multer.File) {
    return this.json(this.service.uploadPdf(id, file));
  }

  @Get('facturas/:id/xml')
  async xml(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const xml = await this.service.document(id, 'xml');
    response.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename=factura_proveedor_${id}.xml` });
    response.send(xml);
  }

  @Get('facturas/:id/pdf')
  async pdf(@Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const pdf = await this.service.document(id, 'pdf');
    response.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename=factura_proveedor_${id}.pdf` });
    response.end(pdf);
  }

  @Post('discrepancias/:id/resolver')
  @Roles(RolUsuario.ADMIN) @Permissions('compras.autorizar')
  resolve(@Param('id', ParseIntPipe) id: number, @Body() dto: ResolveDiscrepancyDto, @Req() req: { user: JwtPayload }) {
    return this.json(this.service.resolveDiscrepancy(id, dto, req.user?.idUser));
  }

  @Post('facturas/:id/aprobar')
  @Roles(RolUsuario.ADMIN) @Permissions('compras.pagar')
  approve(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) { return this.json(this.service.approveInvoice(id, req.user?.idUser)); }

  @Post('facturas/:id/cancelar')
  @Roles(RolUsuario.ADMIN) @Permissions('compras.cancelar')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewSupplierTransactionDto, @Req() req: { user: JwtPayload }) {
    return this.json(this.service.cancelInvoice(id, dto.motivo, req.user?.idUser));
  }

  @Post('facturas/:id/programaciones')
  @Roles(RolUsuario.ADMIN) @Permissions('compras.pagar')
  schedule(@Param('id', ParseIntPipe) id: number, @Body() dto: ScheduleSupplierPaymentDto, @Req() req: { user: JwtPayload }) {
    return this.json(this.service.schedule(id, dto, req.user?.idUser));
  }

  @Post('facturas/:id/pagos')
  @Roles(RolUsuario.ADMIN) @Permissions('compras.pagar')
  pay(@Param('id', ParseIntPipe) id: number, @Body() dto: PaySupplierInvoiceDto, @Req() req: { user: JwtPayload }) {
    return this.json(this.service.pay(id, dto, req.user?.idUser));
  }

  /** U02.3 · Un pago repartido entre varias facturas del mismo proveedor. */
  @Post('pagos-agrupados')
  @Roles(RolUsuario.ADMIN) @Permissions('compras.pagar')
  payGrouped(@Body() dto: PayGroupedSupplierInvoicesDto, @Req() req: { user: JwtPayload }) {
    return this.json(this.service.payGrouped(dto, req.user?.idUser));
  }

  @Post('pagos/:id/revertir')
  @Roles(RolUsuario.ADMIN) @Permissions('compras.cancelar')
  reversePayment(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewSupplierTransactionDto, @Req() req: { user: JwtPayload }) {
    return this.json(this.service.reversePayment(id, dto.motivo, req.user?.idUser));
  }

  @Post('notas-credito')
  @Roles(RolUsuario.ADMIN) @Permissions('compras.pagar')
  credit(@Body() dto: CreateSupplierCreditDto, @Req() req: { user: JwtPayload }) { return this.json(this.service.createCredit(dto, req.user?.idUser)); }

  @Post('anticipos')
  @Roles(RolUsuario.ADMIN) @Permissions('compras.pagar')
  advance(@Body() dto: CreateSupplierAdvanceDto, @Req() req: { user: JwtPayload }) { return this.json(this.service.createAdvance(dto, req.user?.idUser)); }
}
