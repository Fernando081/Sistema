import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { CreateVistaGuardadaDto, RutaVista } from './vistas-guardadas.dto';

export interface VistaGuardada { idVista: number; ruta: RutaVista; nombre: string; consulta: string; updatedAt: string; }

/** Parámetros que los listados restauran desde la URL; la página no se guarda (una vista siempre abre en la 1). */
const PARAMETROS = ['q', 'limit', 'sort', 'order', 'tipo', 'estado', 'desde', 'hasta'] as const;
export const MAX_VISTAS_POR_LISTADO = 20;
const COLUMNAS = `id_vista::int AS "idVista", ruta, nombre, consulta, updated_at AS "updatedAt"`;

/** Conserva sólo parámetros conocidos, sin vacíos, recortados y en orden estable. */
export function limpiarConsulta(consulta: string): string {
  const entrada = new URLSearchParams(consulta.replace(/^\?/, ''));
  const salida = new URLSearchParams();
  for (const clave of PARAMETROS) {
    const valor = entrada.get(clave)?.trim();
    if (valor) salida.set(clave, valor.slice(0, 200));
  }
  return salida.toString();
}

@Injectable()
export class VistasGuardadasService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(idUser: number, ruta: RutaVista) {
    return queryRows<VistaGuardada>(this.dataSource,
      `SELECT ${COLUMNAS} FROM vista_guardada WHERE id_user=$1 AND ruta=$2 ORDER BY lower(nombre)`, [idUser, ruta]);
  }

  /** Guardar con un nombre existente del mismo listado reemplaza sus filtros (actualiza la vista). */
  async save(idUser: number, dto: CreateVistaGuardadaDto): Promise<VistaGuardada> {
    const consulta = limpiarConsulta(dto.consulta);
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('vista-guardada:' || $1 || ':' || $2))`, [idUser, dto.ruta]);
      const updated = await queryRows<VistaGuardada>(manager,
        `UPDATE vista_guardada SET consulta=$4, nombre=$3, updated_at=clock_timestamp()
          WHERE id_user=$1 AND ruta=$2 AND lower(nombre)=lower($3) RETURNING ${COLUMNAS}`, [idUser, dto.ruta, dto.nombre, consulta]);
      if (updated.length) return updated[0];
      const [{ n }] = await queryRows<{ n: number }>(manager,
        'SELECT count(*)::int AS n FROM vista_guardada WHERE id_user=$1 AND ruta=$2', [idUser, dto.ruta]);
      if (n >= MAX_VISTAS_POR_LISTADO) {
        throw new BadRequestException(`Máximo ${MAX_VISTAS_POR_LISTADO} vistas por listado; elimina alguna antes de guardar otra`);
      }
      try {
        const created = await queryRows<VistaGuardada>(manager,
          `INSERT INTO vista_guardada(id_user, ruta, nombre, consulta) VALUES ($1,$2,$3,$4) RETURNING ${COLUMNAS}`,
          [idUser, dto.ruta, dto.nombre, consulta]);
        return created[0];
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new ConflictException('Ya tienes una vista con ese nombre');
        throw error;
      }
    });
  }

  async remove(idUser: number, idVista: number) {
    const rows = await queryRows<{ id: number }>(this.dataSource,
      'DELETE FROM vista_guardada WHERE id_vista=$1 AND id_user=$2 RETURNING id_vista AS id', [idVista, idUser]);
    // Una vista ajena se reporta igual que una inexistente: no revela vistas de otros usuarios.
    if (!rows.length) throw new NotFoundException('Vista no encontrada');
    return { message: 'Vista eliminada' };
  }
}
