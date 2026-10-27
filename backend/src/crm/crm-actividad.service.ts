import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CreateCrmComunicacionDto,
  CreateCrmTareaDto,
  CrmTareasQuery,
  UpdateCrmTareaDto,
} from './crm.dto';
import { queryRows } from '../common/database/typed-query';
import { RolUsuario } from '../common/enums/app.enums';
import { setAuditActor } from '../auth/audit-actor';
import { JwtPayload } from '../auth/auth.types';
@Injectable()
export class CrmActividadService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  tareas(query: CrmTareasQuery, idUser: number, role: RolUsuario) {
    const where = ['($1::boolean OR t.id_responsable=$2 OR t.id_creador=$2)'];
    const params: unknown[] = [role === RolUsuario.ADMIN, idUser];
    if (query.idTarea) {
      if (BigInt(query.idTarea) > 9223372036854775807n) throw new BadRequestException('Referencia de tarea inválida');
      params.push(query.idTarea);
      where.push(`t.id_tarea=$${params.length}::bigint`);
    }
    if (query.estado) {
      params.push(query.estado);
      where.push(`t.estado=$${params.length}`);
    }
    if (query.idResponsable) {
      params.push(query.idResponsable);
      where.push(`t.id_responsable=$${params.length}`);
    }
    if (query.vencimiento === 'vencidas')
      where.push(
        "t.estado IN ('Pendiente','En progreso') AND t.fecha_vencimiento<clock_timestamp()",
      );
    if (query.vencimiento === 'hoy')
      where.push('t.fecha_vencimiento::date=current_date');
    if (query.vencimiento === 'proximas')
      where.push(
        "t.estado IN ('Pendiente','En progreso') AND t.fecha_vencimiento>=clock_timestamp() AND t.fecha_vencimiento<clock_timestamp()+interval '7 days'",
      );
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT t.id_tarea AS "idTarea",s.estado AS "estadoSecuencia",t.id_secuencia AS "idSecuencia",t.paso_secuencia AS "pasoSecuencia",t.titulo,t.descripcion,t.prioridad,t.estado,t.fecha_vencimiento AS "fechaVencimiento",t.id_responsable AS "idResponsable",u.username AS responsable,t.id_cliente AS "idCliente",c."RazonSocial" AS cliente,t.id_oportunidad AS "idOportunidad",o.empresa,t.id_unidad AS "idUnidad",cu.vin,cu.esn,t.id_cotizacion AS "idCotizacion",t.id_pedido AS "idPedido",t.version,t.created_at AS "createdAt" FROM crm_tarea t LEFT JOIN crm_secuencia s ON s.id_secuencia=t.id_secuencia JOIN auth_user u ON u.id_user=t.id_responsable LEFT JOIN cliente c ON c."IdCliente"=t.id_cliente LEFT JOIN crm_oportunidad o ON o.id_oportunidad=t.id_oportunidad LEFT JOIN crm_unidad_cliente cu ON cu.id_unidad=t.id_unidad WHERE ${where.join(' AND ')} ORDER BY CASE t.estado WHEN 'Pendiente' THEN 1 WHEN 'En progreso' THEN 2 ELSE 3 END,CASE t.prioridad WHEN 'Urgente' THEN 1 WHEN 'Alta' THEN 2 WHEN 'Media' THEN 3 ELSE 4 END,t.fecha_vencimiento LIMIT 200`,
      params,
    );
  }

  async createTarea(dto: CreateCrmTareaDto, idUser: number, role: RolUsuario) {
    if (
      ![
        dto.idCliente,
        dto.idUnidad,
        dto.idOportunidad,
        dto.idCotizacion,
        dto.idPedido,
      ].some(Boolean)
    )
      throw new BadRequestException(
        'Relaciona la tarea con un cliente, unidad, oportunidad, cotización o pedido',
      );
    if (role !== RolUsuario.ADMIN && dto.idResponsable !== idUser)
      throw new BadRequestException(
        'Solo un administrador puede asignar tareas a otro usuario',
      );
    const rows = await queryRows<{ idTarea: number }>(
      this.dataSource,
      `INSERT INTO crm_tarea(titulo,descripcion,prioridad,fecha_vencimiento,id_responsable,id_cliente,id_unidad,id_oportunidad,id_cotizacion,id_pedido,id_creador) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id_tarea AS "idTarea"`,
      [
        dto.titulo,
        dto.descripcion || null,
        dto.prioridad,
        dto.fechaVencimiento,
        dto.idResponsable,
        dto.idCliente || null,
        dto.idUnidad || null,
        dto.idOportunidad || null,
        dto.idCotizacion || null,
        dto.idPedido || null,
        idUser,
      ],
    );
    return rows[0];
  }

  async updateTarea(
    id: number | string,
    dto: UpdateCrmTareaDto,
    idUser: number,
    role: RolUsuario,
    sequenceActor?: JwtPayload,
    requireSequencePermission = true,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await queryRows<Record<string, unknown>>(
        manager,
        'SELECT * FROM crm_tarea WHERE id_tarea=$1 FOR UPDATE',
        [id],
      );
      if (!rows.length) throw new NotFoundException('Tarea no encontrada');
      const current = rows[0];
      if (
        role !== RolUsuario.ADMIN &&
        Number(current.id_responsable) !== idUser &&
        Number(current.id_creador) !== idUser
      )
        throw new NotFoundException('Tarea no encontrada');
      if (Number(current.version) !== dto.expectedVersion)
        throw new ConflictException(
          'La tarea cambió; actualiza la lista e inténtalo de nuevo',
        );
      const estado = dto.estado ?? String(current.estado);
      if(current.id_secuencia){
        const [active]=await queryRows(manager,`SELECT id_user FROM auth_user WHERE id_user=$1 AND role=$2 AND is_active AND ($3::int IS NULL OR (token_version=$3 AND (NOT $4::boolean OR fn_effective_permission(id_user,role,'crm.secuencias.gestionar')))) FOR SHARE`,[idUser,role,sequenceActor?.version??null,requireSequencePermission]);
        if(!active)throw new ConflictException('La cuenta responsable de la operación cambió.');
        if(Object.keys(dto).some(k=>!['estado','expectedVersion'].includes(k)))
          throw new ConflictException('El paso conserva el contexto del modelo. Sólo cambia su estado.');
        if(['Completada','Cancelada'].includes(String(current.estado)))
          throw new ConflictException('Un paso cerrado no se reabre. Actualiza la secuencia.');
      }
      const responsable = dto.idResponsable ?? Number(current.id_responsable);
      if (
        role !== RolUsuario.ADMIN &&
        responsable !== Number(current.id_responsable)
      )
        throw new BadRequestException(
          'Solo un administrador puede reasignar tareas',
        );
      await manager.query("SET LOCAL statement_timeout='10s'");
      await setAuditActor(manager,idUser);
      if(current.id_secuencia){
        // Actualizar sólo el estado conserva la precisión timestamptz del plazo y el modelo.
        await manager.query(`UPDATE crm_tarea SET estado=$2::varchar,completada_at=CASE WHEN $2::varchar='Completada' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp(),version=version+1 WHERE id_tarea=$1`,[id,estado]);
        return {idTarea:id,version:Number(current.version)+1};
      }
      await manager.query(
        `UPDATE crm_tarea SET titulo=$2,descripcion=$3,prioridad=$4,estado=$5::varchar,fecha_vencimiento=$6,id_responsable=$7,id_cliente=$8,id_unidad=$9,id_oportunidad=$10,id_cotizacion=$11,id_pedido=$12,completada_at=CASE WHEN $5::varchar='Completada' THEN coalesce(completada_at,clock_timestamp()) ELSE NULL END,updated_at=clock_timestamp(),version=version+1 WHERE id_tarea=$1`,
        [
          id,
          dto.titulo ?? current.titulo,
          dto.descripcion === undefined ? current.descripcion : dto.descripcion,
          dto.prioridad ?? current.prioridad,
          estado,
          dto.fechaVencimiento ?? current.fecha_vencimiento,
          responsable,
          dto.idCliente === undefined ? current.id_cliente : dto.idCliente,
          dto.idUnidad === undefined ? current.id_unidad : dto.idUnidad,
          dto.idOportunidad === undefined
            ? current.id_oportunidad
            : dto.idOportunidad,
          dto.idCotizacion === undefined
            ? current.id_cotizacion
            : dto.idCotizacion,
          dto.idPedido === undefined ? current.id_pedido : dto.idPedido,
        ],
      );
      return { idTarea: id, version: Number(current.version) + 1 };
    });
  }

  comunicaciones(idCliente?: number, idOportunidad?: number) {
    if (!idCliente && !idOportunidad)
      throw new BadRequestException('Indica un cliente u oportunidad');
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT cc.id_comunicacion AS "idComunicacion",cc.canal,cc.direccion,cc.resumen,cc.fecha,cc.id_cliente AS "idCliente",c."RazonSocial" AS cliente,cc.id_oportunidad AS "idOportunidad",o.empresa,u.username FROM crm_comunicacion cc LEFT JOIN cliente c ON c."IdCliente"=cc.id_cliente LEFT JOIN crm_oportunidad o ON o.id_oportunidad=cc.id_oportunidad LEFT JOIN auth_user u ON u.id_user=cc.id_user WHERE ($1::int IS NULL OR cc.id_cliente=$1) AND ($2::int IS NULL OR cc.id_oportunidad=$2) ORDER BY cc.fecha DESC LIMIT 100`,
      [idCliente || null, idOportunidad || null],
    );
  }

  async createComunicacion(dto: CreateCrmComunicacionDto, idUser: number) {
    if (!dto.idCliente && !dto.idUnidad && !dto.idOportunidad)
      throw new BadRequestException(
        'Relaciona la comunicación con un cliente, unidad u oportunidad',
      );
    const rows = await queryRows<{ idComunicacion: number }>(
      this.dataSource,
      `INSERT INTO crm_comunicacion(canal,direccion,resumen,fecha,id_cliente,id_unidad,id_oportunidad,id_user) VALUES($1,$2,$3,coalesce($4::timestamptz,clock_timestamp()),$5,$6,$7,$8) RETURNING id_comunicacion AS "idComunicacion"`,
      [
        dto.canal,
        dto.direccion,
        dto.resumen,
        dto.fecha || null,
        dto.idCliente || null,
        dto.idUnidad || null,
        dto.idOportunidad || null,
        idUser,
      ],
    );
    return rows[0];
  }
}
