import { JwtPayload } from '../auth/auth.types';
import { lockQuoteFamily, requireAcceptedQuote } from '../cotizacion/cotizacion-version-policy';
import { commercialActor } from '../comercial/commercial-actor';
import { setAuditActor } from '../auth/audit-actor';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import {
  consumeCommercialAuthorizations,
  validateCommercialPolicy,
} from '../comercial/commercial-policy';
import { CreatePedidoDto, CreatePedidoFromCotizacionDto } from './pedido.dto';
import { ProductRow, QuoteRow, QuoteDetailRow } from './pedido.types';
import { PersistenciaPedidoService } from './persistencia-pedido.service';
@Injectable()
export class RegistroPedidoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly persistencia: PersistenciaPedidoService,
  ) {}
  async create(dto: CreatePedidoDto, idUser?: number, actor?:JwtPayload) {
    return this.dataSource.transaction(async (manager) => {
      if(actor)await commercialActor(manager,actor);else await setAuditActor(manager,idUser);
      const repeated = await queryRows<{ idPedido: number }>(
        manager,
        'SELECT id_pedido AS "idPedido" FROM pedido_venta WHERE request_id=$1',
        [dto.requestId],
      );
      if (repeated.length) return repeated[0];
      if(dto.idCotizacion&&await lockQuoteFamily(manager,dto.idCotizacion))throw new ConflictException('Usa crear pedido desde cotización para respetar la revisión aceptada.');
      const ids = [...new Set(dto.partidas.map((p) => p.idProducto))];
      if (ids.length !== dto.partidas.length)
        throw new BadRequestException(
          'Cada producto debe aparecer una sola vez en el pedido',
        );
      const clients = await queryRows<{ id: number }>(
        manager,
        'SELECT "IdCliente" AS id FROM cliente WHERE "IdCliente"=$1',
        [dto.idCliente],
      );
      if (!clients.length) throw new NotFoundException('Cliente no encontrado');
      if (dto.idUnidad) {
        const units = await queryRows<{ id: number }>(
          manager,
          'SELECT id_unidad AS id FROM crm_unidad_cliente WHERE id_unidad=$1 AND id_cliente=$2',
          [dto.idUnidad, dto.idCliente],
        );
        if (!units.length)
          throw new BadRequestException(
            'La unidad no pertenece al cliente seleccionado',
          );
      }
      const products = await queryRows<ProductRow>(
        manager,
        `SELECT "IdProducto" AS id,"Descripcion" AS descripcion,"Existencia" AS existencia,
        "TasaIVA" AS tasa,"ObjetoImpuesto" AS objeto FROM producto WHERE "IdProducto"=ANY($1::int[]) ORDER BY "IdProducto" FOR UPDATE`,
        [ids],
      );
      if (products.length !== ids.length)
        throw new BadRequestException('Uno o más productos no existen');
      const productMap = new Map(products.map((p) => [Number(p.id), p]));
      const money = (value: number) =>
        Math.round((value + Number.EPSILON) * 100) / 100;
      const lines = dto.partidas.map((line) => {
        const product = productMap.get(line.idProducto)!;
        const importe = money(line.cantidad * line.valorUnitario);
        const iva =
          product.objeto === '02' ? money(importe * Number(product.tasa)) : 0;
        return {
          ...line,
          descripcion: product.descripcion,
          tasa: product.objeto === '02' ? Number(product.tasa) : 0,
          importe,
          iva,
        };
      });
      const subtotal = money(
        lines.reduce((sum, line) => sum + line.importe, 0),
      );
      const impuestos = money(lines.reduce((sum, line) => sum + line.iva, 0));
      const orders = await queryRows<{ idPedido: number }>(
        manager,
        `INSERT INTO pedido_venta(request_id,id_cliente,id_unidad,id_cotizacion,notas,subtotal,impuestos,total,id_vendedor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_pedido AS "idPedido"`,
        [
          dto.requestId,
          dto.idCliente,
          dto.idUnidad ?? null,
          dto.idCotizacion ?? null,
          dto.notas || null,
          subtotal,
          impuestos,
          money(subtotal + impuestos),
          idUser ?? null,
        ],
      );
      const idPedido = orders[0].idPedido;
      for (const line of lines)
        await manager.query(
          `INSERT INTO pedido_venta_detalle(id_pedido,id_producto,descripcion,cantidad,valor_unitario,tasa_iva,importe,importe_iva)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            idPedido,
            line.idProducto,
            line.descripcion,
            line.cantidad,
            line.valorUnitario,
            line.tasa,
            line.importe,
            line.iva,
          ],
        );
      const commercialAuthorizationIds = await validateCommercialPolicy(
        manager,
        {
          idCliente: dto.idCliente,
          operacion: 'Pedido',
          total: money(subtotal + impuestos),
          validarCredito: false,
          lineas: lines.map((line) => ({
            idProducto: line.idProducto,
            cantidad: line.cantidad,
            precio: line.valorUnitario,
          })),
        },
      );
      await consumeCommercialAuthorizations(
        manager,
        commercialAuthorizationIds,
        'Pedido',
        idPedido,
      );
      await this.persistencia.history(
        manager,
        idPedido,
        null,
        'Borrador',
        'Pedido creado',
        idUser,
      );
      return { idPedido };
    });
  }

  async createFromQuote(
    idCotizacion: number,
    dto: CreatePedidoFromCotizacionDto,
    idUser?: number,
    actor?:JwtPayload,
  ) {
    return this.dataSource.transaction(async (manager) => {
      if(actor)await commercialActor(manager,actor);else await setAuditActor(manager,idUser);
      const repeated = await queryRows<{ idPedido: number }>(
        manager,
        'SELECT id_pedido AS "idPedido" FROM pedido_venta WHERE request_id=$1 OR id_cotizacion=$2',
        [dto.requestId, idCotizacion],
      );
      if (repeated.length) return repeated[0];
      const revision=await requireAcceptedQuote(manager,idCotizacion);
      if(revision&&Number(revision.snapshot.retenciones)!==0)throw new ConflictException('La revisión tiene retenciones; usa conversión directa a factura para conservarlas.');
      if(revision?.snapshot.idUnidad){if(dto.idUnidad&&dto.idUnidad!==revision.snapshot.idUnidad)throw new ConflictException('La unidad difiere de la revisión aceptada');dto.idUnidad=revision.snapshot.idUnidad;}
      const quotes = await queryRows<QuoteRow>(
        manager,
        `SELECT id_cliente AS "idCliente",folio,estatus AS estado
        FROM cotizacion WHERE id_cotizacion=$1 FOR UPDATE`,
        [idCotizacion],
      );
      if (!quotes.length)
        throw new NotFoundException('Cotización no encontrada');
      if (['Convertida', 'Rechazada'].includes(quotes[0].estado))
        throw new ConflictException('La cotización ya está cerrada');
      if (dto.idUnidad) {
        const units = await queryRows<{ id: number }>(
          manager,
          'SELECT id_unidad AS id FROM crm_unidad_cliente WHERE id_unidad=$1 AND id_cliente=$2',
          [dto.idUnidad, quotes[0].idCliente],
        );
        if (!units.length)
          throw new BadRequestException(
            'La unidad no pertenece al cliente de la cotización',
          );
      }
      const quoteLines = await queryRows<QuoteDetailRow>(
        manager,
        `SELECT cc.id_producto AS "idProducto",cc.descripcion,cc.cantidad,
        cc.valor_unitario AS "valorUnitario",p."TasaIVA" AS tasa,p."ObjetoImpuesto" AS objeto
        FROM conceptocotizacion cc JOIN producto p ON p."IdProducto"=cc.id_producto
        WHERE cc.id_cotizacion=$1 AND cc.estatus='Pendiente' ORDER BY cc.id_producto FOR UPDATE OF cc,p`,
        [idCotizacion],
      );
      if (!quoteLines.length)
        throw new ConflictException(
          'La cotización no tiene partidas pendientes para pedir',
        );
      const grouped = new Map<
        number,
        {
          idProducto: number;
          descripcion: string;
          cantidad: number;
          importe: number;
          tasa: number;
          objeto: string;
        }
      >();
      for (const line of quoteLines) {
        const quantity = Number(line.cantidad);
        const amount = quantity * Number(line.valorUnitario);
        const current = grouped.get(Number(line.idProducto));
        if (current) {
          current.cantidad += quantity;
          current.importe += amount;
        } else
          grouped.set(Number(line.idProducto), {
            idProducto: Number(line.idProducto),
            descripcion: line.descripcion,
            cantidad: quantity,
            importe: amount,
            tasa: Number(line.tasa),
            objeto: line.objeto,
          });
      }
      const money = (value: number) =>
        Math.round((value + Number.EPSILON) * 100) / 100;
      const lines = [...grouped.values()].map((line) => ({
        ...line,
        valorUnitario: line.importe / line.cantidad,
        importe: money(line.importe),
        iva: line.objeto === '02' ? money(line.importe * line.tasa) : 0,
      }));
      const subtotal = money(
        lines.reduce((sum, line) => sum + line.importe, 0),
      );
      const impuestos = money(lines.reduce((sum, line) => sum + line.iva, 0));
      const orders = await queryRows<{ idPedido: number }>(
        manager,
        `INSERT INTO pedido_venta(request_id,id_cliente,id_unidad,id_cotizacion,notas,subtotal,impuestos,total,id_vendedor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_pedido AS "idPedido"`,
        [
          dto.requestId,
          quotes[0].idCliente,
          dto.idUnidad ?? null,
          idCotizacion,
          dto.notas || `Originado por cotización C-${quotes[0].folio}`,
          subtotal,
          impuestos,
          money(subtotal + impuestos),
          idUser ?? null,
        ],
      );
      const idPedido = orders[0].idPedido;
      for (const line of lines)
        await manager.query(
          `INSERT INTO pedido_venta_detalle(id_pedido,id_producto,descripcion,cantidad,valor_unitario,tasa_iva,importe,importe_iva)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            idPedido,
            line.idProducto,
            line.descripcion,
            line.cantidad,
            line.valorUnitario,
            line.objeto === '02' ? line.tasa : 0,
            line.importe,
            line.iva,
          ],
        );
      const commercialAuthorizationIds = await validateCommercialPolicy(
        manager,
        {
          idCliente: quotes[0].idCliente,
          operacion: 'Pedido',
          total: money(subtotal + impuestos),
          validarCredito: false,
          lineas: lines.map((line) => ({
            idProducto: line.idProducto,
            cantidad: line.cantidad,
            precio: line.valorUnitario,
          })),
        },
      );
      await consumeCommercialAuthorizations(
        manager,
        commercialAuthorizationIds,
        'Pedido',
        idPedido,
      );
      await this.persistencia.history(
        manager,
        idPedido,
        null,
        'Borrador',
        `Creado desde cotización C-${quotes[0].folio}`,
        idUser,
      );
      return { idPedido };
    });
  }
}
